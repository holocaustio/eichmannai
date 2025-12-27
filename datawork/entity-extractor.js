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
  // Single volume for testing
  testFile: path.join(__dirname, 'downloads/pdf/OCR/Vol1_p114.txt'),
  chunkSize: 4000,
  maxChunks: 15,        // Test with 15 chunks
  parallelBatchSize: 5, // Process 5 chunks in parallel
};

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
console.log(`Using model: ${OPENAI_MODEL}`);

// ============================================================================
// ENTITY EXTRACTION
// ============================================================================

async function extractEntities(text, chunkIndex) {
  try {
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      reasoning_effort: 'low',
      messages: [
        {
          role: 'system',
          content: `Extract named entities from this Eichmann trial text (Hebrew).

Entity types:
- PERSON: people (witnesses, officials, victims, defendants)
- LOCATION: places (countries, cities, camps, ghettos)
- ORGANIZATION: groups (SS units, departments, agencies)
- EVENT: events (operations, conferences)
- DATE: dates

Extract 10-15 most important entities. Use the exact name as it appears in the text.`
        },
        {
          role: 'user',
          content: text.slice(0, 3500)
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
                    type: { type: 'string', enum: ['PERSON', 'LOCATION', 'ORGANIZATION', 'EVENT', 'DATE'] }
                  },
                  required: ['name', 'type'],
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
    return result.entities || [];
  } catch (error) {
    console.error(`  Chunk ${chunkIndex} error:`, error.message);
    return [];
  }
}

// ============================================================================
// CONSOLIDATION - Merge duplicate entities
// ============================================================================

async function consolidateEntityType(type, names) {
  try {
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      reasoning_effort: 'low',
      messages: [
        {
          role: 'system',
          content: `Merge duplicate ${type} entities. Keep all unique ones. Only merge same entity with different spellings.
Examples of merges:
- אייכמן = אדולף אייכמן (same person)
- ד"ר סרבציוס = דר סרבציוס (same spelling)
- United States = ארצות הברית (same place, different language)

DO NOT merge different entities. Return ALL unique entities.`
        },
        {
          role: 'user',
          content: `Merge duplicates from these ${names.length} ${type} names:\n${names.join('\n')}`
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
    return (result.entities || []).map(e => ({ ...e, type }));
  } catch (error) {
    console.error(`    ${type} consolidation error:`, error.message);
    // Fallback: return as-is
    return names.map(name => ({ canonical: name, englishName: name, type, variants: [name] }));
  }
}

async function consolidateEntities(entities) {
  console.log('\n  Consolidating entities by type...');
  
  // Group by type
  const byType = {};
  for (const entity of entities) {
    if (!byType[entity.type]) byType[entity.type] = new Set();
    byType[entity.type].add(entity.name);
  }
  
  // Convert to arrays and log counts
  for (const type of Object.keys(byType)) {
    byType[type] = [...byType[type]];
    console.log(`    ${type}: ${byType[type].length} unique`);
  }
  
  // Consolidate each type in parallel
  const types = Object.keys(byType);
  const promises = types.map(type => consolidateEntityType(type, byType[type]));
  const results = await Promise.all(promises);
  
  // Flatten results
  const consolidated = results.flat();
  
  return consolidated;
}

// ============================================================================
// CHUNKING
// ============================================================================

function chunkText(text, chunkSize = 4000) {
  const chunks = [];
  const lines = text.split('\n');
  
  let currentChunk = '';
  let currentSession = null;
  
  for (const line of lines) {
    const sessionMatch = line.match(/ישיבה מס['׳]?\s*(\d+)/);
    if (sessionMatch) {
      currentSession = parseInt(sessionMatch[1]);
    }
    
    currentChunk += line + '\n';
    
    if (currentChunk.length >= chunkSize) {
      chunks.push({ text: currentChunk, session: currentSession });
      currentChunk = '';
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push({ text: currentChunk, session: currentSession });
  }
  
  return chunks;
}

// ============================================================================
// BUILD GRAPH with consolidated entities
// ============================================================================

function buildGraph(chunkResults, consolidatedEntities) {
  // Create variant → canonical mapping
  const variantMap = new Map();
  for (const entity of consolidatedEntities) {
    for (const variant of entity.variants) {
      variantMap.set(variant, entity.canonical);
    }
    variantMap.set(entity.canonical, entity.canonical);
  }
  
  // Create entity info map
  const entityInfo = new Map();
  for (const entity of consolidatedEntities) {
    entityInfo.set(entity.canonical, {
      name: entity.canonical,
      englishName: entity.englishName,
      type: entity.type,
      variants: entity.variants
    });
  }
  
  // Build nodes and edges
  const nodeMap = new Map();
  const edgeMap = new Map();
  
  for (const chunk of chunkResults) {
    // Get canonical names for this chunk's entities
    const canonicalNames = new Set();
    for (const entity of chunk.entities) {
      const canonical = variantMap.get(entity.name);
      if (canonical) {
        canonicalNames.add(canonical);
        
        // Update node
        if (!nodeMap.has(canonical)) {
          const info = entityInfo.get(canonical) || { name: canonical, type: entity.type };
          nodeMap.set(canonical, {
            id: canonical,
            ...info,
            mentions: 0,
            sessions: new Set()
          });
        }
        nodeMap.get(canonical).mentions++;
        if (chunk.session) nodeMap.get(canonical).sessions.add(chunk.session);
      }
    }
    
    // Build edges between entities in same chunk
    const names = [...canonicalNames];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const key = [names[i], names[j]].sort().join('|');
        if (!edgeMap.has(key)) {
          edgeMap.set(key, { source: names[i], target: names[j], weight: 0, sessions: new Set() });
        }
        edgeMap.get(key).weight++;
        if (chunk.session) edgeMap.get(key).sessions.add(chunk.session);
      }
    }
  }
  
  return {
    nodes: Array.from(nodeMap.values())
      .map(n => ({ ...n, sessions: [...n.sessions].sort((a, b) => a - b) }))
      .sort((a, b) => b.mentions - a.mentions),
    edges: Array.from(edgeMap.values())
      .map(e => ({ ...e, sessions: [...e.sessions].sort((a, b) => a - b) }))
      .sort((a, b) => b.weight - a.weight)
  };
}

// ============================================================================
// PARALLEL PROCESSING
// ============================================================================

async function processInParallel(chunks, batchSize) {
  const results = [];
  
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(chunks.length / batchSize);
    
    console.log(`  Batch ${batchNum}/${totalBatches} (${batch.length} chunks in parallel)...`);
    
    const promises = batch.map((chunk, idx) => 
      extractEntities(chunk.text, i + idx + 1)
        .then(entities => ({ 
          chunkIndex: i + idx, 
          session: chunk.session, 
          entities 
        }))
    );
    
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
    
    // Log batch results
    const totalEntities = batchResults.reduce((sum, r) => sum + r.entities.length, 0);
    console.log(`    → Found ${totalEntities} entities`);
    
    // Small delay between batches
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
  console.log('='.repeat(60));
  console.log('ENTITY EXTRACTION (Single Volume Test)');
  console.log('='.repeat(60));
  
  // Read file
  console.log(`\nReading: ${path.basename(CONFIG.testFile)}`);
  const text = await fs.readFile(CONFIG.testFile, 'utf-8');
  console.log(`File size: ${(text.length / 1024).toFixed(0)} KB`);
  
  // Chunk
  const allChunks = chunkText(text, CONFIG.chunkSize);
  const chunks = allChunks.slice(0, CONFIG.maxChunks);
  console.log(`Processing ${chunks.length} of ${allChunks.length} chunks`);
  
  // Extract entities in parallel
  console.log('\n' + '─'.repeat(60));
  console.log('PHASE 1: Parallel Entity Extraction');
  console.log('─'.repeat(60));
  
  const startTime = Date.now();
  const chunkResults = await processInParallel(chunks, CONFIG.parallelBatchSize);
  
  // Collect all raw entities
  const allEntities = [];
  for (const result of chunkResults) {
    allEntities.push(...result.entities);
  }
  console.log(`\nTotal raw entities: ${allEntities.length}`);
  console.log(`Extraction time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  
  // Consolidate
  console.log('\n' + '─'.repeat(60));
  console.log('PHASE 2: Entity Consolidation');
  console.log('─'.repeat(60));
  
  const consolidated = await consolidateEntities(allEntities);
  
  if (!consolidated) {
    console.log('Consolidation failed, using raw entities');
    return;
  }
  
  console.log(`\nConsolidated to ${consolidated.length} unique entities`);
  
  // Show consolidation results
  console.log('\n' + '─'.repeat(60));
  console.log('CONSOLIDATION RESULTS');
  console.log('─'.repeat(60));
  
  const byType = {};
  for (const e of consolidated) {
    if (!byType[e.type]) byType[e.type] = [];
    byType[e.type].push(e);
  }
  
  for (const [type, entities] of Object.entries(byType)) {
    console.log(`\n${type} (${entities.length}):`);
    entities.slice(0, 5).forEach(e => {
      const variants = e.variants.length > 1 ? ` [variants: ${e.variants.slice(0, 3).join(', ')}${e.variants.length > 3 ? '...' : ''}]` : '';
      console.log(`  - ${e.canonical} (${e.englishName})${variants}`);
    });
  }
  
  // Build graph
  console.log('\n' + '─'.repeat(60));
  console.log('PHASE 3: Building Graph');
  console.log('─'.repeat(60));
  
  const graph = buildGraph(chunkResults, consolidated);
  
  console.log(`\nNodes: ${graph.nodes.length}`);
  console.log(`Edges: ${graph.edges.length}`);
  
  // Top connections
  console.log('\nTop connections:');
  graph.edges.slice(0, 10).forEach(e => {
    console.log(`  ${e.source} ←→ ${e.target} (weight: ${e.weight})`);
  });
  
  // Save
  const outputPath = path.join(__dirname, 'entity-graph.json');
  await fs.writeFile(outputPath, JSON.stringify(graph, null, 2), 'utf-8');
  console.log(`\nSaved to: ${outputPath}`);
  
  console.log('\n' + '='.repeat(60));
  console.log(`Total time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log('='.repeat(60));
}

main().catch(console.error);

