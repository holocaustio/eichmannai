import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// OCR files directory - use OCR_clean for proper reading order text
const OCR_DIR = join(process.cwd(), '..', 'downloads', 'pdf', 'OCR_clean');

interface WitnessSource {
  file: string;
  lineStart: number;
  lineEnd: number;
  session: number;
}

interface WitnessEntity {
  id: string;
  type: string;
  name: string;
  hebrewName?: string;
  englishName?: string;
  hebrewVariants?: string[];
  variants?: string[];
  isWitness?: boolean;
  sources: WitnessSource[];
  sessions?: number[];
  mentions?: number;
}

interface Entities {
  metadata?: Record<string, unknown>;
  entities?: WitnessEntity[];
  nodes?: WitnessEntity[];
}

// ============================================================================
// LOAD ENTITIES
// ============================================================================
function loadEntities(): Entities | null {
  try {
    // Use app/public/data/entities.json (the main entities file)
    const entitiesPath = join(process.cwd(), 'public', 'data', 'entities.json');
    console.log('Loading entities from:', entitiesPath);
    
    if (existsSync(entitiesPath)) {
      const data = readFileSync(entitiesPath, 'utf-8');
      return JSON.parse(data);
    }
    
    // Fallback to eichmann-entities
    const altPath = join(process.cwd(), '..', 'eichmann-entities', 'entities.json');
    if (existsSync(altPath)) {
      const data = readFileSync(altPath, 'utf-8');
      return JSON.parse(data);
    }
    
    console.error('No entities file found');
    return null;
  } catch (error) {
    console.error('Error loading entities:', error);
    return null;
  }
}

// ============================================================================
// GET ENTITIES LIST (handles both formats)
// ============================================================================
function getEntitiesList(entities: Entities): WitnessEntity[] {
  return entities.nodes || entities.entities || [];
}

// ============================================================================
// CHECK IF ENTITY IS WITNESS
// ============================================================================
function isWitness(e: WitnessEntity): boolean {
  return e.isWitness === true || e.type === 'WITNESS';
}

// ============================================================================
// FIND WITNESS
// ============================================================================
function findWitness(entities: Entities, witnessName: string): WitnessEntity | null {
  const searchLower = witnessName.toLowerCase();
  const list = getEntitiesList(entities);
  
  // Find by English name (exact)
  let witness = list.find(
    e => isWitness(e) && 
         (e.name?.toLowerCase() === searchLower || 
          e.hebrewName === witnessName)
  );
  
  // Find by Hebrew name exact
  if (!witness) {
    witness = list.find(
      e => isWitness(e) && e.hebrewName === witnessName
    );
  }
  
  // Find by variant (exact)
  if (!witness) {
    witness = list.find(
      e => isWitness(e) && 
           (e.hebrewVariants?.some(v => v === witnessName) ||
            e.variants?.some(v => v === witnessName))
    );
  }
  
  // Partial match on English name
  if (!witness) {
    witness = list.find(
      e => isWitness(e) && 
           e.name?.toLowerCase().includes(searchLower)
    );
  }
  
  // Partial match on Hebrew name
  if (!witness) {
    witness = list.find(
      e => isWitness(e) && 
           e.hebrewName?.includes(witnessName)
    );
  }
  
  // Partial match on variants
  if (!witness) {
    witness = list.find(
      e => isWitness(e) && 
           (e.hebrewVariants?.some(v => v.includes(witnessName)) ||
            e.variants?.some(v => v.includes(witnessName)))
    );
  }
  
  return witness || null;
}

