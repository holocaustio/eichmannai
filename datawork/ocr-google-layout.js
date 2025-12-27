import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  projectId: process.env.GOOGLE_CLOUD_PROJECT || '261156330246',
  location: process.env.DOCAI_LOCATION || 'us',
  processorId: process.env.DOCAI_PROCESSOR_ID || '40eca46e4a17cb7c',
  credentialsPath: path.join(__dirname, 'google-credentials.json'),
};

// Set credentials BEFORE importing the client
process.env.GOOGLE_APPLICATION_CREDENTIALS = CONFIG.credentialsPath;

const { DocumentProcessorServiceClient } = await import('@google-cloud/documentai');

// ============================================
// LAYOUT-AWARE TEXT EXTRACTION
// ============================================

/**
 * Extract text from a segment using the document's text field
 */
function extractTextFromLayout(document, textAnchor) {
  if (!textAnchor || !textAnchor.textSegments || textAnchor.textSegments.length === 0) {
    return '';
  }
  
  const text = document.text || '';
  let result = '';
  
  for (const segment of textAnchor.textSegments) {
    const startIndex = parseInt(segment.startIndex || 0);
    const endIndex = parseInt(segment.endIndex || 0);
    result += text.slice(startIndex, endIndex);
  }
  
  return result;
}

/**
 * Get the center X position of a bounding box (for column detection)
 */
function getCenterX(boundingPoly) {
  if (!boundingPoly || !boundingPoly.normalizedVertices) {
    return 0.5; // Default to center
  }
  
  const vertices = boundingPoly.normalizedVertices;
  const xCoords = vertices.map(v => v.x || 0);
  return (Math.min(...xCoords) + Math.max(...xCoords)) / 2;
}

/**
 * Get the top Y position of a bounding box (for vertical ordering)
 */
function getTopY(boundingPoly) {
  if (!boundingPoly || !boundingPoly.normalizedVertices) {
    return 0;
  }
  
  const vertices = boundingPoly.normalizedVertices;
  return Math.min(...vertices.map(v => v.y || 0));
}

/**
 * Process a page with two-column layout awareness
 * For Hebrew RTL: Right column (higher X) comes FIRST
 */
function processPageWithLayout(document, page, pageIndex, debug = false) {
  const blocks = page.blocks || [];
  
  if (blocks.length === 0) {
    // Fallback to paragraphs if no blocks
    const paragraphs = page.paragraphs || [];
    if (paragraphs.length === 0) return '';
    
    const sortedParagraphs = paragraphs.map(p => ({
      text: extractTextFromLayout(document, p.layout?.textAnchor),
      x: getCenterX(p.layout?.boundingPoly),
      y: getTopY(p.layout?.boundingPoly)
    }));
    
    return processElements(sortedParagraphs, debug);
  }
  
  // Extract block info with positions
  const blockData = blocks.map(block => ({
    text: extractTextFromLayout(document, block.layout?.textAnchor),
    x: getCenterX(block.layout?.boundingPoly),
    y: getTopY(block.layout?.boundingPoly)
  }));
  
  if (debug) {
    console.log(`\n  DEBUG: Page ${pageIndex + 1} has ${blockData.length} blocks:`);
    blockData.forEach((b, i) => {
      console.log(`    Block ${i}: x=${b.x.toFixed(2)}, y=${b.y.toFixed(2)}, text="${b.text.slice(0, 50)}..."`);
    });
  }
  
  return processElements(blockData, debug);
}

/**
 * Find column boundaries using clustering
 */
function findColumnBoundary(elements) {
  if (elements.length < 2) return 0.5;
  
  const xPositions = elements.map(e => e.x).sort((a, b) => a - b);
  
  // Find the largest gap in X positions - that's the column boundary
  let maxGap = 0;
  let boundary = 0.5;
  
  for (let i = 1; i < xPositions.length; i++) {
    const gap = xPositions[i] - xPositions[i - 1];
    if (gap > maxGap) {
      maxGap = gap;
      boundary = (xPositions[i] + xPositions[i - 1]) / 2;
    }
  }
  
  // Only use detected boundary if the gap is significant (> 0.1)
  if (maxGap < 0.1) {
    return 0.5; // Default
  }
  
  return boundary;
}

/**
 * Process elements (blocks or paragraphs) with column-aware ordering
 */
