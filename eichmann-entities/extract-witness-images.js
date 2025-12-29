#!/usr/bin/env node

/**
 * Extract Witness Images from Yad Vashem
 * 
 * Fetches witness photos from the Eichmann trial exhibition page
 * and saves them locally, then updates the witness-index.json
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'https://wwv.yadvashem.org/yv/en/exhibitions/eichmann/';
const WITNESSES_PAGE = BASE_URL + 'witnesses.asp';
const IMAGES_BASE = BASE_URL + 'images/witnesses/';

const OUTPUT_DIR = path.join(__dirname, '../app/public/images/witnesses');
const WITNESS_INDEX_PATH = path.join(__dirname, 'witness-index.json');

// Create output directory if it doesn't exist
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log('Created directory:', OUTPUT_DIR);
}

// Fetch a URL and return the content
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // Follow redirect
        fetchUrl(res.headers.location).then(resolve).catch(reject);
        return;
      }
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Download an image to a file
function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(filepath);
        downloadImage(res.headers.location, filepath).then(resolve).catch(reject);
        return;
      }
      
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(filepath);
        reject(new Error(`Failed to download: ${res.statusCode}`));
        return;
      }
      
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(true);
      });
      file.on('error', (err) => {
        fs.unlinkSync(filepath);
        reject(err);
      });
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
      reject(err);
    });
  });
}

// Parse the HTML to extract witness image data
function parseWitnessImages(html) {
  const witnesses = [];
  
  // Match pattern: <a href="images/witnesses/xxx.jpg" ... title="Name">
  // <img src="images/witnesses/xxx.jpg" alt="Name" ...>
  const imgPattern = /<a\s+href="images\/witnesses\/([^"]+\.jpg)"[^>]*title="([^"]+)"[^>]*>/gi;
  
  let match;
  while ((match = imgPattern.exec(html)) !== null) {
    const filename = match[1];
    const name = match[2].trim();
    
    witnesses.push({
      name,
      filename,
      url: IMAGES_BASE + filename
    });
  }
  
  // Also try to match standalone img tags
  const imgPattern2 = /<img\s+src="images\/witnesses\/([^"]+\.jpg)"[^>]*alt="([^"]+)"[^>]*>/gi;
  
  while ((match = imgPattern2.exec(html)) !== null) {
    const filename = match[1];
    const name = match[2].trim();
    
    // Check if we already have this
    if (!witnesses.find(w => w.filename === filename)) {
      witnesses.push({
        name,
        filename,
        url: IMAGES_BASE + filename
      });
    }
  }
  
  return witnesses;
}

// Normalize name for matching (handle variations)
function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/^dr\.?\s*/i, '')
    .replace(/^prof\.?\s*/i, '')
    .replace(/^judge\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Find matching witness in index
function findMatchingWitness(imageName, witnessIndex) {
  const normalizedImageName = normalizeName(imageName);
  
  for (const witness of witnessIndex.witnesses) {
    const normalizedWitnessName = normalizeName(witness.english);
    
    // Exact match
    if (normalizedWitnessName === normalizedImageName) {
      return witness;
    }
    
    // Partial match (image name contains witness name or vice versa)
    if (normalizedWitnessName.includes(normalizedImageName) || 
        normalizedImageName.includes(normalizedWitnessName)) {
      return witness;
    }
    
    // Check last name match
    const imageLastName = normalizedImageName.split(' ').pop();
    const witnessLastName = normalizedWitnessName.split(' ').pop();
    
    if (imageLastName === witnessLastName && imageLastName.length > 3) {
      return witness;
    }
  }
  
  return null;
}

async function main() {
  console.log('=== Witness Image Extractor ===\n');
  
  // Load witness index
  console.log('Loading witness index...');
  const witnessIndex = JSON.parse(fs.readFileSync(WITNESS_INDEX_PATH, 'utf8'));
  console.log(`Found ${witnessIndex.witnesses.length} witnesses in index\n`);
  
  // Fetch the witnesses page
  console.log('Fetching Yad Vashem witnesses page...');
  let html;
  try {
    html = await fetchUrl(WITNESSES_PAGE);
    console.log(`Fetched ${html.length} bytes\n`);
  } catch (err) {
    console.error('Failed to fetch page:', err.message);
    process.exit(1);
  }
  
  // Parse witness images
  console.log('Parsing witness images...');
  const images = parseWitnessImages(html);
  console.log(`Found ${images.length} witness images\n`);
  
  // Download images and update index
  let downloaded = 0;
  let matched = 0;
  let failed = 0;
  
  for (const img of images) {
    const localFilename = img.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const localPath = path.join(OUTPUT_DIR, localFilename);
    
    // Download if not exists
    if (!fs.existsSync(localPath)) {
      try {
        console.log(`Downloading: ${img.name} -> ${localFilename}`);
        await downloadImage(img.url, localPath);
        downloaded++;
      } catch (err) {
        console.error(`  Failed: ${err.message}`);
        failed++;
        continue;
      }
    } else {
      console.log(`Already exists: ${localFilename}`);
    }
    
    // Find matching witness in index
    const matchedWitness = findMatchingWitness(img.name, witnessIndex);
    if (matchedWitness) {
      matchedWitness.image = `/images/witnesses/${localFilename}`;
      matched++;
      console.log(`  Matched: ${img.name} -> ${matchedWitness.english}`);
    } else {
      console.log(`  No match found for: ${img.name}`);
    }
  }
  
  // Save updated index
  console.log('\nSaving updated witness index...');
  fs.writeFileSync(WITNESS_INDEX_PATH, JSON.stringify(witnessIndex, null, 2));
  
  // Summary
  console.log('\n=== Summary ===');
  console.log(`Images found: ${images.length}`);
  console.log(`Downloaded: ${downloaded}`);
  console.log(`Matched to witnesses: ${matched}`);
  console.log(`Failed: ${failed}`);
  console.log(`\nImages saved to: ${OUTPUT_DIR}`);
  console.log(`Index updated: ${WITNESS_INDEX_PATH}`);
}

main().catch(console.error);
