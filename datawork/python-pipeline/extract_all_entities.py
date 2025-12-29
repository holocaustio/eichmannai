#!/usr/bin/env python3
"""
Full Entity Extraction Pipeline - All Files

Processes all clean OCR files to extract:
- Witnesses (validated against 108 official witnesses)
- Sessions
- Key figures (prosecutors, defense, judges)
- Other entities (persons, locations, organizations)

Outputs proper node/edge graph structure.

Usage:
    python extract_all_entities.py
"""

import json
import re
from pathlib import Path
from datetime import datetime
from typing import List, Dict
from collections import defaultdict

# =============================================================================
# Configuration
# =============================================================================

BASE_DIR = Path(__file__).parent.parent.parent
OCR_DIR = BASE_DIR / "downloads" / "pdf" / "OCR_clean"  # Use clean OCR!
OUTPUT_DIR = BASE_DIR / "app" / "public" / "data"
WITNESS_INDEX_FILE = BASE_DIR / "eichmann-entities" / "witness-index.json"

# Files to skip (too small or not transcript)
SKIP_FILES = {"Vol5_band", "Vol6_band"}  # These are audio files with no text

# =============================================================================
# Load Witness Index
# =============================================================================

def load_witness_index() -> Dict:
    """Load the official witness index."""
    if not WITNESS_INDEX_FILE.exists():
        print(f"❌ Witness index not found: {WITNESS_INDEX_FILE}")
        return {"witnesses": [], "keyFigures": {}, "lookup": {}, "key_lookup": {}}
    
    with open(WITNESS_INDEX_FILE, encoding='utf-8') as f:
        data = json.load(f)
    
    # Build lookup tables
    witness_lookup = {}
    for w in data.get("witnesses", []):
        hebrew = w.get("hebrew", "")
        english = w.get("english", "")
        alias = w.get("alias", "")
        
        entry = {"hebrew": hebrew, "english": english, "isWitness": True}
        
        # Index by various forms
        if hebrew:
            witness_lookup[hebrew] = entry
            witness_lookup[hebrew.lower()] = entry
            # Index by last name
            parts = hebrew.split()
            if len(parts) > 1:
                witness_lookup[parts[-1]] = entry
            # Without title prefixes
            for prefix in ["דר'", "דר׳", 'ד"ר', "פרופ'", "פרופ׳"]:
                if hebrew.startswith(prefix):
                    clean = hebrew[len(prefix):].strip()
                    witness_lookup[clean] = entry
        
        if alias:
            witness_lookup[alias] = entry
    
    # Build key figures lookup
    key_lookup = {}
    for category, figures in data.get("keyFigures", {}).items():
        for fig in figures:
            hebrew = fig.get("hebrew", "")
            english = fig.get("english", "")
            role = fig.get("role", category)
            variants = fig.get("variants", [])
            
            entry = {
                "hebrew": hebrew,
                "english": english,
                "role": role,
                "category": category,
                "isWitness": False
            }
            
            if hebrew:
                key_lookup[hebrew] = entry
                key_lookup[hebrew.lower()] = entry
            
            for v in variants:
                key_lookup[v] = entry
                key_lookup[v.lower()] = entry
    
    return {
        "witnesses": data.get("witnesses", []),
        "keyFigures": data.get("keyFigures", {}),
        "lookup": witness_lookup,
        "key_lookup": key_lookup
    }


# =============================================================================
# Text Processing
# =============================================================================

def normalize_text(text: str) -> str:
    """Normalize Hebrew text."""
    # Remove RTL/LTR markers
    text = re.sub(r'[\u200e\u200f\u202a-\u202e]', '', text)
    # Normalize quotes
    text = text.replace('״', '"').replace("׳", "'")
    return text


def detect_sessions(text: str) -> List[Dict]:
    """Detect session markers in text."""
    sessions = []
    # Pattern: ישיבה מס' X or ישיבה מס׳ X
    pattern = r'ישיבה\s+מס[\'׳\']?\s*(\d+)'
    
    for match in re.finditer(pattern, text):
        sessions.append({
            "number": int(match.group(1)),
            "position": match.start()
        })
    
    return sessions


