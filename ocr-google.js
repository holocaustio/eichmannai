import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  // Your Google Cloud Project ID (using project number from curl command)
  projectId: process.env.GOOGLE_CLOUD_PROJECT || '261156330246',
  
  // Document AI Processor location (e.g., 'us' or 'eu')
  location: process.env.DOCAI_LOCATION || 'us',
  
  // Document AI Processor ID (from the console)
  processorId: process.env.DOCAI_PROCESSOR_ID || '40eca46e4a17cb7c',
  
  // Path to your service account JSON key file
  credentialsPath: path.join(__dirname, 'google-credentials.json'),
};

// Set credentials BEFORE importing the client
process.env.GOOGLE_APPLICATION_CREDENTIALS = CONFIG.credentialsPath;

// Now import the client
const { DocumentProcessorServiceClient } = await import('@google-cloud/documentai');

const PDF_DIR = path.join(__dirname, 'downloads', 'pdf');
const OCR_DIR = path.join(PDF_DIR, 'OCR');

// Create OCR directory if it doesn't exist
if (!fs.existsSync(OCR_DIR)) {
  fs.mkdirSync(OCR_DIR, { recursive: true });
}

// Process a single PDF with Google Document AI
async function processDocument(pdfPath) {
  const pdfName = path.basename(pdfPath, '.pdf');
  const outputPath = path.join(OCR_DIR, `${pdfName}.txt`);
  
  // Skip if already processed
  if (fs.existsSync(outputPath)) {
    console.log(`Already processed: ${pdfName}.txt`);
    return { success: true, skipped: true };
  }
  
  console.log(`Processing: ${pdfName}`);
  
  // Read the PDF file
  const fileContent = fs.readFileSync(pdfPath);
  const encodedContent = fileContent.toString('base64');
  
  // Check file size (Document AI has a 20MB limit for sync processing)
  const fileSizeMB = fileContent.length / (1024 * 1024);
  if (fileSizeMB > 20) {
    console.log(`  ⚠️  File too large (${fileSizeMB.toFixed(1)}MB). Max is 20MB for sync processing.`);
    console.log(`  Consider using batch processing for large files.`);
    return { success: false, error: 'File too large' };
  }
  
  // Initialize the Document AI client
  const client = new DocumentProcessorServiceClient();
  
  // Build the processor name
  const processorName = `projects/${CONFIG.projectId}/locations/${CONFIG.location}/processors/${CONFIG.processorId}`;
  
  // Create the request
  const request = {
    name: processorName,
    rawDocument: {
      content: encodedContent,
      mimeType: 'application/pdf',
    },
  };
  
  try {
    console.log(`  Sending to Document AI...`);
    const [result] = await client.processDocument(request);
    
    // Extract text from the response
    const { document } = result;
    const text = document.text || '';
    
    // Save the extracted text
    fs.writeFileSync(outputPath, text, 'utf-8');
    console.log(`  ✓ Saved: ${pdfName}.txt (${text.length} characters)`);
    
    return { success: true, characters: text.length };
  } catch (error) {
    console.error(`  ✗ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Process all PDFs in the directory
async function processAllDocuments() {
  console.log('='.repeat(60));
  console.log('Google Document AI OCR Processor');
  console.log('='.repeat(60));
  
  // Check if credentials file exists
  if (!fs.existsSync(CONFIG.credentialsPath)) {
    console.log(`\n⚠️  Credentials file not found: ${CONFIG.credentialsPath}`);
    process.exit(1);
  }
  
  console.log(`\nProject: ${CONFIG.projectId}`);
  console.log(`Location: ${CONFIG.location}`);
  console.log(`Processor: ${CONFIG.processorId}`);
  console.log(`Output: ${OCR_DIR}\n`);
  
  // Get all PDF files
  const pdfFiles = fs.readdirSync(PDF_DIR)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .map(f => path.join(PDF_DIR, f));
  
  console.log(`Found ${pdfFiles.length} PDF files\n`);
  
  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < pdfFiles.length; i++) {
    console.log(`[${i + 1}/${pdfFiles.length}] `, '');
    
    const result = await processDocument(pdfFiles[i]);
    
    if (result.success) {
      if (result.skipped) {
        skipCount++;
      } else {
        successCount++;
      }
    } else {
      failCount++;
    }
    
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
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
  console.log('Google Document AI OCR - Single File');
  console.log('='.repeat(60));
  
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  
  const result = await processDocument(filePath);
  
  if (result.success) {
    console.log('\n✓ Processing complete!');
  } else {
    console.log('\n✗ Processing failed:', result.error);
    process.exit(1);
  }
}

// Main entry point
const args = process.argv.slice(2);

if (args.length > 0) {
  // Single file mode
  const filePath = path.resolve(args[0]);
  processSingleFile(filePath).catch(console.error);
} else {
  // Process all files
  processAllDocuments().catch(console.error);
}

