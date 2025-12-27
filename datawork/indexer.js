import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';

// Configuration
const OCR_DIR = './downloads/pdf/OCR';
const OUTPUT_FILE = './trial-index.json';

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ============================================================================
// REGEX PATTERNS for Hebrew legal documents
// ============================================================================

const PATTERNS = {
  // Session markers: ישיבה מס' 1, ישיבה מס' 90
  session: /ישיבה מס['׳]?\s*(\d+)/g,
  
  // Testimony patterns (masculine/feminine, start/continue)
  testimonyStart: /עדותו של\s+(.+?)(?:\s*\.\.\.|$|\n|;)/g,
  testimonyStartFem: /עדותה של\s+(.+?)(?:\s*\.\.\.|$|\n|;)/g,
  continueTestimony: /המשך עדותו של\s+(.+?)(?:\s*\.\.\.|$|\n|;)/g,
  continueTestimonyFem: /המשך עדותה של\s+(.+?)(?:\s*\.\.\.|$|\n|;)/g,
  endTestimony: /סיום עדותו של\s+(.+?)(?:\s*\.\.\.|$|\n|;)/g,
  endTestimonyFem: /סיום עדותה של\s+(.+?)(?:\s*\.\.\.|$|\n|;)/g,
  
  // Document submissions
  documentSubmission: /הגשת מסמכים\s+(.+?)(?:\s*\.\.\.|$|\n)/g,
  
  // Decisions
  decision: /החלטה\s+(.+?)(?:\s*\.\.\.|$|\n)/g,
  
  // Discussions
  discussion: /דיון\s+(.+?)(?:\s*\.\.\.|$|\n)/g,
  
  // Cross-examination of defendant
  defendantExam: /חקירת הנאשם\s+(.+?)(?:\s*\.\.\.|$|\n)/g,
  
  // Band markers for Eichmann's statements (Vol5/Vol6)
  bandMarker: /Band No\.(\d+),\s*S\.\s*(\d+)/g,
};

// ============================================================================
// FILE MAPPING: Parse filename to understand content range
// ============================================================================

function parseFilename(filename) {
  const basename = path.basename(filename, '.txt');
  
  // Summary files
  if (basename.includes('_summary')) {
    const volMatch = basename.match(/vol(\d+)_summary/i);
    return {
      type: 'summary',
      volume: volMatch ? parseInt(volMatch[1]) : null,
      description: `Volume ${volMatch?.[1]} Summary`
    };
  }
  
  // Vol5/Vol6 band files (Eichmann's statements)
  if (basename.match(/Vol[56]_band/i)) {
    const match = basename.match(/Vol(\d+)_band(\d+)/i);
    return {
      type: 'eichmann_statement',
      volume: match ? parseInt(match[1]) : null,
      band: match ? parseInt(match[2]) : null,
      description: `Eichmann Statement - Volume ${match?.[1]}, Band ${match?.[2]}`
    };
  }
  
  // Session range files like vol3_p90100 or Vol1_p114
  const sessionMatch = basename.match(/[Vv]ol(\d+)_p(\d+)/i);
  if (sessionMatch) {
    const volume = parseInt(sessionMatch[1]);
    const rangeStr = sessionMatch[2];
    
    // Parse range: "114" = 1-14, "90100" = 90-100, "15291" = 15-29 (vol1 specific)
    let startSession, endSession;
    
    if (rangeStr.length <= 2) {
      startSession = 1;
      endSession = parseInt(rangeStr);
    } else if (rangeStr.length === 3) {
      startSession = parseInt(rangeStr[0]);
      endSession = parseInt(rangeStr.slice(1));
    } else if (rangeStr.length === 4) {
      startSession = parseInt(rangeStr.slice(0, 2));
      endSession = parseInt(rangeStr.slice(2));
    } else if (rangeStr.length === 5) {
      // Could be 15-29 (15291) or similar
      startSession = parseInt(rangeStr.slice(0, 2));
      endSession = parseInt(rangeStr.slice(2, 4));
    } else if (rangeStr.length === 6) {
      startSession = parseInt(rangeStr.slice(0, 3));
      endSession = parseInt(rangeStr.slice(3));
    }
    
    return {
      type: 'trial_sessions',
      volume,
      sessionStart: startSession,
      sessionEnd: endSession,
      description: `Volume ${volume}, Sessions ${startSession}-${endSession}`
    };
  }
  
  // Special files
  const specialFiles = {
    'testimonies': { type: 'testimonies_list', description: 'List of all testimonies' },
    'summaries': { type: 'summaries', description: 'General summaries' },
    'claims1': { type: 'claims', part: 1, description: 'Claims Part 1' },
    'claims2': { type: 'claims', part: 2, description: 'Claims Part 2' },
    'claims3': { type: 'claims', part: 3, description: 'Claims Part 3' },
    'concluding-remarks': { type: 'conclusion', description: 'Concluding Remarks' },
    'eichmann_judgement_11-12-1961': { type: 'judgement', description: 'Final Judgement (Dec 11, 1961)' },
    'list': { type: 'list', description: 'General List' },
    'The Eichmann Trial': { type: 'overview', description: 'Trial Overview' },
    'vol1_part3': { type: 'trial_sessions', volume: 1, part: 3, description: 'Volume 1 Part 3' },
  };
  
  return specialFiles[basename] || { type: 'unknown', description: basename };
}

// ============================================================================
// CLEAN WITNESS NAME: Remove noise and validate
// ============================================================================

function cleanWitnessName(rawName, strict = false) {
  if (!rawName) return null;
  
  let name = rawName.trim();
  
  // Remove trailing punctuation and common noise
  name = name.replace(/[\.\,\;\:\!\?\(\)\[\]]+$/, '').trim();
  
  // Remove "העד" prefix if present
  name = name.replace(/^העד\s+/, '').trim();
  
  // Common noise words that indicate this is not a name
  const noiseWords = [
    ' של ', ' על ', ' את ', ' לא ', ' אם ', ' או ', ' כי ', ' זה ', 
    ' היה ', ' טעונה ', ' דרושה ', ' מיום ', ' בנירנברג', ' בעניין ',
    ' לקבל ', ' נוספת', ' בדיקה', ' נגבתה'
  ];
  
  for (const noise of noiseWords) {
    if (name.includes(noise)) {
      // Try to extract just the first part before the noise
      const idx = name.indexOf(noise);
      if (idx > 3) {
        name = name.substring(0, idx).trim();
      } else {
        return null;
      }
    }
  }
  
  // Clean up again after extraction
  name = name.replace(/[\.\,\;\:\!\?\(\)\[\]]+$/, '').trim();
  
  // In strict mode (for non-summary files), be more restrictive
  if (strict && name.length > 40) {
    return null;
  }
  
  // Valid Hebrew name pattern: should contain Hebrew letters and be reasonable length
  const hebrewPattern = /[\u0590-\u05FF]/;
  if (!hebrewPattern.test(name) || name.length < 3 || name.length > 60) {
    return null;
  }
  
  return name;
}

// ============================================================================
// EXTRACT EVENTS from file content
// ============================================================================

function extractEvents(content, filename) {
  const events = [];
  const lines = content.split('\n');
  
  // Summary files have cleaner data - use less strict validation
  const isSummaryFile = filename.includes('_summary');
  const strictMode = !isSummaryFile;
  
  let currentSession = null;
  
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    
    // Check for session marker - must be at start of line or standalone
    const sessionMatch = line.match(/^ישיבה מס['׳]?\s*(\d+)/);
    if (sessionMatch) {
      currentSession = parseInt(sessionMatch[1]);
      events.push({
        type: 'session_start',
        session: currentSession,
        lineNumber: lineNum + 1,
        text: line.trim()
      });
      continue;
    }
    
    // Check for testimony start (masculine) - improved pattern
    // Look for pattern at START of line only in summaries
    const testimonyMatch = line.match(/^עדותו של\s+([\u0590-\u05FF\s\-'״"\.]+)/);
    if (testimonyMatch) {
      const witnessName = cleanWitnessName(testimonyMatch[1], strictMode);
      if (witnessName) {
        events.push({
          type: 'testimony_start',
          gender: 'male',
          witnessName,
          session: currentSession,
          lineNumber: lineNum + 1,
          text: line.trim()
        });
      }
      continue;
    }
    
    // Check for testimony start (feminine)
    const testimonyFemMatch = line.match(/^עדותה של\s+([\u0590-\u05FF\s\-'״"\.]+)/);
    if (testimonyFemMatch) {
      const witnessName = cleanWitnessName(testimonyFemMatch[1], strictMode);
      if (witnessName) {
        events.push({
          type: 'testimony_start',
          gender: 'female',
          witnessName,
          session: currentSession,
          lineNumber: lineNum + 1,
          text: line.trim()
        });
      }
      continue;
    }
    
    // Check for continued testimony (masculine)
    const contMatch = line.match(/^המשך עדותו של\s+([\u0590-\u05FF\s\-'״"\.]+)/);
    if (contMatch) {
      const witnessName = cleanWitnessName(contMatch[1], strictMode);
      if (witnessName) {
        events.push({
          type: 'testimony_continue',
          gender: 'male',
          witnessName,
          session: currentSession,
          lineNumber: lineNum + 1,
          text: line.trim()
        });
      }
      continue;
    }
    
    // Check for continued testimony (feminine)
    const contFemMatch = line.match(/^המשך עדותה של\s+([\u0590-\u05FF\s\-'״"\.]+)/);
    if (contFemMatch) {
      const witnessName = cleanWitnessName(contFemMatch[1], strictMode);
      if (witnessName) {
        events.push({
          type: 'testimony_continue',
          gender: 'female',
          witnessName,
          session: currentSession,
          lineNumber: lineNum + 1,
          text: line.trim()
        });
      }
      continue;
    }
    
    // Check for end of testimony
    const endMatch = line.match(/^סיום עדותו של\s+([\u0590-\u05FF\s\-'״"\.]+)/);
    if (endMatch) {
      const witnessName = cleanWitnessName(endMatch[1], strictMode);
      if (witnessName) {
        events.push({
          type: 'testimony_end',
          gender: 'male',
          witnessName,
          session: currentSession,
          lineNumber: lineNum + 1,
          text: line.trim()
        });
      }
      continue;
    }
    
    const endFemMatch = line.match(/^סיום עדותה של\s+([\u0590-\u05FF\s\-'״"\.]+)/);
    if (endFemMatch) {
      const witnessName = cleanWitnessName(endFemMatch[1], strictMode);
      if (witnessName) {
        events.push({
          type: 'testimony_end',
          gender: 'female',
          witnessName,
          session: currentSession,
          lineNumber: lineNum + 1,
          text: line.trim()
        });
      }
      continue;
    }
    
    // Check for defendant examination (at start of line)
    const examMatch = line.match(/^חקירת הנאשם\s+([\u0590-\u05FF\s\-'״"]+)/);
    if (examMatch) {
      events.push({
        type: 'defendant_examination',
        topic: examMatch[1].trim().slice(0, 100),
        session: currentSession,
        lineNumber: lineNum + 1,
        text: line.trim().slice(0, 150)
      });
      continue;
    }
    
    // Check for document submission (at start of line)
    const docMatch = line.match(/^הגשת מסמכים\s+([\u0590-\u05FF\s\-'״"]+)/);
    if (docMatch) {
      events.push({
        type: 'document_submission',
        topic: docMatch[1].trim().slice(0, 100),
        session: currentSession,
        lineNumber: lineNum + 1,
        text: line.trim().slice(0, 150)
      });
      continue;
    }
    
    // Check for decisions (at start of line)
    const decisionMatch = line.match(/^החלטה\s+([\u0590-\u05FF\s\-'״"]+)/);
    if (decisionMatch) {
      events.push({
        type: 'decision',
        topic: decisionMatch[1].trim().slice(0, 100),
        session: currentSession,
        lineNumber: lineNum + 1,
        text: line.trim().slice(0, 150)
      });
      continue;
    }
    
    // Check for Band markers (Eichmann statements)
    const bandMatch = line.match(/Band No\.(\d+),\s*S\.\s*(\d+)/);
    if (bandMatch) {
      events.push({
        type: 'band_marker',
        band: parseInt(bandMatch[1]),
        page: parseInt(bandMatch[2]),
        lineNumber: lineNum + 1,
        text: line.trim()
      });
    }
  }
  
  return events;
}

// ============================================================================
// EXTRACT WITNESSES from events
// ============================================================================

function extractWitnesses(events) {
  const witnessMap = new Map();
  
  for (const event of events) {
    if (event.witnessName) {
      const name = event.witnessName;
      if (!witnessMap.has(name)) {
        witnessMap.set(name, {
          name,
          gender: event.gender,
          appearances: []
        });
      }
      witnessMap.get(name).appearances.push({
        type: event.type,
        session: event.session,
        lineNumber: event.lineNumber
      });
    }
  }
  
  return Array.from(witnessMap.values());
}

// ============================================================================
// NORMALIZE NAMES using OpenAI (batched)
// ============================================================================

async function normalizeWitnessNamesBatch(names) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a Hebrew name normalization expert for the Eichmann trial.
Given a list of witness names, return a JSON object with a "witnesses" array.
For each unique person, provide:
- canonical: The best/most complete Hebrew spelling
- variants: Array of variant spellings from input that refer to same person
- title: Any title (ד"ר, פרופסור, רב, עו"ד, etc.) or null
- englishName: English transliteration or null

Group duplicate names (same person, different spellings) together.
Return: {"witnesses": [...]}`
        },
        {
          role: 'user',
          content: `Normalize these witness names:\n${names.join('\n')}`
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 4000
    });
    
    const result = JSON.parse(response.choices[0].message.content);
    return result.witnesses || [];
  } catch (error) {
    console.error(`    Batch failed: ${error.message}`);
    return null;
  }
}

async function normalizeWitnessNames(witnesses) {
  if (witnesses.length === 0) return [];
  
  const names = [...new Set(witnesses.map(w => w.name))]; // Unique names only
  const BATCH_SIZE = 50;
  const batches = [];
  
  for (let i = 0; i < names.length; i += BATCH_SIZE) {
    batches.push(names.slice(i, i + BATCH_SIZE));
  }
  
  console.log(`  Processing ${names.length} unique names in ${batches.length} batches...`);
  
  const allNormalized = [];
  
  for (let i = 0; i < batches.length; i++) {
    console.log(`    Batch ${i + 1}/${batches.length} (${batches[i].length} names)...`);
    const result = await normalizeWitnessNamesBatch(batches[i]);
    if (result) {
      allNormalized.push(...result);
    }
    // Small delay to avoid rate limiting
    if (i < batches.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  console.log(`  Normalized to ${allNormalized.length} unique witnesses`);
  return allNormalized;
}

// ============================================================================
// PROCESS A SINGLE FILE
// ============================================================================

async function processFile(filepath) {
  const filename = path.basename(filepath);
  console.log(`Processing: ${filename}`);
  
  const content = await fs.readFile(filepath, 'utf-8');
  const fileInfo = parseFilename(filename);
  const events = extractEvents(content, filename);
  const witnesses = extractWitnesses(events);
  
  // Get line count
  const lineCount = content.split('\n').length;
  
  // Get sessions found in this file
  const sessions = [...new Set(events.filter(e => e.session).map(e => e.session))].sort((a, b) => a - b);
  
  return {
    filename,
    filepath: filepath.replace(/\\/g, '/'),
    ...fileInfo,
    lineCount,
    sessions,
    eventCount: events.length,
    events,
    witnesses,
    witnessCount: witnesses.length
  };
}

// ============================================================================
// BUILD SESSION TO FILE MAPPING
// ============================================================================

function buildSessionFileMapping(files) {
  const mapping = {};
  
  for (const file of files) {
    if (file.type === 'trial_sessions' && file.sessionStart && file.sessionEnd) {
      for (let s = file.sessionStart; s <= file.sessionEnd; s++) {
        if (!mapping[s]) {
          mapping[s] = [];
        }
        mapping[s].push({
          file: file.filename,
          volume: file.volume,
          lineCount: file.lineCount
        });
      }
    }
  }
  
  return mapping;
}

// ============================================================================
// MAIN: Build complete index
// ============================================================================

async function buildIndex() {
  console.log('='.repeat(60));
  console.log('EICHMANN TRIAL INDEXER');
  console.log('='.repeat(60));
  
  // Get all OCR files
  const files = await fs.readdir(OCR_DIR);
  const txtFiles = files.filter(f => f.endsWith('.txt')).sort();
  
  console.log(`Found ${txtFiles.length} files to process\n`);
  
  const index = {
    metadata: {
      createdAt: new Date().toISOString(),
      totalFiles: txtFiles.length,
      description: 'Index of the Adolf Eichmann Trial records'
    },
    files: [],
    witnesses: [],
    witnessesFromSummaries: [], // High quality data from summaries only
    sessions: {},
    sessionFileMapping: {},
    volumes: {}
  };
  
  // Process all files
  for (const file of txtFiles) {
    const filepath = path.join(OCR_DIR, file);
    const fileData = await processFile(filepath);
    index.files.push(fileData);
    
    const isSummary = file.includes('_summary');
    
    // Aggregate witnesses
    for (const witness of fileData.witnesses) {
      const appearance = {
        ...witness.appearances[0],
        file: file,
        source: isSummary ? 'summary' : 'content'
      };
      
      const existing = index.witnesses.find(w => w.name === witness.name);
      if (existing) {
        existing.appearances.push(appearance);
      } else {
        index.witnesses.push({
          ...witness,
          appearances: [appearance]
        });
      }
      
      // Also add to high-quality list if from summary
      if (isSummary) {
        const existingSummary = index.witnessesFromSummaries.find(w => w.name === witness.name);
        if (existingSummary) {
          existingSummary.appearances.push(appearance);
        } else {
          index.witnessesFromSummaries.push({
            ...witness,
            appearances: [appearance]
          });
        }
      }
    }
    
    // Aggregate sessions
    for (const session of fileData.sessions) {
      if (!index.sessions[session]) {
        index.sessions[session] = {
          sessionNumber: session,
          files: [],
          events: [],
          summaryEvents: [] // High quality events from summaries
        };
      }
      index.sessions[session].files.push(file);
      
      const sessionEvents = fileData.events.filter(e => e.session === session).map(e => ({
        ...e,
        file: file,
        source: isSummary ? 'summary' : 'content'
      }));
      
      index.sessions[session].events.push(...sessionEvents);
      
      if (isSummary) {
        index.sessions[session].summaryEvents.push(...sessionEvents);
      }
    }
    
    // Aggregate by volume
    if (fileData.volume) {
      if (!index.volumes[fileData.volume]) {
        index.volumes[fileData.volume] = {
          volume: fileData.volume,
          files: [],
          type: fileData.type
        };
      }
      index.volumes[fileData.volume].files.push(file);
    }
  }
  
  // Build session to file mapping
  index.sessionFileMapping = buildSessionFileMapping(index.files);
  
  // Normalize witness names with OpenAI - use summary witnesses for better quality
  console.log('\n' + '='.repeat(60));
  console.log('NORMALIZING WITNESS NAMES');
  console.log('='.repeat(60));
  
  if (index.witnessesFromSummaries.length > 0) {
    console.log(`  Using ${index.witnessesFromSummaries.length} high-quality witness names from summaries`);
    const normalizedNames = await normalizeWitnessNames(index.witnessesFromSummaries);
    index.normalizedWitnesses = normalizedNames;
  }
  
  // Calculate statistics
  index.metadata.totalWitnesses = index.witnessesFromSummaries.length;
  index.metadata.totalWitnessesRaw = index.witnesses.length;
  index.metadata.totalSessions = Object.keys(index.sessions).length;
  index.metadata.totalVolumes = Object.keys(index.volumes).length;
  index.metadata.totalEvents = index.files.reduce((sum, f) => sum + f.eventCount, 0);
  
  // Sort sessions
  index.sessions = Object.fromEntries(
    Object.entries(index.sessions).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
  );
  
  // Create a navigation structure for the web UI
  index.navigation = {
    byVolume: {},
    bySession: {},
    byWitness: {}
  };
  
  // Build navigation by volume
  for (const [vol, data] of Object.entries(index.volumes)) {
    index.navigation.byVolume[vol] = {
      ...data,
      sessions: Object.entries(index.sessionFileMapping)
        .filter(([_, maps]) => maps.some(m => m.volume === parseInt(vol)))
        .map(([session]) => parseInt(session))
        .sort((a, b) => a - b)
    };
  }
  
  // Build navigation by session
  for (const [session, data] of Object.entries(index.sessions)) {
    const witnesses = data.summaryEvents
      .filter(e => e.witnessName)
      .map(e => ({
        name: e.witnessName,
        type: e.type,
        gender: e.gender
      }));
    
    index.navigation.bySession[session] = {
      sessionNumber: parseInt(session),
      files: index.sessionFileMapping[session] || [],
      witnesses,
      eventTypes: [...new Set(data.summaryEvents.map(e => e.type))]
    };
  }
  
  // Build navigation by witness
  for (const witness of index.witnessesFromSummaries) {
    index.navigation.byWitness[witness.name] = {
      name: witness.name,
      gender: witness.gender,
      sessions: [...new Set(witness.appearances.map(a => a.session).filter(Boolean))].sort((a, b) => a - b),
      files: [...new Set(witness.appearances.map(a => a.file))]
    };
  }
  
  // Write output
  console.log('\n' + '='.repeat(60));
  console.log('WRITING INDEX');
  console.log('='.repeat(60));
  
  // Write full index
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(index, null, 2), 'utf-8');
  console.log(`Full index written to: ${OUTPUT_FILE}`);
  
  // Create a lighter web-optimized version
  const webIndex = {
    metadata: index.metadata,
    navigation: index.navigation,
    normalizedWitnesses: index.normalizedWitnesses,
    files: index.files.map(f => ({
      filename: f.filename,
      type: f.type,
      description: f.description,
      volume: f.volume,
      lineCount: f.lineCount,
      sessions: f.sessions,
      witnessCount: f.witnessCount,
      eventCount: f.eventCount
    })),
    sessionFileMapping: index.sessionFileMapping
  };
  
  const webOutputFile = './trial-index-web.json';
  await fs.writeFile(webOutputFile, JSON.stringify(webIndex, null, 2), 'utf-8');
  console.log(`Web-optimized index written to: ${webOutputFile}`);
  
  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Files processed: ${index.metadata.totalFiles}`);
  console.log(`Total witnesses (from summaries): ${index.metadata.totalWitnesses}`);
  console.log(`Total witnesses (all sources): ${index.metadata.totalWitnessesRaw}`);
  console.log(`Total sessions: ${index.metadata.totalSessions}`);
  console.log(`Total events: ${index.metadata.totalEvents}`);
  console.log(`Volumes: ${Object.keys(index.volumes).join(', ')}`);
  
  return index;
}

// Run
buildIndex().catch(console.error);

