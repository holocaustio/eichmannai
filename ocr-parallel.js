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
  maxPagesPerRequest: 15,
  concurrency: 5, // Number of parallel requests
};

const PDF_DIR = process.argv[2] || path.join(__dirname, 'downloads', 'pdf', 'filestoprocess');
const OCR_DIR = path.join(__dirname, 'downloads', 'pdf', 'OCR');
const TEMP_DIR = path.join(__dirname, 'temp_pdfs');

// Create directories
[OCR_DIR, TEMP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Get access token
async function getAccessToken() {
  const auth = new GoogleAuth({
    keyFile: CONFIG.credentialsPath,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token.token;
}

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
  
  if (pageCount === 0) return [];
  if (pageCount <= maxPages) return [{ path: pdfPath, startPage: 1, endPage: pageCount }];
  
  const chunks = [];
  for (let start = 1; start <= pageCount; start += maxPages) {
    const end = Math.min(start + maxPages - 1, pageCount);
    const chunkPath = path.join(outputDir, `${baseName}_p${start}-${end}.pdf`);
    
    try {
      execSync(`pdfseparate -f ${start} -l ${end} "${pdfPath}" "${outputDir}/${baseName}_page_%d.pdf" && pdfunite ${outputDir}/${baseName}_page_*.pdf "${chunkPath}" && rm ${outputDir}/${baseName}_page_*.pdf 2>/dev/null`, { stdio: 'pipe' });
      chunks.push({ path: chunkPath, startPage: start, endPage: end });
    } catch (error) {
      // Skip on error
    }
  }
  return chunks;
}

// Process a single chunk
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
          hints: { languageHints: ['he', 'de', 'fr', 'en'] }
        }
      }
    }),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error ${response.status}: ${errorText.substring(0, 200)}`);
  }
  
  const result = await response.json();
  return result.document?.text || '';
}

// Process a single PDF
async function processDocument(pdfPath, accessToken) {
  const pdfName = path.basename(pdfPath, '.pdf');
  const outputPath = path.join(OCR_DIR, `${pdfName}.txt`);
  
  if (fs.existsSync(outputPath)) {
    return { name: pdfName, status: 'skipped' };
  }
  
  const fileContent = fs.readFileSync(pdfPath);
  const fileSizeMB = fileContent.length / (1024 * 1024);
  
  if (fileSizeMB > 20) {
    return { name: pdfName, status: 'failed', error: 'File too large' };
  }
  
  try {
    const chunks = splitPdf(pdfPath, TEMP_DIR, CONFIG.maxPagesPerRequest);
    if (chunks.length === 0) throw new Error('Failed to process PDF');
    
    let fullText = '';
    for (const chunk of chunks) {
      const chunkText = await processChunk(chunk.path, accessToken);
      fullText += chunkText;
      
      if (chunk.path !== pdfPath && fs.existsSync(chunk.path)) {
        fs.unlinkSync(chunk.path);
      }
    }
    
    fs.writeFileSync(outputPath, fullText, 'utf-8');
    return { name: pdfName, status: 'success', chars: fullText.length };
  } catch (error) {
    return { name: pdfName, status: 'failed', error: error.message };
  }
}

// Process files with concurrency limit
async function processWithConcurrency(files, concurrency, accessToken) {
  const results = [];
  const executing = new Set();
  
  for (const file of files) {
    const promise = processDocument(file, accessToken).then(result => {
      executing.delete(promise);
      
      if (result.status === 'success') {
        console.log(`✓ ${result.name} (${result.chars} chars)`);
      } else if (result.status === 'skipped') {
        console.log(`⏭ ${result.name} (skipped)`);
      } else {
        console.log(`✗ ${result.name}: ${result.error}`);
      }
      
      return result;
    });
    
    results.push(promise);
    executing.add(promise);
    
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  
  return Promise.all(results);
}

// Main
async function main() {
  console.log('='.repeat(60));
  console.log('Google Document AI OCR - PARALLEL Processing');
  console.log('='.repeat(60));
  console.log(`\nDirectory: ${PDF_DIR}`);
  console.log(`Concurrency: ${CONFIG.concurrency} parallel requests\n`);
  
  if (!fs.existsSync(PDF_DIR)) {
    console.error(`Directory not found: ${PDF_DIR}`);
    process.exit(1);
  }
  
  const pdfFiles = fs.readdirSync(PDF_DIR)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .map(f => path.join(PDF_DIR, f));
  
  console.log(`Found ${pdfFiles.length} PDF files\n`);
  console.log('Starting parallel processing...\n');
  
  const accessToken = await getAccessToken();
  const startTime = Date.now();
  
  const results = await processWithConcurrency(pdfFiles, CONFIG.concurrency, accessToken);
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const success = results.filter(r => r.status === 'success').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const failed = results.filter(r => r.status === 'failed').length;
  
  // Cleanup
  try { fs.rmSync(TEMP_DIR, { recursive: true, force: true }); } catch {}
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`COMPLETE in ${elapsed}s`);
  console.log('='.repeat(60));
  console.log(`Processed: ${success}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
  console.log(`\nOutput: ${OCR_DIR}`);
}

main().catch(console.error);

