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
  maxWitnesses: 5, // Limit for testing
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
console.log(`Using model: ${OPENAI_MODEL}`);

// ============================================================================
// STEP 1: Find witnesses using [הער הושבע] markers
// ============================================================================

function findWitnessBoundaries(text) {
  const lines = text.split('\n');
  const witnesses = [];
  
  // Find all sworn-in markers
  const swornPattern = /\[הע[רד] הושבע\]/;
  
  for (let i = 0; i < lines.length; i++) {
    if (swornPattern.test(lines[i])) {
      // Look backwards to find who was sworn in
      let witnessName = null;
      let englishName = null;
      
      // Check previous 10 lines for witness identification
      for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
        const line = lines[j];
        
        // Pattern: "העד X כן" or "העד X לא, יידיש"
        const witnessMatch = line.match(/^העד\s+([א-ת\-'"]+(?:\s+[א-ת\-'"]+)?)\s+(?:כן|לא)/);
        if (witnessMatch) {
          witnessName = witnessMatch[1].trim();
          break;
        }
        
        // Pattern: "אני קורא/מבקש למר/לעד X (English)"
        const callMatch = line.match(/(?:קורא|מבקש).*?(?:למר|לעד|לגברת|את)\s+([א-ת\-'"]+(?:\s+[א-ת\-'"]+)*)\s*\(([^)]+)\)/);
        if (callMatch) {
          witnessName = callMatch[1].trim();
          englishName = callMatch[2].trim();
          break;
        }
        
        // Pattern: "אני קורא למר X" without English
        const callMatch2 = line.match(/(?:קורא|מבקש).*?(?:למר|לעד|לגברת)\s+([א-ת\-'"]+(?:\s+[א-ת\-'"]+)*)/);
        if (callMatch2) {
          witnessName = callMatch2[1].trim();
          break;
        }
      }
      
      if (witnessName) {
        witnesses.push({
          name: witnessName,
          englishName: englishName || '',
          swornLine: i + 1, // 1-indexed
          startLine: i + 1
        });
      }
    }
  }
  
  // Set end lines (next witness starts = previous witness ends)
  for (let i = 0; i < witnesses.length; i++) {
    if (i < witnesses.length - 1) {
      witnesses[i].endLine = witnesses[i + 1].startLine - 1;
    } else {
      witnesses[i].endLine = lines.length;
    }
  }
  
  // Also look for "סיימת את עדותך" to find actual end
  for (const witness of witnesses) {
    for (let i = witness.swornLine; i < Math.min(witness.endLine, witness.swornLine + 2000); i++) {
      if (lines[i] && lines[i].includes('סיימת את עדותך')) {
        witness.endLine = i + 1;
        break;
      }
    }
  }
  
  return witnesses;
}

// ============================================================================
// STEP 2: Extract and structure testimony
// ============================================================================

async function extractTestimony(lines, witness, witnessIndex) {
  const startLine = Math.max(0, witness.swornLine - 10);
  const endLine = Math.min(lines.length, witness.endLine + 5);
  
  // Get the testimony text
  const testimonyLines = lines.slice(startLine, endLine);
  const testimonyText = testimonyLines.join('\n');
  
  console.log(`\n  📝 Extracting: ${witness.name} (${witness.englishName || 'no English'})`);
  console.log(`     Lines: ${startLine + 1} - ${endLine} (${endLine - startLine} lines)`);
  
  // Use AI to structure the testimony
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    reasoning_effort: 'medium',
    messages: [
      {
        role: 'system',
        content: `Extract the complete testimony of witness "${witness.name}" from the Eichmann trial.

Structure the testimony as:
1. Basic info: Full name, English name
2. Session number
3. Topic: What they testified about
4. Summary: 2-3 sentences
5. Q&A exchanges: Each question (ש.) and answer (ת.)

Questioners include:
- היועץ המשפטי (Attorney General/Prosecutor)
- אב בית הדין (Presiding Judge)  
- השופט הלוי/רוה (Judges Halevi/Raveh)
- ד"ר סרבציוס (Defense attorney)

Format answers cleanly. Include all substantive exchanges.`
      },
      {
        role: 'user',
        content: `Extract the complete testimony of ${witness.name}:\n\n${testimonyText.slice(0, 15000)}`
      }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'testimony',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            witnessName: { type: 'string' },
            englishName: { type: 'string' },
            session: { type: 'string' },
            topic: { type: 'string' },
            summary: { type: 'string' },
            exchanges: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  questioner: { type: 'string' },
                  question: { type: 'string' },
                  answer: { type: 'string' }
                },
                required: ['questioner', 'question', 'answer'],
                additionalProperties: false
              }
            }
          },
          required: ['witnessName', 'englishName', 'session', 'topic', 'summary', 'exchanges'],
          additionalProperties: false
        }
      }
    }
  });
  
  const testimony = JSON.parse(response.choices[0].message.content);
  
  return {
    ...testimony,
    source: {
      file: path.basename(CONFIG.testFile),
      lineStart: startLine + 1,
      lineEnd: endLine
    },
    rawText: testimonyText
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const startTime = Date.now();
  
  console.log('='.repeat(60));
  console.log('WITNESS TESTIMONY EXTRACTOR v2');
  console.log('='.repeat(60));
  
  // Read file
  const fileName = path.basename(CONFIG.testFile);
  console.log(`\n📂 File: ${fileName}`);
  const text = await fs.readFile(CONFIG.testFile, 'utf-8');
  const lines = text.split('\n');
  console.log(`   Lines: ${lines.length}`);
  
  // Find all witnesses
  console.log('\n📋 Finding witnesses...');
  const allWitnesses = findWitnessBoundaries(text);
  console.log(`   Found ${allWitnesses.length} witnesses`);
  
  // List all found witnesses
  console.log('\n' + '─'.repeat(60));
  console.log('ALL WITNESSES FOUND:');
  console.log('─'.repeat(60));
  allWitnesses.forEach((w, i) => {
    console.log(`  ${(i + 1).toString().padStart(2)}. ${w.name} ${w.englishName ? `(${w.englishName})` : ''}`);
    console.log(`      Lines ${w.swornLine} - ${w.endLine} (${w.endLine - w.swornLine} lines)`);
  });
  
  // Extract testimonies (limited for testing)
  const witnessesToProcess = allWitnesses.slice(0, CONFIG.maxWitnesses);
  console.log(`\n📝 Extracting ${witnessesToProcess.length} testimonies (limit: ${CONFIG.maxWitnesses})...`);
  
  const testimonies = [];
  
  for (let i = 0; i < witnessesToProcess.length; i++) {
    const witness = witnessesToProcess[i];
    try {
      const testimony = await extractTestimony(lines, witness, i);
      testimonies.push(testimony);
      console.log(`     ✓ ${testimony.exchanges.length} Q&A exchanges`);
      console.log(`     Topic: ${testimony.topic.slice(0, 60)}...`);
    } catch (error) {
      console.log(`     ✗ Error: ${error.message}`);
    }
  }
  
  // Build output
  const output = {
    metadata: {
      file: fileName,
      generatedAt: new Date().toISOString(),
      totalWitnessesInFile: allWitnesses.length,
      witnessesExtracted: testimonies.length
    },
    allWitnesses: allWitnesses.map(w => ({
      name: w.name,
      englishName: w.englishName,
      lineStart: w.swornLine,
      lineEnd: w.endLine
    })),
    testimonies: testimonies.map(t => ({
      witnessName: t.witnessName,
      englishName: t.englishName,
      session: t.session,
      topic: t.topic,
      summary: t.summary,
      exchangeCount: t.exchanges.length,
      exchanges: t.exchanges,
      source: t.source
    }))
  };
  
  // Save
  const outputPath = path.join(__dirname, 'witness-testimonies.json');
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  
  console.log('\n' + '─'.repeat(60));
  console.log('SUMMARY:');
  console.log('─'.repeat(60));
  console.log(`  Total witnesses in file: ${allWitnesses.length}`);
  console.log(`  Testimonies extracted: ${testimonies.length}`);
  console.log(`  Total Q&A exchanges: ${testimonies.reduce((sum, t) => sum + t.exchanges.length, 0)}`);
  console.log(`\n  Saved to: ${outputPath}`);
  
  console.log('\n' + '='.repeat(60));
  console.log(`Total time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log('='.repeat(60));
}

main().catch(console.error);
