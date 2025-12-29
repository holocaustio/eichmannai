#!/usr/bin/env node

/**
 * Add witness images to entities.json
 * Merges image paths from witness-index.json into the entities.json file
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WITNESS_INDEX_PATH = path.join(__dirname, 'witness-index.json');
const ENTITIES_PATH = path.join(__dirname, '../app/public/data/entities.json');

// Normalize name for matching
function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/^dr\.?\s*/i, '')
    .replace(/^prof\.?\s*/i, '')
    .replace(/^judge\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  console.log('=== Add Images to Entities ===\n');
  
  // Load files
  console.log('Loading witness index...');
  const witnessIndex = JSON.parse(fs.readFileSync(WITNESS_INDEX_PATH, 'utf8'));
  
  console.log('Loading entities...');
  const entities = JSON.parse(fs.readFileSync(ENTITIES_PATH, 'utf8'));
  
  // Create a map of normalized names to images
  const imageMap = new Map();
  for (const witness of witnessIndex.witnesses) {
    if (witness.image) {
      imageMap.set(normalizeName(witness.english), witness.image);
    }
  }
  
  console.log(`Found ${imageMap.size} witness images\n`);
  
  // Update entities
  let updated = 0;
  for (const node of entities.nodes) {
    if (node.isWitness && node.name) {
      const normalized = normalizeName(node.name);
      const image = imageMap.get(normalized);
      
      if (image) {
        node.image = image;
        updated++;
        console.log(`Added image for: ${node.name}`);
      }
    }
  }
  
  // Save updated entities
  console.log('\nSaving updated entities...');
  fs.writeFileSync(ENTITIES_PATH, JSON.stringify(entities, null, 2));
  
  console.log(`\n=== Summary ===`);
  console.log(`Updated ${updated} witnesses with images`);
  console.log(`Entities saved to: ${ENTITIES_PATH}`);
}

main().catch(console.error);
