const fs = require('fs');
const path = require('path');

// Read API key from .env.local
const envPath = path.join(__dirname, '../.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const OPENAI_API_KEY = envContent.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();

async function callOpenAI(prompt, systemPrompt) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0,
      response_format: { type: 'json_object' }
    }),
  });

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message);
  }
  return JSON.parse(data.choices[0].message.content);
}

async function findDuplicates(entities, type) {
  console.log(`\nAnalyzing ${entities.length} ${type} entities...`);
  
  // Extract just names and IDs for analysis
  const entityList = entities.map(e => ({
    id: e.id,
    name: e.name,
    englishName: e.englishName,
    variants: e.variants || []
  }));

  const systemPrompt = `You are a data quality expert specializing in Holocaust historical records from the Eichmann trial.
Your task is to identify duplicate entities that refer to the same real-world ${type.toLowerCase()}.

Consider:
- Different spellings (Mordechai vs Mordeichai)
- Name variations (Dr. prefix, middle names)
- Explicit duplicates marked with "(duplicate)"
- Typos and transliteration differences
- Same person with/without titles

Return a JSON object with:
{
  "duplicates": [
    {
      "canonical_id": "the ID to keep as the main entity",
      "canonical_name": "the best/most complete name to use",
      "merge_ids": ["list of IDs that should be merged into canonical"],
      "reason": "brief explanation"
    }
  ],
  "normalizations": [
    {
      "id": "entity id",
      "original_name": "current name",
      "normalized_name": "corrected/improved name",
      "reason": "why the change"
    }
  ]
}

Only include entries where you're confident they are duplicates or need normalization.
If no duplicates or normalizations are needed, return empty arrays.`;

  const prompt = `Here are ${type} entities from the Eichmann trial records. Identify duplicates and suggest name normalizations:

${JSON.stringify(entityList, null, 2)}`;

  try {
    const result = await callOpenAI(prompt, systemPrompt);
    console.log(`  Found ${result.duplicates?.length || 0} duplicate groups, ${result.normalizations?.length || 0} normalizations`);
    return result;
  } catch (error) {
    console.error(`  Error: ${error.message}`);
    return { duplicates: [], normalizations: [] };
  }
}

async function main() {
  console.log('Loading entities...');
  const dataPath = path.join(__dirname, '../public/data/entities-consolidated.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  
  console.log(`Total nodes: ${data.nodes.length}`);
  console.log(`Total edges: ${data.edges.length}`);

  // Group by type (excluding witnesses which we want to keep as-is)
  const byType = {};
  data.nodes.forEach(n => {
    // Skip witnesses - they're verified
    if (n.isWitness) return;
    if (!byType[n.type]) byType[n.type] = [];
    byType[n.type].push(n);
  });

  const allDuplicates = [];
  const allNormalizations = [];

  // Process each type
  for (const [type, entities] of Object.entries(byType)) {
    if (entities.length < 2) continue;
    
    const result = await findDuplicates(entities, type);
    if (result.duplicates) allDuplicates.push(...result.duplicates);
    if (result.normalizations) allNormalizations.push(...result.normalizations);
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Total duplicate groups: ${allDuplicates.length}`);
  console.log(`Total normalizations: ${allNormalizations.length}`);

  if (allDuplicates.length > 0) {
    console.log('\nDuplicate groups to merge:');
    allDuplicates.forEach(d => {
      console.log(`  ${d.canonical_name}: merge ${d.merge_ids.join(', ')} (${d.reason})`);
    });
  }

  if (allNormalizations.length > 0) {
    console.log('\nName normalizations:');
    allNormalizations.forEach(n => {
      console.log(`  "${n.original_name}" → "${n.normalized_name}" (${n.reason})`);
    });
  }

  // Apply changes
  if (allDuplicates.length > 0 || allNormalizations.length > 0) {
    console.log('\nApplying changes...');

    // Create merge map: old_id -> canonical_id
    const mergeMap = {};
    const idsToRemove = new Set();
    
    allDuplicates.forEach(dup => {
      dup.merge_ids.forEach(oldId => {
        mergeMap[oldId] = dup.canonical_id;
        idsToRemove.add(oldId);
      });
      
      // Update canonical entity name
      const canonical = data.nodes.find(n => n.id === dup.canonical_id);
      if (canonical) {
        canonical.name = dup.canonical_name;
        // Add merged names as variants
        if (!canonical.variants) canonical.variants = [];
        dup.merge_ids.forEach(mergedId => {
          const merged = data.nodes.find(n => n.id === mergedId);
          if (merged && merged.name !== canonical.name) {
            canonical.variants.push(merged.name);
          }
        });
      }
    });

    // Apply normalizations
    allNormalizations.forEach(norm => {
      const entity = data.nodes.find(n => n.id === norm.id);
      if (entity) {
        if (!entity.variants) entity.variants = [];
        entity.variants.push(entity.name);
        entity.name = norm.normalized_name;
      }
    });

    // Update edges to point to canonical IDs
    data.edges = data.edges.map(edge => ({
      ...edge,
      source: mergeMap[edge.source] || edge.source,
      target: mergeMap[edge.target] || edge.target
    }));

    // Remove duplicate edges
    const edgeKeys = new Set();
    data.edges = data.edges.filter(edge => {
      const key = `${edge.source}-${edge.target}-${edge.type}`;
      if (edgeKeys.has(key)) return false;
      edgeKeys.add(key);
      return true;
    });

    // Remove merged nodes
    data.nodes = data.nodes.filter(n => !idsToRemove.has(n.id));

    // Update metadata
    data.metadata.totalNodes = data.nodes.length;
    data.metadata.totalEdges = data.edges.length;
    data.metadata.lastConsolidated = new Date().toISOString();

    // Recalculate type counts
    const typeCounts = {};
    data.nodes.forEach(n => {
      typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
    });
    data.metadata.typeCounts = typeCounts;

    // Save
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
    console.log(`\nSaved! New totals: ${data.nodes.length} nodes, ${data.edges.length} edges`);
  } else {
    console.log('\nNo changes needed.');
  }
}

main().catch(console.error);
