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
  maxChunks: 50,  // Process more for better coverage
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
  console.log(`Loaded ${Object.keys(KEY_FIGURES).length} key figure categories`);
}

// ============================================================================
// WITNESS MATCHING
// ============================================================================
function normalizeHebrew(str) {
  return str
    .replace(/[\u0591-\u05C7]/g, '') // Remove Hebrew diacritics
    .replace(/["'״׳]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchWitness(name) {
  const normalized = normalizeHebrew(name);
  
  // Remove common prefixes
  const cleanName = normalized
    .replace(/^(העד|מר|גברת|ד"ר|דר'|פרופ')\s*/i, '')
    .trim();
  
  for (const witness of WITNESS_INDEX) {
    const witnessNorm = normalizeHebrew(witness.hebrew);
    
    // Exact match
    if (cleanName === witnessNorm) {
      return witness;
    }
    
    // Last name match (for partial references like "בהיר" -> "משה בהיר")
    const witnessLastName = witnessNorm.split(' ').pop();
    if (cleanName === witnessLastName && witnessLastName.length > 2) {
      return witness;
    }
    
    // Contains full name
    if (cleanName.includes(witnessNorm) || witnessNorm.includes(cleanName)) {
      return witness;
    }
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
  const sessions = new Map(); // Track session info
  
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
    
    // Update session end line
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
- PERSON: People mentioned (witnesses, officials, historical figures)
- LOCATION: Places (countries, cities, camps, ghettos)
- ORGANIZATION: Groups (SS, Gestapo, agencies, institutions)
- EVENT: Significant events mentioned
- DATE: Specific dates mentioned

For each PERSON, identify their role if apparent:
- witness (if testifying)
- prosecutor (היועץ המשפטי, בר-אור, האוזנר)
- defense (סרבציוס, the defense attorney)
- judge (אב בית הדין, השופט)
- defendant (אייכמן, הנאשם)
- mentioned (someone talked about in testimony)

Extract 15-25 entities. Include Hebrew names as they appear.`
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
    
    // Process each entity - validate witnesses and key figures
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
      
      // If it's a person, check against official witness list and key figures
      if (entity.type === 'PERSON') {
        const witnessMatch = matchWitness(entity.name);
        const keyFigureMatch = matchKeyFigure(entity.name);
        
        if (witnessMatch) {
          // It's an official witness
          processedEntity.isWitness = true;
          processedEntity.officialName = witnessMatch.english;
          processedEntity.officialHebrew = witnessMatch.hebrew;
          processedEntity.role = 'witness';
        } else if (keyFigureMatch) {
          // It's a key figure (judge, prosecutor, defense, defendant)
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
// CONSOLIDATION
// ============================================================================
function consolidateEntities(rawEntities, sessions) {
  const entityMap = new Map();
  const sessionEntityMap = new Map(); // Track entities per session
  
  // Initialize session tracking
  for (const session of sessions) {
    sessionEntityMap.set(session.number, {
      witnesses: new Set(),
      persons: new Set(),
      locations: new Set(),
      organizations: new Set()
    });
  }
  
  for (const entity of rawEntities) {
    // Determine canonical name
    let canonicalName = entity.officialName || entity.name;
    let canonicalHebrew = entity.officialHebrew || entity.name;
    
    const key = `${entity.type}:${canonicalName}`;
    
    if (!entityMap.has(key)) {
      entityMap.set(key, {
        name: canonicalName,
        hebrewName: canonicalHebrew,
        type: entity.type,
        role: entity.role,
        isWitness: entity.isWitness || false,
        category: entity.category || null,
        variants: new Set([entity.name]),
        contexts: [],
        sessions: new Set(),
        sources: []
      });
    }
    
    const consolidated = entityMap.get(key);
    consolidated.variants.add(entity.name);
    if (entity.context) consolidated.contexts.push(entity.context);
    if (entity.source.session) consolidated.sessions.add(entity.source.session);
    consolidated.sources.push(entity.source);
    
    // Track in session map
    if (entity.source.session && sessionEntityMap.has(entity.source.session)) {
      const sessionData = sessionEntityMap.get(entity.source.session);
      if (entity.isWitness) {
        sessionData.witnesses.add(canonicalName);
      } else if (entity.type === 'PERSON') {
        sessionData.persons.add(canonicalName);
      } else if (entity.type === 'LOCATION') {
        sessionData.locations.add(canonicalName);
      } else if (entity.type === 'ORGANIZATION') {
        sessionData.organizations.add(canonicalName);
      }
    }
  }
  
  // Convert Sets to Arrays and finalize
  const entities = Array.from(entityMap.values()).map(e => ({
    ...e,
    variants: Array.from(e.variants),
    sessions: Array.from(e.sessions).sort((a, b) => a - b),
    contexts: [...new Set(e.contexts)].slice(0, 5),
    mentions: e.sources.length
  }));
  
  // Build session entities
  const sessionEntities = sessions.map(session => {
    const data = sessionEntityMap.get(session.number) || { witnesses: new Set(), persons: new Set(), locations: new Set(), organizations: new Set() };
    return {
      name: `Session ${session.number}`,
      hebrewName: `ישיבה ${session.number}`,
      type: 'SESSION',
      number: session.number,
      lineStart: session.lineStart,
      lineEnd: session.lineEnd,
      witnesses: Array.from(data.witnesses),
      persons: Array.from(data.persons),
      locations: Array.from(data.locations),
      organizations: Array.from(data.organizations)
    };
  });
  
  return { entities, sessionEntities };
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
  console.log('ENTITY EXTRACTOR v3 (With Witness Validation)');
  console.log('═'.repeat(50));
  
  // Load witness index
  await loadWitnessIndex();
  
  // Read file
  const fileName = path.basename(CONFIG.inputFile);
  console.log(`\nFile: ${fileName}`);
  const text = await fs.readFile(CONFIG.inputFile, 'utf-8');
  console.log(`Size: ${(text.length / 1024).toFixed(0)} KB`);
  
  // Chunk with session tracking
  const { chunks: allChunks, sessions } = chunkText(text, CONFIG.chunkSize);
  const chunks = allChunks.slice(0, CONFIG.maxChunks);
  console.log(`Chunks: ${chunks.length} of ${allChunks.length}`);
  console.log(`Sessions found: ${sessions.map(s => s.number).join(', ')}`);
  
  // Extract
  console.log('\n─ Extracting entities ─');
  const rawEntities = await processChunksInParallel(chunks, fileName, CONFIG.parallelBatchSize);
  console.log(`\nTotal raw: ${rawEntities.length}`);
  
  // Consolidate
  console.log('\n─ Consolidating ─');
  const { entities, sessionEntities } = consolidateEntities(rawEntities, sessions);
  
  // Separate witnesses from other entities
  const witnesses = entities.filter(e => e.isWitness);
  const otherEntities = entities.filter(e => !e.isWitness);
  
  console.log(`\nWitnesses (validated): ${witnesses.length}`);
  console.log(`Other entities: ${otherEntities.length}`);
  console.log(`Sessions: ${sessionEntities.length}`);
  
  // Show validated witnesses
  console.log('\n─ Validated Witnesses ─');
  witnesses.forEach(w => {
    console.log(`  - ${w.name} (${w.hebrewName}) - Sessions: ${w.sessions.join(', ')}`);
  });
  
  // Show sessions with their witnesses
  console.log('\n─ Sessions ─');
  sessionEntities.forEach(s => {
    console.log(`  Session ${s.number}: ${s.witnesses.length} witnesses, ${s.locations.length} locations`);
    if (s.witnesses.length > 0) {
      console.log(`    Witnesses: ${s.witnesses.join(', ')}`);
    }
  });
  
  // Save
  const output = {
    metadata: {
      file: fileName,
      generatedAt: new Date().toISOString(),
      chunksProcessed: chunks.length,
      totalEntities: entities.length,
      validatedWitnesses: witnesses.length
    },
    witnesses: witnesses.sort((a, b) => a.name.localeCompare(b.name)),
    sessions: sessionEntities.sort((a, b) => a.number - b.number),
    entities: otherEntities.sort((a, b) => b.mentions - a.mentions)
  };
  
  await fs.writeFile(CONFIG.outputFile, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\nSaved: ${CONFIG.outputFile}`);
  
  console.log('\n═'.repeat(50));
  console.log(`Done in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log('═'.repeat(50));
}

main().catch(console.error);