def find_witness_mentions(text: str, lines: List[str], witness_index: Dict, file_name: str) -> Dict[str, Dict]:
    """Find all witness mentions in text and their line locations."""
    found_witnesses = {}
    
    for name, info in witness_index.get("lookup", {}).items():
        if len(name) < 3:  # Skip very short names
            continue
            
        # Search for mentions
        mentions = []
        for i, line in enumerate(lines):
            if name in line:
                mentions.append(i + 1)  # 1-based line numbers
        
        if mentions:
            hebrew = info["hebrew"]
            english = info["english"]
            key = hebrew or english
            
            if key not in found_witnesses:
                found_witnesses[key] = {
                    "hebrew": hebrew,
                    "english": english,
                    "isWitness": True,
                    "mentions": [],
                    "sources": []
                }
            
            found_witnesses[key]["mentions"].extend(mentions)
            
            # Add source info
            min_line = min(mentions)
            max_line = max(mentions)
            
            # Detect session for this mention
            session_num = 0
            text_before = '\n'.join(lines[:max(0, min_line - 1)])
            session_matches = list(re.finditer(r'ישיבה\s+מס[\'׳\']?\s*(\d+)', text_before))
            if session_matches:
                session_num = int(session_matches[-1].group(1))
            
            found_witnesses[key]["sources"].append({
                "file": file_name,
                "lineStart": min_line,
                "lineEnd": max_line,
                "session": session_num
            })
    
    return found_witnesses


def find_key_figures(text: str, lines: List[str], witness_index: Dict, file_name: str) -> Dict[str, Dict]:
    """Find key figures (prosecutor, defense, judges)."""
    found = {}
    
    for name, info in witness_index.get("key_lookup", {}).items():
        if len(name) < 3:
            continue
            
        mentions = []
        for i, line in enumerate(lines):
            if name in line:
                mentions.append(i + 1)
        
        if mentions:
            key = info["hebrew"] or info["english"]
            
            if key not in found:
                found[key] = {
                    "hebrew": info["hebrew"],
                    "english": info["english"],
                    "role": info["role"],
                    "category": info["category"],
                    "isWitness": False,
                    "mentions": [],
                    "sources": []
                }
            
            found[key]["mentions"].extend(mentions)
            
            min_line = min(mentions)
            max_line = max(mentions)
            
            session_num = 0
            text_before = '\n'.join(lines[:max(0, min_line - 1)])
            session_matches = list(re.finditer(r'ישיבה\s+מס[\'׳\']?\s*(\d+)', text_before))
            if session_matches:
                session_num = int(session_matches[-1].group(1))
            
            found[key]["sources"].append({
                "file": file_name,
                "lineStart": min_line,
                "lineEnd": max_line,
                "session": session_num
            })
    
    return found


# =============================================================================
# Process Single File
# =============================================================================

def process_file(file_path: Path, witness_index: Dict) -> Dict:
    """Process a single OCR file and extract entities."""
    file_name = file_path.name
    
    text = file_path.read_text(encoding='utf-8')
    text = normalize_text(text)
    lines = text.split('\n')
    
    # Detect sessions
    sessions = detect_sessions(text)
    
    # Find witnesses
    witnesses = find_witness_mentions(text, lines, witness_index, file_name)
    
    # Find key figures
    key_figures = find_key_figures(text, lines, witness_index, file_name)
    
    return {
        "file": file_name,
        "chars": len(text),
        "lines": len(lines),
        "sessions": sessions,
        "witnesses": witnesses,
        "key_figures": key_figures
    }


# =============================================================================
# Merge Results
# =============================================================================