function processElements(elements, debug = false) {
  if (elements.length === 0) return '';
  
  // Determine if this is a two-column layout
  const xPositions = elements.map(e => e.x);
  const minX = Math.min(...xPositions);
  const maxX = Math.max(...xPositions);
  
  // If elements span more than 40% of the page width, likely two columns
  const isTwoColumn = (maxX - minX) > 0.4;
  
  if (!isTwoColumn) {
    // Single column - just sort by Y position (top to bottom)
    elements.sort((a, b) => a.y - b.y);
    return elements.map(e => e.text).join('\n');
  }
  
  // Find dynamic column boundary
  const boundary = findColumnBoundary(elements);
  
  if (debug) {
    console.log(`  DEBUG: X range: ${minX.toFixed(2)} - ${maxX.toFixed(2)}, boundary: ${boundary.toFixed(2)}`);
  }
  
  // For Hebrew RTL: Right column (X > boundary) should come FIRST
  const rightColumn = elements.filter(e => e.x > boundary);
  const leftColumn = elements.filter(e => e.x <= boundary);
  
  if (debug) {
    console.log(`  DEBUG: Right column: ${rightColumn.length} blocks, Left column: ${leftColumn.length} blocks`);
  }
  
  // Sort each column by Y position (top to bottom)
  rightColumn.sort((a, b) => a.y - b.y);
  leftColumn.sort((a, b) => a.y - b.y);
  
  // Combine: Right column first (Hebrew reading order), then left column
  const orderedElements = [...rightColumn, ...leftColumn];
  
  return orderedElements.map(e => e.text).join('\n');
}

/**
 * Process entire document with layout awareness
 */
function processDocumentWithLayout(document, debug = false) {
  const pages = document.pages || [];
  const pageTexts = [];
  
  for (let i = 0; i < pages.length; i++) {
    // Debug first page only
    const pageText = processPageWithLayout(document, pages[i], i, debug && i === 0);
    pageTexts.push(pageText);
  }
  
  return pageTexts.join('\n\n--- PAGE BREAK ---\n\n');
}

// ============================================
// MAIN PROCESSING
// ============================================

async function processDocument(pdfPath) {
  const pdfName = path.basename(pdfPath, '.pdf');
  
  console.log(`Processing: ${pdfName}`);
  
  // Read the PDF file
  const fileContent = fs.readFileSync(pdfPath);
  const encodedContent = fileContent.toString('base64');
  
  const fileSizeMB = fileContent.length / (1024 * 1024);
  console.log(`  File size: ${fileSizeMB.toFixed(1)}MB`);
  
  if (fileSizeMB > 20) {
    console.log(`  ⚠️  File too large. Max is 20MB for sync processing.`);
    return null;
  }
  
  const client = new DocumentProcessorServiceClient();
  const processorName = `projects/${CONFIG.projectId}/locations/${CONFIG.location}/processors/${CONFIG.processorId}`;
  
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
    const { document } = result;
    
    console.log(`  Pages: ${document.pages?.length || 0}`);
    console.log(`  Raw text length: ${document.text?.length || 0}`);
    
    // Process with layout awareness
    console.log(`  Processing layout...`);
    const layoutText = processDocumentWithLayout(document, true);
    
    return {
      rawText: document.text || '',
      layoutText: layoutText,
      pages: document.pages?.length || 0
    };
  } catch (error) {
    console.error(`  ✗ Error: ${error.message}`);
    return null;
  }
}

// ============================================
// TEST
// ============================================

async function testSingleFile() {
  // Use single page for testing
  const testFile = path.join(__dirname, 'downloads/pdf/filestoprocess/Vol1_test_page1.pdf');
  
  console.log('='.repeat(60));
  console.log('Google Document AI - Layout-Aware OCR Test');
  console.log('='.repeat(60));
  
  if (!fs.existsSync(testFile)) {
    console.error(`File not found: ${testFile}`);
    process.exit(1);
  }
  
  if (!fs.existsSync(CONFIG.credentialsPath)) {
    console.error(`Credentials not found: ${CONFIG.credentialsPath}`);
    process.exit(1);
  }
  
  const result = await processDocument(testFile);
  
  if (!result) {
    console.log('\n✗ Processing failed');
    return;
  }
  
  // Save both versions for comparison
  const baseName = path.basename(testFile, '.pdf');
  
  // Raw text (original order)
  const rawPath = path.join(__dirname, `${baseName}_raw.txt`);
  fs.writeFileSync(rawPath, result.rawText, 'utf-8');
  console.log(`\n  Raw text saved: ${rawPath}`);
  
  // Layout-aware text (column-corrected)
  const layoutPath = path.join(__dirname, `${baseName}_layout.txt`);
  fs.writeFileSync(layoutPath, result.layoutText, 'utf-8');
  console.log(`  Layout text saved: ${layoutPath}`);
  
  // Show comparison
  console.log('\n' + '='.repeat(60));
  console.log('COMPARISON - First 2000 chars');
  console.log('='.repeat(60));
  
  console.log('\n--- RAW TEXT (first 1000 chars) ---');
  console.log(result.rawText.slice(0, 1000));
  
  console.log('\n--- LAYOUT TEXT (first 1000 chars) ---');
  console.log(result.layoutText.slice(0, 1000));
  
  console.log('\n✓ Done!');
}

testSingleFile().catch(console.error);

