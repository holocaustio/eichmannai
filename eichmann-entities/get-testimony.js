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
  entitiesFile: path.join(__dirname, 'entities.json'),
  sourceFile: path.join(__dirname, 'test-file.txt'),
  outputDir: __dirname,
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// ============================================================================
// LOAD ENTITIES
// ============================================================================
async function loadEntities() {
  const data = await fs.readFile(CONFIG.entitiesFile, 'utf-8');
  return JSON.parse(data);
}

// ============================================================================
// FIND WITNESS
// ============================================================================
function findWitness(entities, witnessName) {
  const searchLower = witnessName.toLowerCase();
  
  // Find by English name (exact)
  let witness = entities.entities.find(
    e => e.type === 'WITNESS' && 
         (e.englishName?.toLowerCase() === searchLower || e.name === witnessName)
  );
  
  // Find by Hebrew variant (exact)
  if (!witness) {
    witness = entities.entities.find(
      e => e.type === 'WITNESS' && 
           e.hebrewVariants?.some(v => v === witnessName)
    );
  }
  
  // Partial match on English name
  if (!witness) {
    witness = entities.entities.find(
      e => e.type === 'WITNESS' && 
           e.englishName?.toLowerCase().includes(searchLower)
    );
  }
  
  // Partial match on Hebrew variants
  if (!witness) {
    witness = entities.entities.find(
      e => e.type === 'WITNESS' && 
           e.hebrewVariants?.some(v => v.includes(witnessName))
    );
  }
  
  // Last resort: partial on name
  if (!witness) {
    witness = entities.entities.find(
      e => e.type === 'WITNESS' && e.name.includes(witnessName)
    );
  }
  
  return witness;
}

// ============================================================================
// GET RELEVANT TEXT - Find full testimony range
// ============================================================================
async function getRelevantText(sourceFile, witness) {
  const text = await fs.readFile(sourceFile, 'utf-8');
  const lines = text.split('\n');
  
  // Get initial line range from sources
  let minLine = Infinity;
  let maxLine = 0;
  
  for (const source of witness.sources) {
    minLine = Math.min(minLine, source.lineStart);
    maxLine = Math.max(maxLine, source.lineEnd);
  }
  
  // Get witness name variants for searching
  const witnessName = witness.name;
  const hebrewVariants = witness.hebrewVariants || [witnessName];
  
  // Search for testimony start: look for "[העד הושבע]" or witness being called
  let testimonyStart = minLine;
  for (let i = Math.max(0, minLine - 100); i < minLine + 50; i++) {
    const line = lines[i] || '';
    // Look for sworn in marker
    if (line.includes('הושבע') || line.includes('הער הושבע')) {
      testimonyStart = i;
      break;
    }
    // Look for witness being called
    for (const variant of hebrewVariants) {
      if (line.includes(variant) && (line.includes('אבקש') || line.includes('קורא'))) {
        testimonyStart = i;
        break;
      }
    }
  }
  
  // Search for testimony end: look for next witness or session change
  let testimonyEnd = maxLine;
  for (let i = maxLine; i < Math.min(lines.length, maxLine + 500); i++) {
    const line = lines[i] || '';
    
    // End markers: next witness sworn in, or explicit end
    if (i > maxLine + 50) { // After initial range
      if (line.includes('הושבע') || line.includes('הער הושבע')) {
        testimonyEnd = i - 1;
        break;
      }
      // New witness being called (not our witness)
      if ((line.includes('אבקש את') || line.includes('קורא ל')) && 
          !hebrewVariants.some(v => line.includes(v))) {
        testimonyEnd = i - 1;
        break;
      }
      // Session end
      if (line.includes('נעילת הישיבה') || line.includes('הישיבה נסגרת')) {
        testimonyEnd = i;
        break;
      }
    }
  }
  
  // Expand a bit for context
  const startLine = Math.max(0, testimonyStart - 20);
  const endLine = Math.min(lines.length, testimonyEnd + 20);
  
  const relevantLines = lines.slice(startLine, endLine);
  
  console.log(`  Testimony range: lines ${testimonyStart}-${testimonyEnd}`);
  console.log(`  Expanded range: lines ${startLine + 1}-${endLine}`);
  
  return {
    text: relevantLines.join('\n'),
    lineStart: startLine + 1,
    lineEnd: endLine,
    testimonyStart,
    testimonyEnd
  };
}

