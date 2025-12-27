import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// ============================================================================
// Extract a single page with layout
// ============================================================================

async function extractPageWithLayout(pdfPath, pageNum) {
  try {
    const { stdout } = await execAsync(
      `pdftotext -layout -f ${pageNum} -l ${pageNum} "${pdfPath}" -`
    );
    return stdout;
  } catch (error) {
    console.error(`Error extracting page ${pageNum}:`, error.message);
    return null;
  }
}

// ============================================================================
// Use AI to reconstruct proper reading order
// ============================================================================

async function reconstructColumnOrder(pageText, pageNum) {
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    reasoning_effort: 'medium',
    messages: [
      {
        role: 'system',
        content: `You are processing a Hebrew RTL legal document from the Eichmann trial.

The text is from a TWO-COLUMN PDF where lines are currently interleaved incorrectly.

Your task:
1. Identify the RIGHT column (Hebrew reads right-to-left, so right column comes FIRST)
2. Identify the LEFT column (continuation/second)
3. Reconstruct the CORRECT reading order

The document contains:
- ש. = Questions (שאלה)
- ת. = Answers (תשובה)  
- Speakers like: אב בית הדין, היועץ המשפטי, ד"ר סרבציוס, העד X

Output the text in proper reading order as continuous prose/dialogue.
Preserve all Hebrew text exactly. Fix only the ORDER of content.`
      },
      {
        role: 'user',
        content: `Reconstruct the correct reading order for page ${pageNum}:\n\n${pageText}`
      }
    ],
    max_completion_tokens: 4000
  });
  
  return response.choices[0].message.content;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const pdfPath = path.join(__dirname, 'downloads/pdf/filestoprocess/Vol1_p15291.pdf');
  
  console.log('='.repeat(60));
  console.log('PDF COLUMN ORDER FIXER');
  console.log('='.repeat(60));
  
  // Test with page 1
  console.log('\n📄 Extracting page 1...');
  const pageText = await extractPageWithLayout(pdfPath, 1);
  
  if (!pageText) {
    console.log('Failed to extract page');
    return;
  }
  
  console.log(`   Raw text length: ${pageText.length} chars`);
  console.log('\n📝 Original (first 1000 chars):');
  console.log('─'.repeat(60));
  console.log(pageText.slice(0, 1000));
  
  console.log('\n🔄 Reconstructing column order with AI...');
  const fixed = await reconstructColumnOrder(pageText, 1);
  
  console.log('\n✅ Fixed text:');
  console.log('─'.repeat(60));
  console.log(fixed);
  
  // Save comparison
  const outputPath = path.join(__dirname, 'pdf-column-test.json');
  await fs.writeFile(outputPath, JSON.stringify({
    page: 1,
    original: pageText,
    fixed: fixed
  }, null, 2), 'utf-8');
  
  console.log(`\n📁 Saved to: ${outputPath}`);
}

main().catch(console.error);

