#!/usr/bin/env node
/**
 * Fix script for entities-consolidated.json
 * 
 * This script:
 * 1. Removes all hardcoded "day" fields (will be computed in frontend)
 * 2. Fixes specific session dates based on corrections list
 * 3. Fixes witness linkages (Session 61/62)
 * 4. Creates anonymous witness entities for Session 69
 * 5. Fixes session phases
 * 6. Updates metadata
 */

const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, '../app/public/data/entities-consolidated.json');
const OUTPUT_FILE = INPUT_FILE; // Overwrite in place

console.log('Loading entities file...');
const data = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));

// Helper to get day of week from date
function getDayOfWeek(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

// =============================================================================
// 1. REMOVE ALL "day" FIELDS
// =============================================================================
console.log('\n1. Removing hardcoded "day" fields...');
let dayFieldsRemoved = 0;

data.nodes.forEach(node => {
  if (node.day !== undefined) {
    delete node.day;
    dayFieldsRemoved++;
  }
});

console.log(`   Removed ${dayFieldsRemoved} "day" fields`);

// =============================================================================
// 2. FIX SESSION DATES
// =============================================================================
console.log('\n2. Fixing session dates...');

const dateCorrections = {
  // Format: sessionNumber: 'YYYY-MM-DD'
  // Based on user's list with specific date mentions
  39: '1961-05-15',  // לתקן ל15.5.61, יום שני
  62: '1961-06-01',  // לתקן ל1.6.61, יום חמישי
  75: '1961-06-20',  // לתקן ל20.6.61, יום שלישי
  77: '1961-06-22',  // לתקן ל22.6.61, יום חמישי
  78: '1961-06-23',  // לתקן ל23.6.61, יום שישי
  80: '1961-06-27',  // לתקן ל27.6.61, יום שלישי
  82: '1961-06-29',  // לתקן ל29.6.61, יום חמישי
  83: '1961-06-30',  // לתקן ל30.6.61, יום שישי
  84: '1961-07-03',  // לתקן ל3.7.61, יום שני
  85: '1961-07-04',  // לתקן ל4.7.61, יום שלישי
  117: '1961-12-11', // Fix ordering - should be same day as 115/116
};

let datesFixed = 0;
data.nodes.forEach(node => {
  if (node.type === 'SESSION' && dateCorrections[node.number]) {
    const oldDate = node.date;
    const newDate = dateCorrections[node.number];
    console.log(`   Session ${node.number}: ${oldDate} -> ${newDate} (${getDayOfWeek(newDate)})`);
    node.date = newDate;
    datesFixed++;
  }
});

console.log(`   Fixed ${datesFixed} session dates`);

// =============================================================================
// 3. FIX WITNESS LINKAGES
// =============================================================================
console.log('\n3. Fixing witness linkages...');

// Find witness entities
const zimermanWitness = data.nodes.find(n => n.id === 'witness_51'); // Henryk Zvi Zimerman
const gordonWitness = data.nodes.find(n => n.id === 'witness_61');   // Lesley Gordon

// Fix: Zimerman and Gordon should be in session 62, NOT 61
if (zimermanWitness) {
  if (zimermanWitness.sessions.includes(61)) {
    zimermanWitness.sessions = zimermanWitness.sessions.filter(s => s !== 61);
    if (!zimermanWitness.sessions.includes(62)) {
      zimermanWitness.sessions.push(62);
    }
    console.log(`   Fixed Henryk Zvi Zimerman: removed from session 61, ensured in session 62`);
  }
}

if (gordonWitness) {
  if (gordonWitness.sessions.includes(61)) {
    gordonWitness.sessions = gordonWitness.sessions.filter(s => s !== 61);
    if (!gordonWitness.sessions.includes(62)) {
      gordonWitness.sessions.push(62);
    }
    console.log(`   Fixed Lesley Gordon: removed from session 61, ensured in session 62`);
  }
}

// Update session 61 witnessIds
const session61 = data.nodes.find(n => n.type === 'SESSION' && n.number === 61);
if (session61 && session61.witnessIds) {
  const originalCount = session61.witnessIds.length;
  session61.witnessIds = session61.witnessIds.filter(id => 
    id !== 'witness_51' && id !== 'witness_61'
  );
  console.log(`   Session 61 witnessIds: removed Zimerman and Gordon (${originalCount} -> ${session61.witnessIds.length})`);
}

// Update session 62 witnessIds to include them
const session62 = data.nodes.find(n => n.type === 'SESSION' && n.number === 62);
if (session62 && session62.witnessIds) {
  if (!session62.witnessIds.includes('witness_51')) {
    session62.witnessIds.push('witness_51');
  }
  if (!session62.witnessIds.includes('witness_61')) {
    session62.witnessIds.push('witness_61');
  }
  console.log(`   Session 62 witnessIds: ensured Zimerman and Gordon are included`);
}

// =============================================================================
// 4. CREATE ANONYMOUS WITNESS ENTITIES FOR SESSION 69
// =============================================================================
console.log('\n4. Creating anonymous witness entities...');

// Check if they already exist
const existingAnonymousA = data.nodes.find(n => n.id === 'witness_anonymous_a');
const existingAnonymousB = data.nodes.find(n => n.id === 'witness_anonymous_b');

if (!existingAnonymousA) {
  const anonymousWitnessA = {
    id: 'witness_anonymous_a',
    type: 'PERSON',
    name: 'Anonymous Witness A',
    hebrewName: "עד א'",
    englishName: 'Anonymous Witness A',
    isWitness: true,
    role: 'Witness',
    sessions: [69],
    mentions: 1,
    image: '/images/witnesses/anonymous.jpg',
    testimony: {
      he: null,
      en: null
    }
  };
  // Insert after other witnesses (find last witness index)
  const lastWitnessIndex = data.nodes.reduce((lastIdx, node, idx) => {
    return node.id && node.id.startsWith('witness_') ? idx : lastIdx;
  }, 0);
  data.nodes.splice(lastWitnessIndex + 1, 0, anonymousWitnessA);
  console.log(`   Created Anonymous Witness A (עד א')`);
}

if (!existingAnonymousB) {
  const anonymousWitnessB = {
    id: 'witness_anonymous_b',
    type: 'PERSON',
    name: 'Anonymous Witness B',
    hebrewName: "עד ב'",
    englishName: 'Anonymous Witness B',
    isWitness: true,
    role: 'Witness',
    sessions: [69],
    mentions: 1,
    image: '/images/witnesses/anonymous.jpg',
    testimony: {
      he: null,
      en: null
    }
  };
  const lastWitnessIndex = data.nodes.reduce((lastIdx, node, idx) => {
    return node.id && node.id.startsWith('witness_') ? idx : lastIdx;
  }, 0);
  data.nodes.splice(lastWitnessIndex + 1, 0, anonymousWitnessB);
  console.log(`   Created Anonymous Witness B (עד ב')`);
}

// Add anonymous witnesses to session 69
const session69 = data.nodes.find(n => n.type === 'SESSION' && n.number === 69);
if (session69 && session69.witnessIds) {
  if (!session69.witnessIds.includes('witness_anonymous_a')) {
    session69.witnessIds.push('witness_anonymous_a');
  }
  if (!session69.witnessIds.includes('witness_anonymous_b')) {
    session69.witnessIds.push('witness_anonymous_b');
  }
  console.log(`   Added anonymous witnesses to Session 69`);
}

// =============================================================================
// 5. FIX SESSION PHASES
// =============================================================================
console.log('\n5. Fixing session phases...');

const phaseCorrections = {
  // Sessions 1-5: Opening
  // Sessions 6-8: Opening Statement  
  // Sessions 9-74: Prosecution Evidence
  // Sessions 75-109: Defense (Eichmann's testimony starts at 75)
  75: 'Defense Testimony',
  76: 'Defense Testimony',
  77: 'Defense Testimony',
  78: 'Defense Testimony',
  79: 'Defense Testimony',
  80: 'Defense Testimony',
  81: 'Defense Testimony',
  82: 'Defense Testimony',
  83: 'Defense Testimony',
  84: 'Defense Testimony',
  85: 'Prosecution Rebuttal', // Returns to prosecution witnesses (foreign)
  86: 'Defense Testimony',
  87: 'Defense Testimony',
  88: 'Defense Testimony',
  89: 'Defense Testimony',
  90: 'Cross Examination',  // חקירת שתי וערב
  91: 'Cross Examination',
  92: 'Cross Examination',
  93: 'Cross Examination',
  94: 'Cross Examination',
  95: 'Cross Examination',
  96: 'Cross Examination',
  97: 'Cross Examination',
  98: 'Cross Examination',
  99: 'Cross Examination',
  100: 'Cross Examination',
  101: 'Cross Examination',
  102: 'Cross Examination',
  103: 'Cross Examination',
  104: 'Cross Examination',
  105: 'Redirect Examination', // חקירה חוזרת
  106: 'Judges Questions',     // שאלות השופטים
  107: 'Judges Questions',
  108: 'Prosecution Rebuttal', // עדויות מחו"ל
  109: 'Defense Testimony',    // חזרה לעדות אייכמן
  110: 'Closing Arguments',    // נאום הסגירה מתחיל
  111: 'Closing Arguments',
  112: 'Closing Arguments',
  113: 'Closing Arguments',
  114: 'Defense Closing',
  115: 'Verdict',
  116: 'Verdict',
  117: 'Verdict',
  118: 'Verdict',
  119: 'Verdict',
  120: 'Verdict',
  121: 'Sentencing',
};

let phasesFixed = 0;
data.nodes.forEach(node => {
  if (node.type === 'SESSION' && phaseCorrections[node.number]) {
    const oldPhase = node.phase;
    const newPhase = phaseCorrections[node.number];
    if (oldPhase !== newPhase) {
      console.log(`   Session ${node.number}: "${oldPhase}" -> "${newPhase}"`);
      node.phase = newPhase;
      phasesFixed++;
    }
  }
});

console.log(`   Fixed ${phasesFixed} session phases`);

// =============================================================================
// 6. UPDATE METADATA
// =============================================================================
console.log('\n6. Updating metadata...');

// Recount nodes by type
const typeCounts = {};
data.nodes.forEach(node => {
  typeCounts[node.type] = (typeCounts[node.type] || 0) + 1;
});

data.metadata.totalNodes = data.nodes.length;
data.metadata.typeCounts = typeCounts;
data.metadata.lastUpdated = new Date().toISOString();

console.log(`   Total nodes: ${data.metadata.totalNodes}`);
console.log(`   Type counts:`, typeCounts);

// =============================================================================
// SAVE
// =============================================================================
console.log('\n7. Saving file...');
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2), 'utf8');
console.log(`   Saved to ${OUTPUT_FILE}`);

console.log('\n✅ All fixes applied successfully!');