// ============================================================================
// EXTRACT FULL TESTIMONY
// ============================================================================
async function extractFullTestimony(witnessName, relevantText) {
  console.log(`\nExtracting testimony for: ${witnessName}`);
  console.log(`Text length: ${relevantText.text.length} chars`);
  
  // Truncate if too long (API limits)
  const maxChars = 50000;
  const inputText = relevantText.text.length > maxChars 
    ? relevantText.text.slice(0, maxChars) + '\n...[truncated]'
    : relevantText.text;
  
  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: `You are extracting the complete testimony of witness "${witnessName}" from the Eichmann trial transcript.

Find and extract:
1. When the witness is called to testify (sworn in - look for "[העד הושבע]" or "אבקש את מר...")
2. ALL questions (ש.) asked to this witness
3. ALL answers (ת.) given by this witness
4. When the testimony ends (next witness or session ends)

Format output as:
---
WITNESS: [name]
SESSION: [number]
---

[The judge/prosecutor] Question text...

[Witness] Answer text...

[Continue for all Q&A]
---
END OF TESTIMONY
---

Include the questioner when identified:
- היועץ המשפטי / מר בר-אור (Attorney General)
- אב בית הדין (Presiding Judge)  
- ד"ר סרבציוס (Defense)

Extract the COMPLETE testimony. Do not summarize.`
        },
        {
          role: 'user',
          content: `Extract the complete testimony of "${witnessName}" from this transcript:\n\n${inputText}`
        }
      ]
    });
    
    const content = response.choices[0].message.content;
    console.log(`  Response length: ${content?.length || 0} chars`);
    
    return content || '[No testimony extracted]';
  } catch (error) {
    console.error(`Error extracting testimony: ${error.message}`);
    return `[Error: ${error.message}]`;
  }
}

// ============================================================================
// LIST WITNESSES
// ============================================================================
async function listWitnesses() {
  const entities = await loadEntities();
  
  const witnesses = entities.entities.filter(e => e.type === 'WITNESS');
  
  console.log('\n═'.repeat(50));
  console.log('AVAILABLE WITNESSES');
  console.log('═'.repeat(50));
  
  if (witnesses.length === 0) {
    console.log('No witnesses found in entities.json');
    console.log('Run extract-entities.js first.');
    return;
  }
  
  witnesses.forEach((w, i) => {
    const sessions = [...new Set(w.sources.map(s => s.session).filter(Boolean))];
    const englishName = w.englishName || w.name;
    const hebrewVariants = w.hebrewVariants || [w.name];
    
    console.log(`\n${i + 1}. ${englishName}`);
    console.log(`   Hebrew: ${hebrewVariants.join(', ')}`);
    console.log(`   Mentions: ${w.sources.length}`);
    console.log(`   Sessions: ${sessions.join(', ') || 'unknown'}`);
  });
  
  console.log('\n─'.repeat(50));
  console.log('Usage: node get-testimony.js "witness name"');
  console.log('  (Can use English or Hebrew name)');
  console.log('─'.repeat(50));
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    await listWitnesses();
    return;
  }
  
  const witnessName = args.join(' ');
  
  console.log('═'.repeat(50));
  console.log('TESTIMONY RETRIEVER');
  console.log('═'.repeat(50));
  
  // Load entities
  const entities = await loadEntities();
  
  // Find witness
  const witness = findWitness(entities, witnessName);
  
  if (!witness) {
    console.log(`\n❌ Witness "${witnessName}" not found.`);
    console.log('\nAvailable witnesses:');
    entities.entities
      .filter(e => e.type === 'WITNESS')
      .forEach(w => console.log(`  - ${w.name}`));
    return;
  }
  
  console.log(`\n✓ Found witness: ${witness.name}`);
  console.log(`  Mentions: ${witness.sources.length}`);
  
  // Get relevant text from source file
  const relevant = await getRelevantText(CONFIG.sourceFile, witness);
  console.log(`  Source lines: ${relevant.lineStart}-${relevant.lineEnd}`);
  
  // Extract testimony with AI
  const testimony = await extractFullTestimony(witness.name, relevant);
  
  // Save
  const outputFile = path.join(CONFIG.outputDir, `testimony-${witness.name.replace(/\s+/g, '-')}.txt`);
  await fs.writeFile(outputFile, testimony, 'utf-8');
  
  console.log('\n─'.repeat(50));
  console.log('TESTIMONY EXTRACTED');
  console.log('─'.repeat(50));
  console.log(`\nSaved to: ${outputFile}`);
  console.log(`\nPreview (first 1500 chars):\n`);
  console.log(testimony.slice(0, 1500));
  console.log('\n...');
}

main().catch(console.error);

