import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  // Process 2 volumes for testing
  testFiles: [
    path.join(__dirname, 'downloads/pdf/OCR/Vol1_p114.txt'),
    path.join(__dirname, 'downloads/pdf/OCR/Vol2_p4155.txt'),
  ],
  chunkSize: 4000, // Characters per chunk (fit in context window)
  maxChunksPerFile: 10, // Limit chunks per file for testing
};

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
console.log(`Using model: ${OPENAI_MODEL}`);

// ============================================================================
// OPENAI ENTITY EXTRACTION
// ============================================================================

async function extractEntities(text) {
  try {
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      reasoning_effort: 'low',
      messages: [
        {
          role: 'system',
          content: `You are an entity extraction expert for Holocaust and Eichmann trial documents.
Extract named entities from the Hebrew text.

Entity types: PERSON, LOCATION, ORGANIZATION, EVENT, DOCUMENT, DATE

- PERSON: witnesses, Nazi officials, victims
- LOCATION: countries, cities, camps
- ORGANIZATION: SS units, departments
- EVENT: operations, conferences
- DOCUMENT: exhibits, evidence
- DATE: specific dates

Extract 10-20 most important entities.`
        },
        {
          role: 'user',
          content: `Extract entities from this text:\n\n${text.slice(0, 3000)}`
        }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'entity_extraction',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              entities: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: 'Entity name in Hebrew' },
                    type: { type: 'string', enum: ['PERSON', 'LOCATION', 'ORGANIZATION', 'EVENT', 'DOCUMENT', 'DATE'] },
                    englishName: { type: 'string', description: 'English transliteration' },
                    salience: { type: 'number', description: 'Importance 0-1' }
                  },
                  required: ['name', 'type', 'englishName', 'salience'],
                  additionalProperties: false
                }
              }
            },
            required: ['entities'],
            additionalProperties: false
          }
        }
      }
    });
    
    const content = response.choices[0].message.content;
    const result = JSON.parse(content);
    return result.entities || [];
  } catch (error) {
    console.error('OpenAI error:', error.message);
    return [];
  }
}

// ============================================================================
// CHUNKING
// ============================================================================

function chunkText(text, chunkSize = 5000) {
  const chunks = [];
  const lines = text.split('\n');
  
  let currentChunk = '';
  let currentSession = null;
  let chunkStart = 0;
  
  for (const line of lines) {
    // Check for session marker
    const sessionMatch = line.match(/ישיבה מס['׳]?\s*(\d+)/);
    if (sessionMatch) {
      currentSession = parseInt(sessionMatch[1]);
    }
    
    currentChunk += line + '\n';
    
    // If chunk is big enough, save it
    if (currentChunk.length >= chunkSize) {
      chunks.push({
        text: currentChunk,
        session: currentSession,
        charStart: chunkStart,
        charEnd: chunkStart + currentChunk.length
      });
      chunkStart += currentChunk.length;
      currentChunk = '';
    }
  }
  
  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push({
      text: currentChunk,
      session: currentSession,
      charStart: chunkStart,
      charEnd: chunkStart + currentChunk.length
    });
  }
  
  return chunks;
}

// ============================================================================
// BUILD CONNECTIONS (Co-occurrence)
// ============================================================================

function buildConnections(entities, session) {
  const connections = [];
  
  // Only connect entities with salience > 0.01 (filter noise)
  const significantEntities = entities.filter(e => e.salience > 0.01);
  
  for (let i = 0; i < significantEntities.length; i++) {
    for (let j = i + 1; j < significantEntities.length; j++) {
      const e1 = significantEntities[i];
      const e2 = significantEntities[j];
      
      connections.push({
        source: e1.name,
        target: e2.name,
        sourceType: e1.type,
        targetType: e2.type,
        session: session
      });
    }
  }
  
  return connections;
}

// ============================================================================
// AGGREGATE RESULTS
// ============================================================================

function aggregateResults(chunkResults) {
  const nodeMap = new Map();
  const edgeMap = new Map();
  
  for (const chunk of chunkResults) {
    // Aggregate nodes
    for (const entity of chunk.entities) {
      const key = entity.name;
      if (!nodeMap.has(key)) {
        nodeMap.set(key, {
          id: key,
          name: entity.name,
          type: entity.type,
          englishName: entity.englishName || null,
          totalSalience: 0,
          mentions: 0,
          sessions: new Set(),
          files: new Set()
        });
      }
      const node = nodeMap.get(key);
      node.mentions += 1;
      node.totalSalience += (entity.salience || 0.5);
      if (chunk.session) node.sessions.add(chunk.session);
      if (chunk.file) node.files.add(chunk.file);
      // Keep english name if we find one
      if (entity.englishName && !node.englishName) {
        node.englishName = entity.englishName;
      }
    }
    
    // Aggregate edges
    for (const conn of chunk.connections) {
      const key = [conn.source, conn.target].sort().join('|');
      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          source: conn.source,
          target: conn.target,
          weight: 0,
          sessions: new Set(),
          files: new Set()
        });
      }
      const edge = edgeMap.get(key);
      edge.weight++;
      if (conn.session) edge.sessions.add(conn.session);
      if (chunk.file) edge.files.add(chunk.file);
    }
  }
  
  return {
    nodes: Array.from(nodeMap.values())
      .map(n => ({
        ...n,
        avgSalience: n.totalSalience / n.mentions,
        sessions: [...n.sessions].sort((a, b) => a - b),
        files: [...n.files]
      }))
      .sort((a, b) => b.mentions - a.mentions),
    edges: Array.from(edgeMap.values())
      .map(e => ({
        ...e,
        sessions: [...e.sessions].sort((a, b) => a - b),
        files: [...e.files]
      }))
      .sort((a, b) => b.weight - a.weight)
  };
}

