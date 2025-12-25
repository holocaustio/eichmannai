import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const PDF_DIR = path.join(DOWNLOADS_DIR, 'pdf');

// Create download directories
[DOWNLOADS_DIR, PDF_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// All PDF filenames from the gov.il Eichmann trial archive
const PDF_FILES = [
  // Page 1 (skip=0)
  'Vol5_band33.pdf',
  'Vol5_band34.pdf',
  'Vol5_band35.pdf',
  'Vol5_band36.pdf',
  'Vol6_band37.pdf',
  'Vol6_band38.pdf',
  'Vol6_band39.pdf',
  'Vol6_band40.pdf',
  'Vol6_band41.pdf',
  'Vol6_band42a.pdf',
  'Vol6_band43.pdf',
  'Vol6_band44.pdf',
  'Vol6_band45a.pdf',
  'Vol6_band46.pdf',
  'Vol6_band47.pdf',
  'Vol6_band48.pdf',
  'Vol6_band49.pdf',
  'Vol6_band50.pdf',
  'Vol6_band51.pdf',
  'Vol6_band52.pdf',
  // Page 2 (skip=20)
  'Vol5_band13.pdf',
  'Vol5_band14.pdf',
  'Vol5_band15.pdf',
  'Vol5_band16.pdf',
  'Vol5_band17.pdf',
  'Vol5_band18.pdf',
  'Vol5_band19.pdf',
  'Vol5_band20.pdf',
  'Vol5_band21.pdf',
  'Vol5_band22.pdf',
  'Vol5_band23.pdf',
  'Vol5_band24.pdf',
  'Vol5_band25.pdf',
  'Vol5_band26.pdf',
  'Vol5_band27.pdf',
  'Vol5_band28.pdf',
  'Vol5_band29.pdf',
  'Vol5_band30.pdf',
  'Vol5_band31.pdf',
  'Vol5_band32.pdf',
  // Page 3 (skip=40)
  'Vol5_band1.pdf',
  'Vol5_band10.pdf',
  'Vol5_band11a1.pdf',
  'Vol5_band12.pdf',
  'Vol5_band2.pdf',
  'Vol5_band3.pdf',
  'Vol5_band4.pdf',
  'Vol5_band5.pdf',
  'Vol5_band6.pdf',
  'Vol5_band7.pdf',
  'Vol5_band8.pdf',
  'Vol5_band9.pdf',
  'claims1.pdf',
  'claims2.pdf',
  'claims3.pdf',
  'list.pdf',
  'summaries.pdf',
  'testimonies.pdf',
  'vol4_summary.pdf',
  // Page 4 (skip=60)
  'Vol1_p114.pdf',
  'Vol1_p15291.pdf',
  'Vol2_p4155.pdf',
  'Vol2_p5564.pdf',
  'Vol2_p6575.pdf',
  'vol1_part3.pdf',
  'vol1_summary.pdf',
  'vol2_summary.pdf',
  'vol3_p101111.pdf',
  'vol3_p112121.pdf',
  'vol3_p7689.pdf',
  'vol3_p90100.pdf',
  'vol3_summary.pdf',
];

// Build URL from filename
// Pattern: https://www.gov.il/BlobFolder/dynamiccollectorresultitem/{name_lowercase}/he/{filename}
function buildUrl(filename) {
  const nameWithoutExt = filename.replace('.pdf', '').toLowerCase();
  return `https://www.gov.il/BlobFolder/dynamiccollectorresultitem/${nameWithoutExt}/he/${filename}`;
}

// Rate limiting helper
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Download a file
async function downloadFile(url, filepath) {
  if (fs.existsSync(filepath)) {
    console.log(`  Already exists: ${path.basename(filepath)}`);
    return true;
  }
  
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 120000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/pdf,*/*',
        'Referer': 'https://www.gov.il/'
      }
    });
    
    const writer = fs.createWriteStream(filepath);
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`  Downloaded: ${path.basename(filepath)}`);
        resolve(true);
      });
      writer.on('error', reject);
    });
  } catch (error) {
    console.log(`  Failed: ${path.basename(filepath)} - ${error.message}`);
    return false;
  }
}

// Main download function
async function downloadAll() {
  console.log('='.repeat(60));
  console.log('Eichmann Trial Documents Downloader (gov.il)');
  console.log('='.repeat(60));
  console.log(`\nTotal files to download: ${PDF_FILES.length}`);
  console.log(`Download directory: ${PDF_DIR}\n`);
  
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < PDF_FILES.length; i++) {
    const filename = PDF_FILES[i];
    const url = buildUrl(filename);
    const filepath = path.join(PDF_DIR, filename);
    
    console.log(`[${i + 1}/${PDF_FILES.length}] ${filename}`);
    
    const success = await downloadFile(url, filepath);
    
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
    
    // Rate limiting - be nice to the server
    await delay(300);
  }
  
  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('DOWNLOAD COMPLETE');
  console.log('='.repeat(60));
  console.log(`Success: ${successCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`\nFiles saved to: ${PDF_DIR}`);
}

// Run the downloader
downloadAll().catch(console.error);