def merge_results(all_results: List[Dict], witness_index: Dict) -> Dict:
    """Merge results from all files into a single graph."""
    
    # Collect all entities
    all_witnesses = {}
    all_key_figures = {}
    all_sessions = set()
    
    for result in all_results:
        file_name = result["file"]
        
        # Merge witnesses
        for key, data in result.get("witnesses", {}).items():
            if key not in all_witnesses:
                all_witnesses[key] = {
                    "hebrew": data["hebrew"],
                    "english": data["english"],
                    "isWitness": True,
                    "mentions": [],
                    "sources": [],
                    "sessions": set()
                }
            
            all_witnesses[key]["mentions"].extend(data["mentions"])
            all_witnesses[key]["sources"].extend(data["sources"])
            
            for src in data["sources"]:
                if src["session"] > 0:
                    all_witnesses[key]["sessions"].add(src["session"])
        
        # Merge key figures
        for key, data in result.get("key_figures", {}).items():
            if key not in all_key_figures:
                all_key_figures[key] = {
                    "hebrew": data["hebrew"],
                    "english": data["english"],
                    "role": data["role"],
                    "category": data["category"],
                    "isWitness": False,
                    "mentions": [],
                    "sources": [],
                    "sessions": set()
                }
            
            all_key_figures[key]["mentions"].extend(data["mentions"])
            all_key_figures[key]["sources"].extend(data["sources"])
            
            for src in data["sources"]:
                if src["session"] > 0:
                    all_key_figures[key]["sessions"].add(src["session"])
        
        # Collect sessions
        for s in result.get("sessions", []):
            all_sessions.add(s["number"])
    
    # Build graph nodes
    nodes = []
    node_id = 1
    node_lookup = {}
    
    # Add witnesses
    for key, data in all_witnesses.items():
        node = {
            "id": f"witness_{node_id}",
            "type": "PERSON",
            "name": data["english"] or data["hebrew"],
            "hebrewName": data["hebrew"],
            "englishName": data["english"],
            "isWitness": True,
            "role": "Witness",
            "sessions": sorted(list(data["sessions"])),
            "mentions": len(set(data["mentions"])),
            "sources": dedupe_sources(data["sources"])
        }
        nodes.append(node)
        node_lookup[key] = node["id"]
        node_id += 1
    
    # Add key figures
    for key, data in all_key_figures.items():
        node = {
            "id": f"figure_{node_id}",
            "type": "PERSON",
            "name": data["english"] or data["hebrew"],
            "hebrewName": data["hebrew"],
            "englishName": data["english"],
            "isWitness": False,
            "role": data["role"],
            "category": data["category"],
            "sessions": sorted(list(data["sessions"])),
            "mentions": len(set(data["mentions"])),
            "sources": dedupe_sources(data["sources"])
        }
        nodes.append(node)
        node_lookup[key] = node["id"]
        node_id += 1
    
    # Build sessions
    sessions_list = []
    for num in sorted(all_sessions):
        # Find all witnesses in this session
        session_witnesses = []
        for key, data in all_witnesses.items():
            if num in data["sessions"]:
                session_witnesses.append(node_lookup.get(key))
        
        sessions_list.append({
            "number": num,
            "witnesses": [w for w in session_witnesses if w],
            "hebrewLabel": f"ישיבה מס' {num}"
        })
    
    # Build edges (witness-to-session connections)
    edges = []
    edge_id = 1
    for node in nodes:
        if node.get("isWitness"):
            for session in node.get("sessions", []):
                edges.append({
                    "id": f"edge_{edge_id}",
                    "source": node["id"],
                    "target": f"session_{session}",
                    "type": "TESTIFIED_IN"
                })
                edge_id += 1
    
    # Count official witnesses found
    official_found = 0
    for w in witness_index.get("witnesses", []):
        hebrew = w.get("hebrew", "")
        if hebrew in all_witnesses or any(hebrew in k for k in all_witnesses.keys()):
            official_found += 1
    
    return {
        "metadata": {
            "extractedAt": datetime.now().isoformat(),
            "totalFiles": len(all_results),
            "totalNodes": len(nodes),
            "totalEdges": len(edges),
            "totalSessions": len(sessions_list),
            "validatedWitnesses": len(all_witnesses),
            "officialWitnessesFound": official_found,
            "officialWitnessTotal": len(witness_index.get("witnesses", [])),
            "source": "OCR_clean"
        },
        "nodes": nodes,
        "edges": edges,
        "sessions": sessions_list
    }