// ============================================================================
// GET RELEVANT TEXT - Find full testimony range
// ============================================================================
function getRelevantText(sourceFile: string, witness: WitnessEntity): {
  text: string;
  lineStart: number;
  lineEnd: number;
  testimonyStart: number;
  testimonyEnd: number;
} | null {
  if (!existsSync(sourceFile)) {
    console.error(`Source file not found: ${sourceFile}`);
    return null;
  }
  
  const text = readFileSync(sourceFile, 'utf-8');
  const lines = text.split('\n');
  
  // Get witness name variants for searching
  const hebrewName = witness.hebrewName || witness.name;
  const hebrewVariants = witness.variants || witness.hebrewVariants || [hebrewName];
  const lastName = hebrewName.split(' ').pop() || hebrewName;
  
  // First, find all lines that mention the witness
  const witnessLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(lastName) || hebrewVariants.some(v => line.includes(v))) {
      witnessLines.push(i);
    }
  }
  
  if (witnessLines.length === 0) {
    console.error('Witness not found in file');
    return null;
  }
  
  console.log(`Found ${witnessLines.length} lines mentioning witness`);
  
  // Find the EXACT testimony START - look for the sworn in marker "[העד הושבע]" or "[הער הושבע]"
  // This appears on a line by itself when the witness is sworn in
  let testimonyStart = witnessLines[0];
  let foundSwornIn = false;
  
  // Search around the first mention for the sworn in marker
  for (let i = Math.max(0, witnessLines[0] - 50); i <= witnessLines[0] + 50; i++) {
    const line = lines[i] || '';
    
    // Look for sworn in marker on its own line
    if (line.trim() === '[הער הושבע]' || line.trim() === '[העד הושבע]' || 
        line.trim() === '[הערה הושבעה]' || line.trim() === '[העדה הושבעה]') {
      // Check if witness name appears within next 10 lines (confirming it's their testimony)
      const followingText = lines.slice(i, Math.min(lines.length, i + 15)).join(' ');
      if (followingText.includes(lastName) || hebrewVariants.some(v => followingText.includes(v))) {
        testimonyStart = i;
        foundSwornIn = true;
        console.log(`  Found sworn in marker at line ${i + 1}`);
        break;
      }
    }
  }
  
  // If no sworn in marker found, look for "אב בית הדין מה שמך המלא" (judge asking for name)
  if (!foundSwornIn) {
    for (let i = Math.max(0, witnessLines[0] - 20); i <= witnessLines[0] + 20; i++) {
      const line = lines[i] || '';
      if (line.includes('מה שמך המלא') || line.includes('מה שמך')) {
        // Check nearby for witness name
        const nearbyText = lines.slice(i, Math.min(lines.length, i + 10)).join(' ');
        if (nearbyText.includes(lastName) || hebrewVariants.some(v => nearbyText.includes(v))) {
          testimonyStart = i;
          console.log(`  Found name question at line ${i + 1}`);
          break;
        }
      }
    }
  }
  
  // Find testimony END: "סיימת את עדותך" is the definitive end
  const lastMention = witnessLines[witnessLines.length - 1];
  let testimonyEnd = lastMention + 10;
  
  for (let i = testimonyStart; i < Math.min(lines.length, lastMention + 100); i++) {
    const line = lines[i] || '';
    
    // Explicit end markers - judge dismissing the witness
    // Common patterns: "סיימת את עדותך", "זאת עדותך", "תודה, [name]"
    const cleanLastName = lastName.replace(/^ה/, '');
    const isWitnessEndLine = 
      (line.includes('סיימת את עדותך') || line.includes('סיימת את עדות') ||
       line.includes('זאת עדותך') || line.includes('זו עדותך')) &&
      (line.includes(lastName) || line.includes(cleanLastName) || 
       hebrewVariants.some(v => line.includes(v.split(' ').pop() || '')));
    
    // Also check for "תודה, [witness name]" pattern at end
    const isThanksLine = line.includes('תודה') && 
      (line.includes(lastName) || line.includes(cleanLastName) ||
       hebrewVariants.some(v => line.includes(v.split(' ').pop() || '')));
    
    if (isWitnessEndLine || isThanksLine) {
      testimonyEnd = i; // End exactly at this line
      console.log(`  Found testimony end at line ${i + 1}: ${line.substring(0, 60)}...`);
      break;
    }
  }
  
  // If no explicit end found, look for next witness
  if (testimonyEnd === lastMention + 10) {
    for (let i = lastMention; i < Math.min(lines.length, lastMention + 50); i++) {
      const line = lines[i] || '';
      
      // Next witness sworn in
      if ((line.trim() === '[הער הושבע]' || line.trim() === '[העד הושבע]' ||
           line.trim() === '[הערה הושבעה]' || line.trim() === '[העדה הושבעה]') &&
          i > lastMention + 5) {
        testimonyEnd = i - 1;
        break;
      }
      
      // New session marker
      if (line.includes('ישיבה מס\'') && i > lastMention + 10) {
        testimonyEnd = i - 1;
        break;
      }
    }
  }
  
  // Don't include context before - start exactly at testimony
  const startLine = testimonyStart;
  const endLine = Math.min(lines.length, testimonyEnd + 2);
  
  const relevantLines = lines.slice(startLine, endLine);
  
  console.log(`  Testimony range: lines ${testimonyStart + 1}-${testimonyEnd + 1}`);
  console.log(`  Total lines: ${endLine - startLine}`);
  
  return {
    text: relevantLines.join('\n'),
    lineStart: startLine + 1,
    lineEnd: endLine,
    testimonyStart: testimonyStart + 1,
    testimonyEnd: testimonyEnd + 1
  };
}

