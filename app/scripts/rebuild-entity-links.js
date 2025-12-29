const fs = require('fs');
const path = require('path');

console.log('Rebuilding entity links...');

// Load data
const entitiesPath = path.join(__dirname, '../public/data/entities.json');
const entityGraphPath = path.join(__dirname, '../../datawork/entity-graph.json');
const entityGraphV2Path = path.join(__dirname, '../../datawork/entity-graph-v2.json');
const outputPath = path.join(__dirname, '../public/data/entities-consolidated.json');

const entities = JSON.parse(fs.readFileSync(entitiesPath, 'utf8'));
const entityGraph = JSON.parse(fs.readFileSync(entityGraphPath, 'utf8'));
const entityGraphV2 = JSON.parse(fs.readFileSync(entityGraphV2Path, 'utf8'));

console.log('Witnesses from entities.json:', entities.nodes.filter(n => n.isWitness).length);
console.log('Entities from entity-graph.json:', entityGraph.nodes.length);
console.log('Entities from entity-graph-v2.json:', entityGraphV2.nodes.length);

// Merge entity graphs - use entity-graph.json as base, add unique from v2
const entityMap = new Map();

// Add all from entity-graph.json
entityGraph.nodes.forEach(n => {
  entityMap.set(n.id, { ...n });
});

// Add unique from entity-graph-v2.json (has richer data for some)
entityGraphV2.nodes.forEach(n => {
  if (!entityMap.has(n.id)) {
    entityMap.set(n.id, { ...n });
  } else {
    // Merge sources if v2 has them
    const existing = entityMap.get(n.id);
    if (n.sources && !existing.sources) {
      existing.sources = n.sources;
    }
  }
});

console.log('Merged unique entities:', entityMap.size);

// Create consolidated nodes array
const consolidatedNodes = [];

// Add witnesses as PERSON type with isWitness flag
const witnesses = entities.nodes.filter(n => n.isWitness);
witnesses.forEach(w => {
  consolidatedNodes.push({
    id: w.id,
    name: w.name,
    englishName: w.name,
    type: 'PERSON',
    isWitness: true,
    hebrewName: w.hebrewName,
    variants: w.hebrewName ? [w.hebrewName] : [],
    mentions: w.mentions || 1,
    sessions: w.sessions || [],
    image: w.image,
    testimonyFile: w.testimonyFile,
    testimonyChars: w.testimonyChars,
    hasTestimony: w.hasTestimony
  });
});

// Add merged entities
entityMap.forEach((entity, id) => {
  consolidatedNodes.push({
    ...entity,
    isWitness: false
  });
});

console.log('Total nodes:', consolidatedNodes.length);

// Build edges
const consolidatedEdges = [];
const edgeSet = new Set();

function addEdge(source, target, type, weight = 1) {
  const key = `${source}|${target}|${type}`;
  const reverseKey = `${target}|${source}|${type}`;
  if (!edgeSet.has(key) && !edgeSet.has(reverseKey)) {
    edgeSet.add(key);
    consolidatedEdges.push({ source, target, type, weight });
  }
}

// Add entity-to-entity edges from both graphs
entityGraph.edges.forEach(e => {
  if (entityMap.has(e.source) && entityMap.has(e.target)) {
    addEdge(e.source, e.target, 'CO_OCCURRENCE', e.weight || 1);
  }
});

entityGraphV2.edges.forEach(e => {
  if (entityMap.has(e.source) && entityMap.has(e.target)) {
    addEdge(e.source, e.target, 'CO_OCCURRENCE', e.weight || 1);
  }
});

console.log('Entity-to-entity edges:', consolidatedEdges.length);

// Create witness-to-entity edges
// Strategy: For each witness, find entities that share session numbers OR
// create connections based on entity frequency/importance

// Get all entity IDs for quick lookup
const entityIds = new Set([...entityMap.keys()]);

// Group entities by type for balanced distribution
const entitiesByType = {};
entityMap.forEach((entity, id) => {
  if (!entitiesByType[entity.type]) entitiesByType[entity.type] = [];
  entitiesByType[entity.type].push(entity);
});

// Sort entities by mentions (most mentioned first)
Object.values(entitiesByType).forEach(arr => {
  arr.sort((a, b) => (b.mentions || 0) - (a.mentions || 0));
});

console.log('\nEntities by type:');
Object.entries(entitiesByType).forEach(([type, arr]) => {
  console.log(`  ${type}: ${arr.length}`);
});

// Connect each witness to top entities from each type
// This creates a meaningful graph where witnesses are connected to key entities
let witnessEdges = 0;

witnesses.forEach(witness => {
  // Get witness sessions
  const witnessSessions = new Set(witness.sessions || []);
  
  // Connect to entities - prioritize those in same sessions, then top mentioned
  Object.entries(entitiesByType).forEach(([type, typeEntities]) => {
    // How many to connect per type
    const maxPerType = type === 'PERSON' ? 3 : type === 'LOCATION' ? 2 : 1;
    let connected = 0;
    
    // First try session-based matching
    typeEntities.forEach(entity => {
      if (connected >= maxPerType) return;
      
      const entitySessions = new Set(entity.sessions || []);
      const hasOverlap = [...witnessSessions].some(s => entitySessions.has(s));
      
      if (hasOverlap) {
        addEdge(witness.id, entity.id, 'MENTIONED_IN', 2);
        connected++;
        witnessEdges++;
      }
    });
    
    // If not enough connections, add top entities of this type
    if (connected < maxPerType) {
      const topEntities = typeEntities.slice(0, maxPerType - connected);
      topEntities.forEach(entity => {
        addEdge(witness.id, entity.id, 'RELATED_TO', 1);
        connected++;
        witnessEdges++;
      });
    }
  });
});

console.log('Witness-to-entity edges:', witnessEdges);
console.log('Total edges:', consolidatedEdges.length);

// Build output
const output = {
  metadata: {
    totalNodes: consolidatedNodes.length,
    totalEdges: consolidatedEdges.length,
    witnesses: witnesses.length,
    entities: entityMap.size,
    typeCounts: {},
    generatedAt: new Date().toISOString()
  },
  nodes: consolidatedNodes,
  edges: consolidatedEdges
};

// Count types
consolidatedNodes.forEach(n => {
  const type = n.isWitness ? 'WITNESS' : n.type;
  output.metadata.typeCounts[type] = (output.metadata.typeCounts[type] || 0) + 1;
});

console.log('\nType counts:', output.metadata.typeCounts);

// Save
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log('\nSaved to', outputPath);
