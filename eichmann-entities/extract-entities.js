import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// CONFIG
// ============================================================================
const CONFIG = {
  inputFile: path.join(__dirname, 'test-file.txt'),
  outputFile: path.join(__dirname, 'entities.json'),
  witnessIndexFile: path.join(__dirname, 'witness-index.json'),
  chunkSize: 5000,
  maxChunks: 50,
  parallelBatchSize: 5,
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// ============================================================================
// LOAD WITNESS INDEX
// ============================================================================
let WITNESS_INDEX = null;
let KEY_FIGURES = null;

async function loadWitnessIndex() {
  const data = await fs.readFile(CONFIG.witnessIndexFile, 'utf-8');
  const index = JSON.parse(data);
  
  WITNESS_INDEX = index.witnesses;
  KEY_FIGURES = index.keyFigures;
  
  console.log(`Loaded ${WITNESS_INDEX.length} official witnesses`);
}

// ============================================================================
// ID GENERATION
// ============================================================================
function generateId(name, type) {
  // Create a URL-safe ID from name
  return `${type.toLowerCase()}-${name.toLowerCase().replace(/[^a-z0-9א-ת]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}`;
}

// ============================================================================
// WITNESS MATCHING
// ============================================================================
function normalizeHebrew(str) {
  return str
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/["'״׳]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchWitness(name) {
  const normalized = normalizeHebrew(name);
  const cleanName = normalized.replace(/^(העד|מר|גברת|ד"ר|דר'|פרופ')\s*/i, '').trim();
  
  for (const witness of WITNESS_INDEX) {
    const witnessNorm = normalizeHebrew(witness.hebrew);
    
    if (cleanName === witnessNorm) return witness;
    
    const witnessLastName = witnessNorm.split(' ').pop();
    if (cleanName === witnessLastName && witnessLastName.length > 2) return witness;
    
    if (cleanName.includes(witnessNorm) || witnessNorm.includes(cleanName)) return witness;
  }
  
  return null;
}

function matchKeyFigure(name) {
  const normalized = normalizeHebrew(name);
  const cleanName = normalized.replace(/^(העד|מר|גברת|ד"ר|דר'|פרופ')\s*/i, '').trim();
  
  for (const [category, figures] of Object.entries(KEY_FIGURES)) {
    for (const figure of figures) {
      const figureNorm = normalizeHebrew(figure.hebrew);
      const variants = figure.variants || [];
      
      if (cleanName === figureNorm || 
          cleanName.includes(figureNorm) || 
          figureNorm.includes(cleanName) ||
          variants.some(v => normalizeHebrew(v) === cleanName || cleanName.includes(normalizeHebrew(v)))) {
        return { ...figure, category };
      }
    }
  }
  
  return null;
}

// ============================================================================
// CHUNKING WITH SESSION TRACKING
// ============================================================================
function chunkText(text, chunkSize) {
  const lines = text.split('\n');
  const chunks = [];
  const sessions = new Map();
  
  let currentChunk = '';
  let chunkStartLine = 1;
  let currentLine = 1;
  let currentSession = null;
  
  for (const line of lines) {
    const sessionMatch = line.match(/ישיבה מס['׳]?\s*(\d+)/);
    if (sessionMatch) {
      const sessionNum = parseInt(sessionMatch[1]);
      if (!sessions.has(sessionNum)) {
        sessions.set(sessionNum, {
          number: sessionNum,
          lineStart: currentLine,
          lineEnd: currentLine
        });
      }
      currentSession = sessionNum;
    }
    
    if (currentSession && sessions.has(currentSession)) {
      sessions.get(currentSession).lineEnd = currentLine;
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
  
  return { chunks, sessions: Array.from(sessions.values()) };
}

// ============================================================================
// ENTITY EXTRACTION
// ============================================================================
async function extractEntitiesFromChunk(chunk, fileName) {
  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      reasoning_effort: 'low',
      messages: [
        {
          role: 'system',
          content: `Extract entities from this Eichmann trial transcript.

Entity types:
- PERSON: People mentioned
- LOCATION: Places (countries, cities, camps, ghettos)
- ORGANIZATION: Groups (SS, Gestapo, agencies)
- EVENT: Significant events
- DATE: Specific dates

For PERSON, identify role: witness, prosecutor, defense, judge, defendant, mentioned

Extract 15-25 entities with Hebrew names as they appear.`
        },
        {
          role: 'user',
          content: chunk.text.slice(0, 4500)
        }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'entities',
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
                    role: { type: ['string', 'null'] },
                    context: { type: ['string', 'null'] }
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
    
    const processedEntities = [];
    
    for (const entity of result.entities || []) {
      let processedEntity = {
        ...entity,
        source: {
          file: fileName,
          lineStart: chunk.lineStart,
          lineEnd: chunk.lineEnd,
          session: chunk.session
        }
      };
      
      if (entity.type === 'PERSON') {
        const witnessMatch = matchWitness(entity.name);
        const keyFigureMatch = matchKeyFigure(entity.name);
        
        if (witnessMatch) {
          processedEntity.isWitness = true;
          processedEntity.officialName = witnessMatch.english;
          processedEntity.officialHebrew = witnessMatch.hebrew;
          processedEntity.role = 'witness';
        } else if (keyFigureMatch) {
          processedEntity.isWitness = false;
          processedEntity.officialName = keyFigureMatch.english;
          processedEntity.officialHebrew = keyFigureMatch.hebrew;
          processedEntity.role = keyFigureMatch.role;
          processedEntity.category = keyFigureMatch.category;
        }
      }
      
      processedEntities.push(processedEntity);
    }
    
    return processedEntities;
  } catch (error) {
    console.error(`  Chunk error:`, error.message);
    return [];
  }
}

// ============================================================================
// BUILD GRAPH STRUCTURE
// ============================================================================
function buildGraph(rawEntities, sessions) {
  const nodeMap = new Map();
  const edgeMap = new Map();
  const chunkEntities = new Map(); // Track entities per chunk for edge building
  
  // First pass: build nodes and track chunk co-occurrences
  for (const entity of rawEntities) {
    const canonicalName = entity.officialName || entity.name;
    const canonicalHebrew = entity.officialHebrew || entity.name;
    const id = generateId(canonicalName, entity.type);
    
    // Track entities per chunk for edge building
    const chunkKey = `${entity.source.file}:${entity.source.lineStart}`;
    if (!chunkEntities.has(chunkKey)) {
      chunkEntities.set(chunkKey, { entities: new Set(), session: entity.source.session });
    }
    chunkEntities.get(chunkKey).entities.add(id);
    
    // Build/update node
    if (!nodeMap.has(id)) {
      nodeMap.set(id, {
        id: id,
        name: canonicalName,
        hebrewName: canonicalHebrew,
        type: entity.type,
        role: entity.role || null,
        isWitness: entity.isWitness || false,
        category: entity.category || null,
        variants: new Set([entity.name]),
        contexts: [],
        sessions: new Set(),
        mentions: 0,
        sources: []
      });
    }
    
    const node = nodeMap.get(id);
    node.variants.add(entity.name);
    if (canonicalHebrew !== canonicalName) node.variants.add(canonicalHebrew);
    if (entity.context) node.contexts.push(entity.context);
    if (entity.source.session) node.sessions.add(entity.source.session);
    node.mentions++;
    node.sources.push(entity.source);
  }
  
  // Second pass: build edges from co-occurrences
  for (const [chunkKey, chunkData] of chunkEntities) {
    const entityIds = Array.from(chunkData.entities);
    const session = chunkData.session;
    
    // Create edges between all pairs of entities in the same chunk
    for (let i = 0; i < entityIds.length; i++) {
      for (let j = i + 1; j < entityIds.length; j++) {
        const [source, target] = [entityIds[i], entityIds[j]].sort();
        const edgeKey = `${source}|${target}`;
        
        if (!edgeMap.has(edgeKey)) {
          edgeMap.set(edgeKey, {
            source: source,
            target: target,
            weight: 0,
            sessions: new Set()
          });
        }
        
        const edge = edgeMap.get(edgeKey);
        edge.weight++;
        if (session) edge.sessions.add(session);
      }
    }
  }
  
  // Convert to arrays and finalize
  const nodes = Array.from(nodeMap.values()).map(node => ({
    ...node,
    variants: Array.from(node.variants),
    sessions: Array.from(node.sessions).sort((a, b) => a - b),
    contexts: [...new Set(node.contexts)].slice(0, 5)
  }));
  
  const edges = Array.from(edgeMap.values()).map(edge => ({
    ...edge,
    sessions: Array.from(edge.sessions).sort((a, b) => a - b)
  }));
  
  // Build session nodes
  const sessionNodes = sessions.map(session => {
    // Find all entity IDs in this session
    const sessionEntityIds = new Set();
    for (const node of nodes) {
      if (node.sessions.includes(session.number)) {
        sessionEntityIds.add(node.id);
      }
    }
    
    const witnesses = nodes.filter(n => n.isWitness && n.sessions.includes(session.number)).map(n => n.id);
    const locations = nodes.filter(n => n.type === 'LOCATION' && n.sessions.includes(session.number)).map(n => n.id);
    const organizations = nodes.filter(n => n.type === 'ORGANIZATION' && n.sessions.includes(session.number)).map(n => n.id);
    const persons = nodes.filter(n => n.type === 'PERSON' && !n.isWitness && n.sessions.includes(session.number)).map(n => n.id);
    
    return {
      id: `session-${session.number}`,
      name: `Session ${session.number}`,
      hebrewName: `ישיבה ${session.number}`,
      type: 'SESSION',
      number: session.number,
      lineStart: session.lineStart,
      lineEnd: session.lineEnd,
      entityCount: sessionEntityIds.size,
      witnessIds: witnesses,
      locationIds: locations,
      organizationIds: organizations,
      personIds: persons
    };
  });
  
  return { nodes, edges, sessions: sessionNodes };
}

// ============================================================================
// PARALLEL PROCESSING
// ============================================================================
async function processChunksInParallel(chunks, fileName, batchSize) {
  const allEntities = [];
  
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(chunks.length / batchSize);
    
    console.log(`  Batch ${batchNum}/${totalBatches}...`);
    
    const promises = batch.map(chunk => extractEntitiesFromChunk(chunk, fileName));
    const results = await Promise.all(promises);
    
    const batchEntities = results.flat();
    allEntities.push(...batchEntities);
    
    console.log(`    Found ${batchEntities.length} entities`);
    
    if (i + batchSize < chunks.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  return allEntities;
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  const startTime = Date.now();
  
  console.log('═'.repeat(50));
  console.log('ENTITY EXTRACTOR v4 (Graph Structure)');
  console.log('═'.repeat(50));
  
  await loadWitnessIndex();
  
  const fileName = path.basename(CONFIG.inputFile);
  console.log(`\nFile: ${fileName}`);
  const text = await fs.readFile(CONFIG.inputFile, 'utf-8');
  console.log(`Size: ${(text.length / 1024).toFixed(0)} KB`);
  
  const { chunks: allChunks, sessions } = chunkText(text, CONFIG.chunkSize);
  const chunks = allChunks.slice(0, CONFIG.maxChunks);
  console.log(`Chunks: ${chunks.length} of ${allChunks.length}`);
  console.log(`Sessions: ${sessions.map(s => s.number).join(', ')}`);
  
  console.log('\n─ Extracting entities ─');
  const rawEntities = await processChunksInParallel(chunks, fileName, CONFIG.parallelBatchSize);
  console.log(`\nTotal raw: ${rawEntities.length}`);
  
  console.log('\n─ Building graph ─');
  const graph = buildGraph(rawEntities, sessions);
  
  // Separate witnesses for easy access
  const witnessNodes = graph.nodes.filter(n => n.isWitness);
  const otherNodes = graph.nodes.filter(n => !n.isWitness);
  
  console.log(`\nNodes: ${graph.nodes.length}`);
  console.log(`  - Witnesses: ${witnessNodes.length}`);
  console.log(`  - Other: ${otherNodes.length}`);
  console.log(`Edges: ${graph.edges.length}`);
  console.log(`Sessions: ${graph.sessions.length}`);
  
  // Show witnesses
  console.log('\n─ Validated Witnesses ─');
  witnessNodes.slice(0, 10).forEach(w => {
    console.log(`  - ${w.name} (${w.hebrewName}) [${w.id}]`);
  });
  if (witnessNodes.length > 10) {
    console.log(`  ... and ${witnessNodes.length - 10} more`);
  }
  
  // Show top edges
  console.log('\n─ Top Connections ─');
  graph.edges.sort((a, b) => b.weight - a.weight).slice(0, 10).forEach(e => {
    console.log(`  ${e.source} <-> ${e.target} (weight: ${e.weight})`);
  });
  
  // Build final output
  const output = {
    metadata: {
      file: fileName,
      generatedAt: new Date().toISOString(),
      chunksProcessed: chunks.length,
      totalNodes: graph.nodes.length,
      totalEdges: graph.edges.length,
      validatedWitnesses: witnessNodes.length
    },
    nodes: graph.nodes.sort((a, b) => b.mentions - a.mentions),
    edges: graph.edges.sort((a, b) => b.weight - a.weight),
    sessions: graph.sessions.sort((a, b) => a.number - b.number)
  };
  
  await fs.writeFile(CONFIG.outputFile, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\nSaved: ${CONFIG.outputFile}`);
  
  console.log('\n═'.repeat(50));
  console.log(`Done in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log('═'.repeat(50));
}

main().catch(console.error);