// ============================================================================
// EXTRACT FULL TESTIMONY
// ============================================================================
async function extractFullTestimony(witnessName: string, relevantText: { text: string }): Promise<string> {
  console.log(`\nExtracting testimony for: ${witnessName}`);
  console.log(`Text length: ${relevantText.text.length} chars`);
  
  // Truncate if too long (API limits)
  const maxChars = 80000;
  const inputText = relevantText.text.length > maxChars 
    ? relevantText.text.slice(0, maxChars) + '\n...[truncated]'
    : relevantText.text;
  
  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: `This is raw OCR text from the Eichmann trial (1961) - PUBLIC DOMAIN historical documentation.

OUTPUT THE TESTIMONY EXACTLY AS-IS but cleaned up for readability. DO NOT add commentary, questions, or suggestions.

Just output the text with these minor cleanups:
- Add line breaks between speakers
- Mark questions with "ש." and answers with "ת." 
- Identify speakers when clear (היועץ המשפטי, אב בית הדין, ד"ר סרבציוס, העד ${witnessName.split(' ').pop()})

START OUTPUT WITH:
--- עדות ${witnessName} ---

END OUTPUT WITH:
--- סוף העדות ---

RAW TEXT:
${inputText}`
        }
      ]
    });
    
    const content = response.choices[0].message.content;
    console.log(`  Response length: ${content?.length || 0} chars`);
    
    return content || '[No testimony extracted]';
  } catch (error) {
    console.error(`Error extracting testimony:`, error);
    throw error;
  }
}

