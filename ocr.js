import Tesseract from 'tesseract.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PDF_DIR = path.join(__dirname, 'downloads', 'pdf');
const OCR_DIR = path.join(PDF_DIR, 'OCR');
const TEMP_DIR = path.join(__dirname, 'temp_images');

// Create directories
[OCR_DIR, TEMP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Check if pdftoppm is available (from poppler)
function checkDependencies() {
  try {
    execSync('which pdftoppm', { stdio: 'pipe' });
    return true;
  } catch {
    console.log('\n⚠️  pdftoppm not found. Installing poppler...');
    console.log('Run: brew install poppler');
    console.log('\nOr on Linux: sudo apt-get install poppler-utils\n');
    return false;
  }
}

// Convert PDF to images using pdftoppm
function pdfToImages(pdfPath, outputPrefix) {
  try {
    // Convert PDF pages to PNG images
    execSync(`pdftoppm -png -r 300 "${pdfPath}" "${outputPrefix}"`, { 
      stdio: 'pipe',
      maxBuffer: 50 * 1024 * 1024 // 50MB buffer
    });
    
    // Get list of generated images
    const dir = path.dirname(outputPrefix);
    const prefix = path.basename(outputPrefix);
    const images = fs.readdirSync(dir)
      .filter(f => f.startsWith(prefix) && f.endsWith('.png'))
      .sort()
      .map(f => path.join(dir, f));
    
    return images;
  } catch (error) {
    console.error(`    Error converting PDF: ${error.message}`);
    return [];
  }
}

// Run OCR on an image
async function ocrImage(imagePath, worker) {
  try {
    const { data: { text } } = await worker.recognize(imagePath);
    return text;
  } catch (error) {
    console.error(`    Error OCR on ${imagePath}: ${error.message}`);
    return '';
  }
}

// Clean up temp images
function cleanupImages(images) {
  images.forEach(img => {
    try {
      fs.unlinkSync(img);
    } catch (e) {
      // Ignore cleanup errors
    }
  });
}

// Process a single PDF
async function processPdf(pdfPath, worker) {
  const pdfName = path.basename(pdfPath, '.pdf');
  const outputPath = path.join(OCR_DIR, `${pdfName}.txt`);
  
  // Skip if already processed
  if (fs.existsSync(outputPath)) {
    console.log(`    Already processed: ${pdfName}.txt`);
    return true;
  }
  
  const tempPrefix = path.join(TEMP_DIR, pdfName);
  
  // Convert PDF to images
  console.log(`    Converting PDF to images...`);
  const images = pdfToImages(pdfPath, tempPrefix);
  
  if (images.length === 0) {
    console.log(`    No images generated, skipping...`);
    return false;
  }
  
  console.log(`    Found ${images.length} pages, running OCR...`);
  
  // OCR each image
  let fullText = '';
  for (let i = 0; i < images.length; i++) {
    const pageText = await ocrImage(images[i], worker);
    fullText += `\n--- Page ${i + 1} ---\n\n${pageText}\n`;
    
    // Progress indicator every 10 pages
    if ((i + 1) % 10 === 0) {
      console.log(`    Processed ${i + 1}/${images.length} pages...`);
    }
  }
  
  // Save text
  fs.writeFileSync(outputPath, fullText, 'utf-8');
  console.log(`    Saved: ${pdfName}.txt`);
  
  // Cleanup temp images
  cleanupImages(images);
  
  return true;
}

// Main function
async function main() {
  console.log('='.repeat(60));
  console.log('PDF OCR Processor (using Tesseract)');
  console.log('='.repeat(60));
  
  // Check dependencies
  if (!checkDependencies()) {
    process.exit(1);
  }
  
  // Get all PDF files
  const pdfFiles = fs.readdirSync(PDF_DIR)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .map(f => path.join(PDF_DIR, f));
  
  console.log(`\nFound ${pdfFiles.length} PDF files`);
  console.log(`Output directory: ${OCR_DIR}\n`);
  
  // Initialize Tesseract worker
  console.log('Initializing Tesseract OCR engine...');
  const worker = await Tesseract.createWorker('eng+deu+fra+heb', 1, {
    logger: () => {} // Suppress verbose logging
  });
  
  console.log('Tesseract ready! Languages: English, German, French, Hebrew\n');
  
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < pdfFiles.length; i++) {
    const pdfPath = pdfFiles[i];
    const pdfName = path.basename(pdfPath);
    
    console.log(`\n[${i + 1}/${pdfFiles.length}] Processing: ${pdfName}`);
    
    try {
      const success = await processPdf(pdfPath, worker);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }
    } catch (error) {
      console.error(`    Error: ${error.message}`);
      failCount++;
    }
  }
  
  // Cleanup
  await worker.terminate();
  
  // Remove temp directory
  try {
    fs.rmSync(TEMP_DIR, { recursive: true });
  } catch (e) {
    // Ignore
  }
  
  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('OCR COMPLETE');
  console.log('='.repeat(60));
  console.log(`Success: ${successCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`\nText files saved to: ${OCR_DIR}`);
}

main().catch(console.error);

