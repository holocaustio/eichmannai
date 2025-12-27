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
// LOAD DATA
// ============================================================================
async function loadEntities() {
  const data = await fs.readFile(CONFIG.entitiesFile, 'utf-8');
  return JSON.parse(data);
}

async function loadSourceText() {
  return await fs.readFile(CONFIG.sourceFile, 'utf-8');
}

// ============================================================================
// FIND SESSION
// ============================================================================
function findSession(data, sessionNumber) {
  return data.sessions.find(s => s.number === sessionNumber);
}

// ============================================================================
// GET SESSION TEXT
// ============================================================================
function getSessionText(sourceText, session) {
  const lines = sourceText.split('\n');
  
  // Expand slightly for context
  const startLine = Math.max(0, session.lineStart - 10);
  const endLine = Math.min(lines.length, session.lineEnd + 10);
  
  const sessionLines = lines.slice(startLine, endLine);
  
  return {
    text: sessionLines.join('\n'),
    lineStart: startLine + 1,
    lineEnd: endLine
  };
}

// ============================================================================
// EXTRACT SESSION SUMMARY
// ============================================================================
async function extractSessionSummary(session, sessionText, witnesses) {
  console.log(`\nExtracting summary for Session ${session.number}...`);
  console.log(`Text length: ${sessionText.text.length} chars`);
  console.log(`Witnesses: ${witnesses.join(', ') || 'none identified'}`);
  
  // Truncate if needed
  const maxChars = 60000;
  const inputText = sessionText.text.length > maxChars 
    ? sessionText.text.slice(0, maxChars) + '\n...[truncated]'
    : sessionText.text;
  
  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: `You are summarizing Session ${session.number} of the Eichmann Trial.

Create a comprehensive summary that includes:

1. **Opening** - How the session began, who presided

2. **Witnesses** - For each witness who testified:
   - Their name (Hebrew and English if known)
   - Their background (where they were during the Holocaust)
   - Key topics of their testimony
   - Most significant statements or revelations
   - Questions from prosecution and defense

3. **Key Themes** - Main historical events, locations, or topics discussed

4. **Evidence** - Any documents, photos, or exhibits presented

5. **Notable Moments** - Emotional moments, interruptions, significant exchanges

6. **Closing** - How the session ended

Format in clear sections with headers. Use Hebrew names as they appear in the transcript.
Be thorough but organized. This should serve as a reference for researchers.`
        },
        {
          role: 'user',
          content: `Summarize Session ${session.number} (ישיבה ${session.number}):\n\n${inputText}`
        }
      ]
    });
    
    const content = response.choices[0].message.content;
    console.log(`  Response length: ${content?.length || 0} chars`);
    
    return content || '[No summary generated]';
  } catch (error) {
    console.error(`Error extracting summary: ${error.message}`);
    return `[Error: ${error.message}]`;
  }
}

// ============================================================================
// LIST SESSIONS
// ============================================================================
async function listSessions() {
  const data = await loadEntities();
  
  console.log('\n═'.repeat(50));
  console.log('AVAILABLE SESSIONS');
  console.log('═'.repeat(50));
  
  if (!data.sessions || data.sessions.length === 0) {
    console.log('No sessions found in entities.json');
    console.log('Run extract-entities.js first.');
    return;
  }
  
  data.sessions.forEach((session, i) => {
    console.log(`\n${i + 1}. Session ${session.number} (ישיבה ${session.number})`);
    console.log(`   Lines: ${session.lineStart}-${session.lineEnd}`);
    console.log(`   Witnesses: ${session.witnesses.length > 0 ? session.witnesses.join(', ') : 'none identified'}`);
    console.log(`   Locations: ${session.locations.length}`);
    console.log(`   Organizations: ${session.organizations.length}`);
  });
  
  console.log('\n─'.repeat(50));
  console.log('Usage: node get-session.js <session_number>');
  console.log('Example: node get-session.js 65');
  console.log('─'.repeat(50));
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    await listSessions();
    return;
  }
  
  const sessionNumber = parseInt(args[0]);
  
  if (isNaN(sessionNumber)) {
    console.log('Please provide a valid session number.');
    return;
  }
  
  console.log('═'.repeat(50));
  console.log('SESSION SUMMARY EXTRACTOR');
  console.log('═'.repeat(50));
  
  // Load data
  const data = await loadEntities();
  const sourceText = await loadSourceText();
  
  // Find session
  const session = findSession(data, sessionNumber);
  
  if (!session) {
    console.log(`\n❌ Session ${sessionNumber} not found.`);
    console.log('\nAvailable sessions:');
    data.sessions.forEach(s => console.log(`  - Session ${s.number}`));
    return;
  }
  
  console.log(`\n✓ Found Session ${session.number}`);
  console.log(`  Lines: ${session.lineStart}-${session.lineEnd}`);
  console.log(`  Witnesses: ${session.witnesses.join(', ') || 'none'}`);
  
  // Get session text
  const sessionText = getSessionText(sourceText, session);
  console.log(`  Text range: lines ${sessionText.lineStart}-${sessionText.lineEnd}`);
  
  // Extract summary
  const summary = await extractSessionSummary(session, sessionText, session.witnesses);
  
  // Build output with metadata
  const output = `# Session ${session.number} - Summary
## ישיבה מספר ${session.number}

**Source File:** ${path.basename(CONFIG.sourceFile)}
**Lines:** ${session.lineStart}-${session.lineEnd}
**Witnesses:** ${session.witnesses.join(', ') || 'None identified'}
**Locations Mentioned:** ${session.locations.join(', ') || 'None'}
**Organizations Mentioned:** ${session.organizations.join(', ') || 'None'}

---

${summary}
`;
  
  // Save
  const outputFile = path.join(CONFIG.outputDir, `session-${session.number}-summary.md`);
  await fs.writeFile(outputFile, output, 'utf-8');
  
  console.log('\n─'.repeat(50));
  console.log('SESSION SUMMARY EXTRACTED');
  console.log('─'.repeat(50));
  console.log(`\nSaved to: ${outputFile}`);
  console.log(`\nPreview (first 2000 chars):\n`);
  console.log(output.slice(0, 2000));
  console.log('\n...');
}

main().catch(console.error);

