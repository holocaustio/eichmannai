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
  testFile: path.join(__dirname, 'downloads/pdf/OCR/Vol2_p6575.txt'),
  chunkSize: 4000,
  maxChunks: 30,           // Process more chunks for better coverage
  parallelBatchSize: 5,
  excerptLines: 10,        // Lines of context to store per source
};

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
console.log(`Using model: ${OPENAI_MODEL}`);

// ============================================================================
// CHUNKING WITH LINE TRACKING
// ============================================================================

function chunkTextWithLines(text, chunkSize = 4000) {
  const chunks = [];
  const lines = text.split('\n');
  
  let currentChunk = '';
  let chunkStartLine = 1;
  let currentLine = 1;
  let currentSession = null;
  
  for (const line of lines) {
    // Track session numbers
    const sessionMatch = line.match(/ישיבה מס['׳]?\s*(\d+)/);
    if (sessionMatch) {
      currentSession = parseInt(sessionMatch[1]);
    }
    
    currentChunk += line + '\n';
    
    if (currentChunk.length >= chunkSize) {
      chunks.push({
        text: currentChunk,
        lineStart: chunkStartLine,
        lineEnd: currentLine,
        session: currentSession
      });
      currentChunk = '';
      chunkStartLine = currentLine + 1;
    }
    
    currentLine++;
  }
  
  if (currentChunk.trim()) {
    chunks.push({
      text: currentChunk,
      lineStart: chunkStartLine,
      lineEnd: currentLine - 1,
      session: currentSession
    });
  }
  
  return { chunks, lines };
}

// ============================================================================
// ENTITY EXTRACTION WITH CONTEXT
// ============================================================================

async function extractEntitiesWithContext(chunkText, chunkMeta, fileName) {
  try {
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      reasoning_effort: 'low',
      messages: [
        {
          role: 'system',
          content: `Extract entities from this Eichmann trial text.

For each entity, determine:
- name: Exact name as it appears
- type: PERSON, LOCATION, ORGANIZATION, EVENT, DATE
- role: For PERSON - witness, prosecutor, defense, judge, defendant, mentioned (someone talked about)
- context: What is this entity doing/being discussed (1 sentence)

Extract 10-20 most important entities. Focus on people who speak or are discussed.`
        },
        {
          role: 'user',
          content: chunkText.slice(0, 3500)
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
                    name: { type: 'string' },
                    type: { type: 'string', enum: ['PERSON', 'LOCATION', 'ORGANIZATION', 'EVENT', 'DATE'] },
                    role: { type: 'string' },
                    context: { type: 'string' }
                  },
                  required: ['name', 'type', 'role', 'context'],
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
    
    const result = JSON.parse(response.choices[0].message.content);
    
    // Add source information to each entity
    return (result.entities || []).map(entity => ({
      ...entity,
      source: {
        file: fileName,
        lineStart: chunkMeta.lineStart,
        lineEnd: chunkMeta.lineEnd,
        session: chunkMeta.session,
        excerpt: chunkText.slice(0, 500) // First 500 chars as excerpt
      }
    }));
  } catch (error) {
    console.error(`  Chunk error:`, error.message);
    return [];
  }
}

// ============================================================================
// CONSOLIDATION
// ============================================================================

async function consolidateEntityType(type, entities) {
  // Group by name first
  const byName = {};
  for (const e of entities) {
    if (!byName[e.name]) byName[e.name] = [];
    byName[e.name].push(e);
  }
  
  const uniqueNames = Object.keys(byName);
  if (uniqueNames.length === 0) return [];
  
  try {
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      reasoning_effort: 'low',
      messages: [
        {
          role: 'system',
          content: `Merge duplicate ${type} entities. Only merge if they are clearly the same entity with different spellings.

Examples:
- אייכמן = אדולף אייכמן (same person)
- ד"ר סרבציוס = דר סרבציוס = Dr. Servatius (same person)
- United States = ארצות הברית (same place)

Return ALL unique entities. Do not over-merge.`
        },
        {
          role: 'user',
          content: `Consolidate these ${uniqueNames.length} ${type} names:\n${uniqueNames.join('\n')}`
        }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'consolidation',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              entities: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    canonical: { type: 'string' },
                    englishName: { type: 'string' },
                    variants: { type: 'array', items: { type: 'string' } }
                  },
                  required: ['canonical', 'englishName', 'variants'],
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
    
    const result = JSON.parse(response.choices[0].message.content);
    
    // Merge sources for consolidated entities
    return (result.entities || []).map(consolidated => {
      // Collect all sources from all variants
      const allSources = [];
      const allRoles = new Set();
      const allContexts = [];
      
      for (const variant of consolidated.variants) {
        if (byName[variant]) {
          for (const entity of byName[variant]) {
            allSources.push(entity.source);
            if (entity.role) allRoles.add(entity.role);
            if (entity.context) allContexts.push(entity.context);
          }
        }
      }
      
      return {
        ...consolidated,
        type,
        roles: [...allRoles],
        contexts: [...new Set(allContexts)].slice(0, 5), // Top 5 unique contexts
        sources: allSources
      };
    });
  } catch (error) {
    console.error(`  ${type} consolidation error:`, error.message);
    // Fallback: return as-is with sources
    return uniqueNames.map(name => ({
      canonical: name,
      englishName: name,
      type,
      variants: [name],
      roles: [...new Set(byName[name].map(e => e.role).filter(Boolean))],
      contexts: byName[name].map(e => e.context).filter(Boolean).slice(0, 3),
      sources: byName[name].map(e => e.source)
    }));
  }
}

async function consolidateAllEntities(rawEntities) {
  console.log('\n  Consolidating entities by type...');
  
  // Group by type
  const byType = {};
  for (const entity of rawEntities) {
    if (!byType[entity.type]) byType[entity.type] = [];
    byType[entity.type].push(entity);
  }
  
  for (const type of Object.keys(byType)) {
    console.log(`    ${type}: ${byType[type].length} raw mentions`);
  }
  
  // Consolidate each type in parallel
  const types = Object.keys(byType);
  const promises = types.map(type => consolidateEntityType(type, byType[type]));
  const results = await Promise.all(promises);
  
  return results.flat();
}

// ============================================================================
// BUILD GRAPH WITH SOURCES
// ============================================================================

function buildGraphWithSources(consolidatedEntities, allLines, fileName) {
  const nodes = [];
  const edges = [];
  
  // Create nodes with expanded source content
  for (const entity of consolidatedEntities) {
    // Expand sources with actual line content
    const expandedSources = entity.sources.map(source => {
      // Get actual lines from file
      const startIdx = Math.max(0, source.lineStart - 1);
      const endIdx = Math.min(allLines.length, source.lineEnd);
      const sourceLines = allLines.slice(startIdx, endIdx);
      
      return {
        file: source.file,
        lineStart: source.lineStart,
        lineEnd: source.lineEnd,
        session: source.session,
        text: sourceLines.join('\n').slice(0, 1000) // First 1000 chars
      };
    });
    
    nodes.push({
      id: entity.canonical,
      name: entity.canonical,
      englishName: entity.englishName,
      type: entity.type,
      variants: entity.variants,
      roles: entity.roles,
      contexts: entity.contexts,
      mentions: entity.sources.length,
      sessions: [...new Set(entity.sources.map(s => s.session).filter(Boolean))].sort((a, b) => a - b),
      sources: expandedSources
    });
  }
  
  // Build edges based on co-occurrence in same source
  const sourceToEntities = new Map();
  for (const entity of consolidatedEntities) {
    for (const source of entity.sources) {
      const key = `${source.file}:${source.lineStart}`;
      if (!sourceToEntities.has(key)) sourceToEntities.set(key, new Set());
      sourceToEntities.get(key).add(entity.canonical);
    }
  }
  
  const edgeMap = new Map();
  for (const entities of sourceToEntities.values()) {
    const arr = [...entities];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = [arr[i], arr[j]].sort().join('|');
        edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
      }
    }
  }
  
  for (const [key, weight] of edgeMap) {
    const [source, target] = key.split('|');
    edges.push({ source, target, weight });
  }
  
  return {
    metadata: {
      file: fileName,
      generatedAt: new Date().toISOString(),
      totalNodes: nodes.length,
      totalEdges: edges.length
    },
    nodes: nodes.sort((a, b) => b.mentions - a.mentions),
    edges: edges.sort((a, b) => b.weight - a.weight)
  };
}

// ============================================================================
// PARALLEL PROCESSING
// ============================================================================

async function processInParallel(chunks, fileName, batchSize) {
  const results = [];
  
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(chunks.length / batchSize);
    
    console.log(`  Batch ${batchNum}/${totalBatches} (${batch.length} chunks)...`);
    
    const promises = batch.map(chunk => 
      extractEntitiesWithContext(chunk.text, chunk, fileName)
    );
    
    const batchResults = await Promise.all(promises);
    const allEntities = batchResults.flat();
    results.push(...allEntities);
    
    console.log(`    → Found ${allEntities.length} entity mentions`);
    
    if (i + batchSize < chunks.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  return results;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const startTime = Date.now();
  
  console.log('='.repeat(60));
  console.log('ENTITY EXTRACTOR V2 (With Source Pointers)');
  console.log('='.repeat(60));
  
  // Read file
  const fileName = path.basename(CONFIG.testFile);
  console.log(`\nReading: ${fileName}`);
  const text = await fs.readFile(CONFIG.testFile, 'utf-8');
  console.log(`File size: ${(text.length / 1024).toFixed(0)} KB`);
  
  // Chunk with line tracking
  const { chunks: allChunks, lines: allLines } = chunkTextWithLines(text, CONFIG.chunkSize);
  const chunks = allChunks.slice(0, CONFIG.maxChunks);
  console.log(`Processing ${chunks.length} of ${allChunks.length} chunks`);
  console.log(`Total lines: ${allLines.length}`);
  
  // Phase 1: Extract entities
  console.log('\n' + '─'.repeat(60));
  console.log('PHASE 1: Entity Extraction with Context');
  console.log('─'.repeat(60));
  
  const rawEntities = await processInParallel(chunks, fileName, CONFIG.parallelBatchSize);
  console.log(`\nTotal raw entity mentions: ${rawEntities.length}`);
  
  // Phase 2: Consolidate
  console.log('\n' + '─'.repeat(60));
  console.log('PHASE 2: Entity Consolidation');
  console.log('─'.repeat(60));
  
  const consolidated = await consolidateAllEntities(rawEntities);
  console.log(`\nConsolidated to ${consolidated.length} unique entities`);
  
  // Phase 3: Build graph with sources
  console.log('\n' + '─'.repeat(60));
  console.log('PHASE 3: Building Graph with Sources');
  console.log('─'.repeat(60));
  
  const graph = buildGraphWithSources(consolidated, allLines, fileName);
  
  console.log(`\nNodes: ${graph.nodes.length}`);
  console.log(`Edges: ${graph.edges.length}`);
  
  // Show sample entities with sources
  console.log('\n' + '─'.repeat(60));
  console.log('SAMPLE ENTITIES WITH SOURCES');
  console.log('─'.repeat(60));
  
  const samples = graph.nodes.slice(0, 5);
  for (const node of samples) {
    console.log(`\n${node.name} (${node.type})`);
    console.log(`  English: ${node.englishName}`);
    console.log(`  Roles: ${node.roles.join(', ')}`);
    console.log(`  Mentions: ${node.mentions}`);
    console.log(`  Sessions: ${node.sessions.join(', ')}`);
    console.log(`  Sources: ${node.sources.length}`);
    if (node.sources[0]) {
      console.log(`  First source: lines ${node.sources[0].lineStart}-${node.sources[0].lineEnd}`);
    }
  }
  
  // Save
  const outputPath = path.join(__dirname, 'entity-graph-v2.json');
  await fs.writeFile(outputPath, JSON.stringify(graph, null, 2), 'utf-8');
  console.log(`\nSaved to: ${outputPath}`);
  
  console.log('\n' + '='.repeat(60));
  console.log(`Total time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log('='.repeat(60));
}

main().catch(console.error);