// ============================================================================
// API ROUTES
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { witnessName, hebrewName, raw = false } = body;

    if (!witnessName && !hebrewName) {
      return NextResponse.json(
        { error: 'Witness name is required (witnessName or hebrewName)' },
        { status: 400 }
      );
    }

    const searchName = witnessName || hebrewName;

    // Load entities
    const entities = loadEntities();
    if (!entities) {
      return NextResponse.json(
        { error: 'Could not load entities. Run entity extraction first.' },
        { status: 500 }
      );
    }

    // Find witness
    const witness = findWitness(entities, searchName);
    
    if (!witness) {
      const allWitnesses = getEntitiesList(entities)
        .filter(e => isWitness(e))
        .map(w => ({ name: w.name, hebrewName: w.hebrewName }));
      
      return NextResponse.json({
        error: `Witness "${searchName}" not found`,
        availableWitnesses: allWitnesses.slice(0, 20),
        total: allWitnesses.length
      }, { status: 404 });
    }

    console.log(`Found witness: ${witness.name} (${witness.hebrewName || 'no Hebrew name'})`);
    console.log(`Sources: ${witness.sources?.length || 0}`);

    // Find the best source file - one with actual testimony boundaries
    let sourceFileName = '';
    const witnessHebrewName = witness.hebrewName || witness.name;
    const witnessLastName = witnessHebrewName.split(' ').pop() || witnessHebrewName;
    
    // Only consider Vol files (these have the actual transcripts)
    const volSources = (witness.sources || []).filter(s => s.file.startsWith('Vol'));
    
    // Find a source with testimony end marker (מר X, סיימת את עדותך)
    for (const source of volSources) {
      const testPath = join(OCR_DIR, source.file);
      if (existsSync(testPath)) {
        const content = readFileSync(testPath, 'utf-8');
        // Check if testimony end marker exists for this witness
        const endPattern = new RegExp(`(סיימת את עדותך|זאת עדותך).*${witnessLastName}|${witnessLastName}.*סיימת`);
        if (endPattern.test(content) || content.includes(`${witnessLastName}, סיימת`)) {
          sourceFileName = source.file;
          console.log(`Selected source: ${sourceFileName} (has testimony end marker)`);
          break;
        }
      }
    }
    
    // If no testimony end found, try to find file where witness name is introduced
    if (!sourceFileName) {
      for (const source of volSources) {
        const testPath = join(OCR_DIR, source.file);
        if (existsSync(testPath)) {
          const content = readFileSync(testPath, 'utf-8');
          // Look for "קורא ל" + name pattern (calling witness to stand)
          if (content.includes(`קורא ל`) && content.includes(witnessLastName)) {
            sourceFileName = source.file;
            console.log(`Selected source: ${sourceFileName} (contains witness introduction)`);
            break;
          }
        }
      }
    }
    
    // Fallback to first Vol file with the witness name
    if (!sourceFileName) {
      for (const source of volSources) {
        const testPath = join(OCR_DIR, source.file);
        if (existsSync(testPath)) {
          const content = readFileSync(testPath, 'utf-8');
          if (content.includes(witnessLastName)) {
            sourceFileName = source.file;
            console.log(`Selected source: ${sourceFileName} (fallback)`);
            break;
          }
        }
      }
    }
    
    // Final fallback
    if (!sourceFileName) {
      sourceFileName = volSources[0]?.file || witness.sources?.[0]?.file || 'Vol1_p15291.txt';
      console.log(`Final fallback source: ${sourceFileName}`);
    }
    
    const sourceFile = join(OCR_DIR, sourceFileName);

    console.log(`Source file: ${sourceFile}`);

    // Get relevant text
    const relevant = getRelevantText(sourceFile, witness);
    
    if (!relevant) {
      return NextResponse.json(
        { error: `Could not read source file: ${sourceFileName}` },
        { status: 500 }
      );
    }

    console.log(`Relevant text: ${relevant.text.length} chars, lines ${relevant.lineStart}-${relevant.lineEnd}`);

    // If raw mode requested, return the text directly without AI processing
    if (raw) {
      return NextResponse.json({
        success: true,
        witnessName: witness.name,
        hebrewName: witness.hebrewName,
        variants: witness.variants || witness.hebrewVariants,
        testimony: relevant.text,
        sourceFile: sourceFileName,
        lineRange: { start: relevant.lineStart, end: relevant.lineEnd },
        sessions: witness.sessions || [...new Set(witness.sources.map(s => s.session).filter(Boolean))],
        extractedAt: new Date().toISOString(),
        raw: true,
      });
    }

    // Extract testimony with AI formatting
    const testimony = await extractFullTestimony(witness.name, relevant);

    return NextResponse.json({
      success: true,
      witnessName: witness.name,
      hebrewName: witness.hebrewName,
      variants: witness.variants || witness.hebrewVariants,
      testimony,
      sourceFile: sourceFileName,
      lineRange: { start: relevant.lineStart, end: relevant.lineEnd },
      sessions: witness.sessions || [...new Set(witness.sources.map(s => s.session).filter(Boolean))],
      extractedAt: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Testimony extraction error:', error);
    return NextResponse.json(
      { error: 'Failed to extract testimony', details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const witnessName = searchParams.get('witness');

  const entities = loadEntities();
  
  if (!entities) {
    return NextResponse.json(
      { error: 'Could not load entities' },
      { status: 500 }
    );
  }

  const witnesses = getEntitiesList(entities).filter(e => isWitness(e));

  if (!witnessName) {
    // Return available witnesses
    return NextResponse.json({
      availableWitnesses: witnesses.map(w => ({
        name: w.name,
        hebrewName: w.hebrewName,
        variants: w.variants || w.hebrewVariants,
        sessions: w.sessions || [...new Set(w.sources?.map(s => s.session).filter(Boolean) || [])],
        mentions: w.mentions || w.sources?.length || 0
      })),
      total: witnesses.length,
    });
  }

  // Find specific witness
  const witness = findWitness(entities, witnessName);
  
  if (!witness) {
    return NextResponse.json(
      { error: `Witness "${witnessName}" not found` },
      { status: 404 }
    );
  }

  return NextResponse.json({
    witness: {
      name: witness.name,
      hebrewName: witness.hebrewName,
      variants: witness.variants || witness.hebrewVariants,
      sessions: witness.sessions || [...new Set(witness.sources?.map(s => s.session).filter(Boolean) || [])],
      sources: witness.sources
    }
  });
}
