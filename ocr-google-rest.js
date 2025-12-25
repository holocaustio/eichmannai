import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleAuth } from 'google-auth-library';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  projectNumber: '261156330246',
  location: 'us',
  processorId: '40eca46e4a17cb7c',
  credentialsPath: path.join(__dirname, 'google-credentials.json'),
  maxPagesPerRequest: 15, // Document AI limit for sync processing
};

const PDF_DIR = path.join(__dirname, 'downloads', 'pdf');
const OCR_DIR = path.join(PDF_DIR, 'OCR');
const TEMP_DIR = path.join(__dirname, 'temp_pdfs');

// Create directories
[OCR_DIR, TEMP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Get PDF page count
function getPdfPageCount(pdfPath) {
  try {
    const result = execSync(`pdfinfo "${pdfPath}" 2>/dev/null | grep Pages | awk '{print $2}'`, { encoding: 'utf-8' });
    return parseInt(result.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

// Split PDF into chunks
function splitPdf(pdfPath, outputDir, maxPages) {
  const baseName = path.basename(pdfPath, '.pdf');
  const pageCount = getPdfPageCount(pdfPath);
  
  if (pageCount === 0) {
    console.log(`  ⚠️  Could not determine page count`);
    return [];
  }
  
  if (pageCount <= maxPages) {
    // No need to split
    return [{ path: pdfPath, startPage: 1, endPage: pageCount }];
  }
  
  console.log(`  Splitting ${pageCount} pages into chunks of ${maxPages}...`);
  
  const chunks = [];
  for (let start = 1; start <= pageCount; start += maxPages) {
    const end = Math.min(start + maxPages - 1, pageCount);
    const chunkPath = path.join(outputDir, `${baseName}_p${start}-${end}.pdf`);
    
    try {
      execSync(`pdfseparate -f ${start} -l ${end} "${pdfPath}" "${outputDir}/${baseName}_page_%d.pdf" && pdfunite ${outputDir}/${baseName}_page_*.pdf "${chunkPath}" && rm ${outputDir}/${baseName}_page_*.pdf`, { stdio: 'pipe' });
      chunks.push({ path: chunkPath, startPage: start, endPage: end });
    } catch (error) {
      console.log(`  ⚠️  Error splitting pages ${start}-${end}: ${error.message}`);
    }
  }
  
  return chunks;
}

// Get access token using service account
async function getAccessToken() {
  const auth = new GoogleAuth({
    keyFile: CONFIG.credentialsPath,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token.token;
}

// Process a single PDF chunk using REST API
async function processChunk(pdfPath, accessToken) {
  const fileContent = fs.readFileSync(pdfPath);
  const encodedContent = fileContent.toString('base64');
  
  const apiUrl = `https://${CONFIG.location}-documentai.googleapis.com/v1/projects/${CONFIG.projectNumber}/locations/${CONFIG.location}/processors/${CONFIG.processorId}:process`;
  
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      rawDocument: {
        content: encodedContent,
        mimeType: 'application/pdf',
      },
      processOptions: {
        ocrConfig: {
          enableImageQualityScores: false,
          enableSymbol: false,
          hints: {
            languageHints: ['he', 'de', 'fr', 'en']
          }
        }
      }
    }),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error ${response.status}: ${errorText}`);
  }
  
  const result = await response.json();
  return result.document?.text || '';
}

// Process a single PDF using REST API
async function processDocument(pdfPath) {
  const pdfName = path.basename(pdfPath, '.pdf');
  const outputPath = path.join(OCR_DIR, `${pdfName}.txt`);
  
  // Skip if already processed
  if (fs.existsSync(outputPath)) {
    console.log(`Already processed: ${pdfName}.txt`);
    return { success: true, skipped: true };
  }
  
  console.log(`Processing: ${pdfName}`);
  
  // Check file size
  const fileContent = fs.readFileSync(pdfPath);
  const fileSizeMB = fileContent.length / (1024 * 1024);
  const pageCount = getPdfPageCount(pdfPath);
  console.log(`  File size: ${fileSizeMB.toFixed(2)} MB, Pages: ${pageCount}`);
  
  if (fileSizeMB > 20) {
    console.log(`  ⚠️  File too large for sync processing (max 20MB)`);
    return { success: false, error: 'File too large' };
  }
  
  try {
    // Get access token
    console.log(`  Getting access token...`);
    const accessToken = await getAccessToken();
    
    // Split PDF if needed
    const chunks = splitPdf(pdfPath, TEMP_DIR, CONFIG.maxPagesPerRequest);
    
    if (chunks.length === 0) {
      throw new Error('Failed to process PDF');
    }
    
    let fullText = '';
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      if (chunks.length > 1) {
        console.log(`  Processing chunk ${i + 1}/${chunks.length} (pages ${chunk.startPage}-${chunk.endPage})...`);
      } else {
        console.log(`  Sending to Document AI...`);
      }
      
      const chunkText = await processChunk(chunk.path, accessToken);
      fullText += chunkText;
      
      // Clean up temp chunk file
      if (chunk.path !== pdfPath && fs.existsSync(chunk.path)) {
        fs.unlinkSync(chunk.path);
      }
      
      // Small delay between chunks
      if (i < chunks.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    
    // Save the text
    fs.writeFileSync(outputPath, fullText, 'utf-8');
    console.log(`  ✓ Saved: ${pdfName}.txt (${fullText.length} characters)`);
    
    return { success: true, characters: fullText.length };
  } catch (error) {
    console.error(`  ✗ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Process all PDFs
async function processAllDocuments() {
  console.log('='.repeat(60));
  console.log('Google Document AI OCR (REST API)');
  console.log('='.repeat(60));
  
  if (!fs.existsSync(CONFIG.credentialsPath)) {
    console.log(`\n⚠️  Credentials file not found: ${CONFIG.credentialsPath}`);
    process.exit(1);
  }
  
  console.log(`\nProject: ${CONFIG.projectNumber}`);
  console.log(`Processor: ${CONFIG.processorId}`);
  console.log(`Output: ${OCR_DIR}\n`);
  
  const pdfFiles = fs.readdirSync(PDF_DIR)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .map(f => path.join(PDF_DIR, f));
  
  console.log(`Found ${pdfFiles.length} PDF files\n`);
  
  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < pdfFiles.length; i++) {
    console.log(`[${i + 1}/${pdfFiles.length}] `);
    
    const result = await processDocument(pdfFiles[i]);
    
    if (result.success) {
      if (result.skipped) skipCount++;
      else successCount++;
    } else {
      failCount++;
    }
    
    // Small delay
    await new Promise(r => setTimeout(r, 500));
  }
  
  // Cleanup temp directory
  try {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  } catch (e) {
    // Ignore
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('COMPLETE');
  console.log('='.repeat(60));
  console.log(`Processed: ${successCount}`);
  console.log(`Skipped: ${skipCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`\nText files saved to: ${OCR_DIR}`);
}

// Single file mode
async function processSingleFile(filePath) {
  console.log('='.repeat(60));
  console.log('Google Document AI OCR - Single File (REST API)');
  console.log('='.repeat(60));
  
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  
  const result = await processDocument(filePath);
  
  if (result.success && !result.skipped) {
    console.log('\n✓ Processing complete!');
  } else if (result.skipped) {
    console.log('\n✓ File was already processed.');
  } else {
    console.log('\n✗ Processing failed.');
    process.exit(1);
  }
}

// Main
const args = process.argv.slice(2);

if (args.length > 0) {
  processSingleFile(path.resolve(args[0])).catch(console.error);
} else {
  processAllDocuments().catch(console.error);
}