def dedupe_sources(sources: List[Dict]) -> List[Dict]:
    """Remove duplicate sources and merge overlapping ranges."""
    by_file = defaultdict(list)
    
    for src in sources:
        by_file[src["file"]].append(src)
    
    result = []
    for file_name, file_sources in by_file.items():
        # Get overall range for this file
        min_line = min(s["lineStart"] for s in file_sources)
        max_line = max(s["lineEnd"] for s in file_sources)
        sessions = set(s["session"] for s in file_sources if s["session"] > 0)
        
        result.append({
            "file": file_name,
            "lineStart": min_line,
            "lineEnd": max_line,
            "session": min(sessions) if sessions else 0
        })
    
    return result


# =============================================================================
# Main
# =============================================================================

def main():
    print("=" * 60)
    print("Full Entity Extraction - All Clean OCR Files")
    print("=" * 60)
    
    start_time = datetime.now()
    
    # Load witness index
    print("\n[1] Loading witness index...")
    witness_index = load_witness_index()
    print(f"    {len(witness_index.get('witnesses', []))} official witnesses")
    print(f"    {sum(len(v) for v in witness_index.get('keyFigures', {}).values())} key figures")
    
    # Get all OCR files
    print("\n[2] Finding OCR files...")
    if not OCR_DIR.exists():
        print(f"❌ OCR directory not found: {OCR_DIR}")
        return
    
    ocr_files = sorted([f for f in OCR_DIR.glob("*.txt") 
                       if not any(skip in f.name for skip in SKIP_FILES)])
    
    # Filter out very small files
    ocr_files = [f for f in ocr_files if f.stat().st_size > 1000]
    
    print(f"    Found {len(ocr_files)} files to process")
    
    # Process each file
    print("\n[3] Processing files...")
    all_results = []
    
    for i, file_path in enumerate(ocr_files):
        print(f"    [{i+1}/{len(ocr_files)}] {file_path.name}...", end=" ", flush=True)
        
        try:
            result = process_file(file_path, witness_index)
            all_results.append(result)
            
            witness_count = len(result.get("witnesses", {}))
            session_count = len(result.get("sessions", []))
            print(f"✓ {witness_count} witnesses, {session_count} sessions")
        except Exception as e:
            print(f"✗ Error: {e}")
    
    # Merge results
    print("\n[4] Merging results...")
    graph = merge_results(all_results, witness_index)
    
    # Print summary
    print("\n" + "=" * 60)
    print("EXTRACTION COMPLETE")
    print("=" * 60)
    print(f"Total files processed: {graph['metadata']['totalFiles']}")
    print(f"Total nodes: {graph['metadata']['totalNodes']}")
    print(f"Total edges: {graph['metadata']['totalEdges']}")
    print(f"Total sessions: {graph['metadata']['totalSessions']}")
    print(f"Witnesses found: {graph['metadata']['validatedWitnesses']}")
    print(f"Official witnesses: {graph['metadata']['officialWitnessesFound']} / {graph['metadata']['officialWitnessTotal']}")
    
    # List witnesses
    witnesses = [n for n in graph["nodes"] if n.get("isWitness")]
    print(f"\nWitnesses ({len(witnesses)}):")
    for w in witnesses[:30]:
        print(f"  ✓ {w['name']} ({w.get('hebrewName', '')})")
    if len(witnesses) > 30:
        print(f"  ... and {len(witnesses) - 30} more")
    
    # Save output
    print("\n[5] Saving output...")
    output_path = OUTPUT_DIR / "entities.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(graph, f, indent=2, ensure_ascii=False)
    
    elapsed = (datetime.now() - start_time).total_seconds()
    print(f"\n✅ Complete in {elapsed:.1f}s")
    print(f"   Output: {output_path}")


if __name__ == "__main__":
    main()