// ============================================================================
// MAIN TEST
// ============================================================================

async function runTest() {
  console.log('='.repeat(60));
  console.log('ENTITY EXTRACTION TEST (2 Volumes)');
  console.log('='.repeat(60));
  
  const allChunkResults = [];
  
  for (const testFile of CONFIG.testFiles) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Processing: ${path.basename(testFile)}`);
    console.log('─'.repeat(60));
    
    // Read file
    const text = await fs.readFile(testFile, 'utf-8');
    console.log(`File size: ${text.length} characters`);
    
    // Chunk the text
    const chunks = chunkText(text, CONFIG.chunkSize);
    console.log(`Created ${chunks.length} chunks`);
    
    // Limit chunks for testing
    const testChunks = chunks.slice(0, CONFIG.maxChunksPerFile);
    console.log(`Testing with first ${testChunks.length} chunks\n`);
    
    for (let i = 0; i < testChunks.length; i++) {
      const chunk = testChunks[i];
      console.log(`  Chunk ${i + 1}/${testChunks.length} (session: ${chunk.session || 'N/A'})...`);
      
      // Extract entities
      const entities = await extractEntities(chunk.text);
      console.log(`    Found ${entities.length} entities`);
      
      // Build connections
      const connections = buildConnections(entities, chunk.session);
      
      allChunkResults.push({
        file: path.basename(testFile),
        chunkIndex: i,
        session: chunk.session,
        entities,
        connections
      });
      
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 300));
    }
  }
  
  // Aggregate results
  console.log('\n' + '='.repeat(60));
  console.log('AGGREGATING RESULTS');
  console.log('='.repeat(60));
  
  const graph = aggregateResults(allChunkResults);
  
  // Print summary
  console.log(`\nTotal unique entities: ${graph.nodes.length}`);
  console.log(`Total connections: ${graph.edges.length}`);
  
  // Show top entities by type
  console.log('\n' + '='.repeat(60));
  console.log('TOP ENTITIES BY TYPE');
  console.log('='.repeat(60));
  
  const byType = {};
  for (const node of graph.nodes) {
    if (!byType[node.type]) byType[node.type] = [];
    byType[node.type].push(node);
  }
  
  for (const [type, nodes] of Object.entries(byType)) {
    console.log(`\n${type} (${nodes.length}):`);
    nodes.slice(0, 5).forEach(n => {
      console.log(`  - ${n.name} (mentions: ${n.mentions}, salience: ${n.avgSalience.toFixed(3)})`);
    });
  }
  
  // Show top connections
  console.log('\n' + '='.repeat(60));
  console.log('TOP CONNECTIONS (by weight)');
  console.log('='.repeat(60));
  
  graph.edges.slice(0, 15).forEach(e => {
    console.log(`  ${e.source} ←→ ${e.target} (weight: ${e.weight})`);
  });
  
  // Save results
  const outputPath = path.join(__dirname, 'entity-graph.json');
  await fs.writeFile(outputPath, JSON.stringify(graph, null, 2), 'utf-8');
  console.log(`\nResults saved to: ${outputPath}`);
  
  return graph;
}

// Run test
runTest().catch(console.error);

