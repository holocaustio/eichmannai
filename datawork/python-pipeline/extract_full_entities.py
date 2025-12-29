#!/usr/bin/env python3
"""
FULL Entity Extraction Pipeline

Extracts ALL entities:
- ALL 108 witnesses (from witness-index.json)
- Key figures (prosecutors, defense, judges, defendant)
- Locations (countries, cities, camps)
- Organizations
- Sessions
- Other persons

Maintains proper node/edge graph structure.
"""

import json
import re
import os
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Set, Tuple
from collections import defaultdict
import asyncio

# Try to import OpenAI for location/org extraction
try:
    from openai import OpenAI
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False

# =============================================================================
# Configuration
# =============================================================================

BASE_DIR = Path(__file__).parent.parent.parent
OCR_DIR = BASE_DIR / "downloads" / "pdf" / "OCR_clean"
OUTPUT_DIR = BASE_DIR / "app" / "public" / "data"
WITNESS_INDEX_FILE = BASE_DIR / "eichmann-entities" / "witness-index.json"

# Known locations and camps
KNOWN_LOCATIONS = {
    # Camps
    "אושוויץ": {"english": "Auschwitz", "type": "CAMP"},
    "טרבלינקה": {"english": "Treblinka", "type": "CAMP"},
    "בלז׳ץ": {"english": "Belzec", "type": "CAMP"},
    "סוביבור": {"english": "Sobibor", "type": "CAMP"},
    "מיידנק": {"english": "Majdanek", "type": "CAMP"},
    "חלמנו": {"english": "Chelmno", "type": "CAMP"},
    "ברגן-בלזן": {"english": "Bergen-Belsen", "type": "CAMP"},
    "דכאו": {"english": "Dachau", "type": "CAMP"},
    "בוכנוולד": {"english": "Buchenwald", "type": "CAMP"},
    "מאוטהאוזן": {"english": "Mauthausen", "type": "CAMP"},
    "תרזינשטט": {"english": "Theresienstadt", "type": "CAMP"},
    "רוונסבריק": {"english": "Ravensbruck", "type": "CAMP"},
    
    # Ghettos
    "גטו ורשה": {"english": "Warsaw Ghetto", "type": "GHETTO"},
    "גטו לודז׳": {"english": "Lodz Ghetto", "type": "GHETTO"},
    "גטו וילנה": {"english": "Vilna Ghetto", "type": "GHETTO"},
    "גטו קובנה": {"english": "Kovno Ghetto", "type": "GHETTO"},
    "גטו קרקוב": {"english": "Krakow Ghetto", "type": "GHETTO"},
    "גטו ליצמנשטט": {"english": "Litzmannstadt Ghetto", "type": "GHETTO"},
    
    # Countries
    "גרמניה": {"english": "Germany", "type": "COUNTRY"},
    "פולין": {"english": "Poland", "type": "COUNTRY"},
    "אוסטריה": {"english": "Austria", "type": "COUNTRY"},
    "הונגריה": {"english": "Hungary", "type": "COUNTRY"},
    "צ׳כוסלובקיה": {"english": "Czechoslovakia", "type": "COUNTRY"},
    "הולנד": {"english": "Netherlands", "type": "COUNTRY"},
    "בלגיה": {"english": "Belgium", "type": "COUNTRY"},
    "צרפת": {"english": "France", "type": "COUNTRY"},
    "יוון": {"english": "Greece", "type": "COUNTRY"},
    "איטליה": {"english": "Italy", "type": "COUNTRY"},
    "רומניה": {"english": "Romania", "type": "COUNTRY"},
    "ליטא": {"english": "Lithuania", "type": "COUNTRY"},
    "לטביה": {"english": "Latvia", "type": "COUNTRY"},
    "אסטוניה": {"english": "Estonia", "type": "COUNTRY"},
    "ברית המועצות": {"english": "Soviet Union", "type": "COUNTRY"},
    "ארץ ישראל": {"english": "Palestine/Israel", "type": "COUNTRY"},
    "ישראל": {"english": "Israel", "type": "COUNTRY"},
    
    # Cities
    "ברלין": {"english": "Berlin", "type": "CITY"},
    "וינה": {"english": "Vienna", "type": "CITY"},
    "פראג": {"english": "Prague", "type": "CITY"},
    "בודפשט": {"english": "Budapest", "type": "CITY"},
    "ורשה": {"english": "Warsaw", "type": "CITY"},
    "קרקוב": {"english": "Krakow", "type": "CITY"},
    "לודז׳": {"english": "Lodz", "type": "CITY"},
    "וילנה": {"english": "Vilna", "type": "CITY"},
    "ירושלים": {"english": "Jerusalem", "type": "CITY"},
    "תל אביב": {"english": "Tel Aviv", "type": "CITY"},
    "נירנברג": {"english": "Nuremberg", "type": "CITY"},
}

# Known organizations
KNOWN_ORGS = {
    "גסטאפו": {"english": "Gestapo", "type": "ORGANIZATION"},
    "ס״ס": {"english": "SS", "type": "ORGANIZATION"},
    "אס.אס": {"english": "SS", "type": "ORGANIZATION"},
    "ס.ס": {"english": "SS", "type": "ORGANIZATION"},
    "וורמכט": {"english": "Wehrmacht", "type": "ORGANIZATION"},
    "יודנראט": {"english": "Judenrat", "type": "ORGANIZATION"},
    "RSHA": {"english": "RSHA", "type": "ORGANIZATION"},
    "א.ה.ז.ר": {"english": "RSHA", "type": "ORGANIZATION"},
    "משטרת הביטחון": {"english": "Security Police", "type": "ORGANIZATION"},
    "הצלב האדום": {"english": "Red Cross", "type": "ORGANIZATION"},
    "ג׳וינט": {"english": "Joint Distribution Committee", "type": "ORGANIZATION"},
    "יד ושם": {"english": "Yad Vashem", "type": "ORGANIZATION"},
}

# =============================================================================
# Load Witness Index - ALL 108 witnesses
# =============================================================================

def load_witness_index() -> Dict:
    """Load the FULL witness index with all variations."""
    if not WITNESS_INDEX_FILE.exists():
        print(f"❌ Witness index not found: {WITNESS_INDEX_FILE}")
        return {}
    
    with open(WITNESS_INDEX_FILE, encoding='utf-8') as f:
        data = json.load(f)
    
    # Build comprehensive lookup
    witnesses = {}
    for w in data.get("witnesses", []):
        hebrew = w.get("hebrew", "")
        english = w.get("english", "")
        alias = w.get("alias", "")
        
        if not hebrew:
            continue
            
        # Create entry with all search terms
        entry = {
            "hebrew": hebrew,
            "english": english,
            "alias": alias,
            "isWitness": True,
            "searchTerms": set()
        }
        
        # Add full name
        entry["searchTerms"].add(hebrew)
        
        # Add last name (most common reference)
        parts = hebrew.split()
        if len(parts) > 1:
            entry["searchTerms"].add(parts[-1])  # Last name
            entry["searchTerms"].add(parts[0])   # First name
        
        # Handle title prefixes
        for prefix in ["דר'", "דר׳", 'ד"ר', "פרופ'", "פרופ׳"]:
            if hebrew.startswith(prefix):
                clean = hebrew[len(prefix):].strip()
                entry["searchTerms"].add(clean)
                clean_parts = clean.split()
                if clean_parts:
                    entry["searchTerms"].add(clean_parts[-1])
        
        # Add alias
        if alias:
            entry["searchTerms"].add(alias)
        
        # Add variants from index
        variants = w.get("variants", [])
        for v in variants:
            entry["searchTerms"].add(v)
        
        # Remove very short terms (less than 3 chars)
        entry["searchTerms"] = {t for t in entry["searchTerms"] if len(t) >= 3}
        
        witnesses[hebrew] = entry
    
    # Build key figures
    key_figures = {}
    for category, figures in data.get("keyFigures", {}).items():
        for fig in figures:
            hebrew = fig.get("hebrew", "")
            english = fig.get("english", "")
            role = fig.get("role", category)
            variants = fig.get("variants", [])
            
            if not hebrew:
                continue
                
            entry = {
                "hebrew": hebrew,
                "english": english,
                "role": role,
                "category": category,
                "isWitness": False,
                "searchTerms": set([hebrew])
            }
            
            # Add last name
            parts = hebrew.split()
            if len(parts) > 1:
                entry["searchTerms"].add(parts[-1])
            
            # Add variants
            for v in variants:
                entry["searchTerms"].add(v)
            
            key_figures[hebrew] = entry
    
    return {
        "witnesses": witnesses,
        "keyFigures": key_figures,
        "total": len(witnesses)
    }

# =============================================================================
# Text Processing
# =============================================================================

def normalize_text(text: str) -> str:
    """Normalize Hebrew text."""
    text = re.sub(r'[\u200e\u200f\u202a-\u202e]', '', text)
    # Normalize quotes
    text = text.replace('״', '"').replace("׳", "'")
    return text


def detect_sessions(text: str) -> List[Dict]:
    """Detect all sessions in text."""
    sessions = []
    pattern = r'ישיבה\s+מס[\'׳\']?\s*(\d+)'
    
    for match in re.finditer(pattern, text):
        sessions.append({
            "number": int(match.group(1)),
            "position": match.start()
        })
    
    return sessions


# =============================================================================
# Entity Extraction
# =============================================================================

def find_entities_in_file(file_path: Path, witness_index: Dict) -> Dict:
    """Extract all entities from a single file."""
    
    text = file_path.read_text(encoding='utf-8')
    text = normalize_text(text)
    lines = text.split('\n')
    file_name = file_path.name
    
    # Detect sessions
    sessions = detect_sessions(text)
    session_numbers = set(s["number"] for s in sessions)
    
    # Find witnesses
    found_witnesses = {}
    for hebrew_name, info in witness_index.get("witnesses", {}).items():
        mentions = []
        for i, line in enumerate(lines):
            for term in info["searchTerms"]:
                if term in line:
                    mentions.append(i + 1)
                    break
        
        if mentions:
            if hebrew_name not in found_witnesses:
                found_witnesses[hebrew_name] = {
                    "hebrew": info["hebrew"],
                    "english": info["english"],
                    "isWitness": True,
                    "mentions": [],
                    "files": set(),
                    "sessions": set()
                }
            
            found_witnesses[hebrew_name]["mentions"].extend(mentions)
            found_witnesses[hebrew_name]["files"].add(file_name)
            
            # Find session for these mentions
            min_line = min(mentions)
            text_before = '\n'.join(lines[:max(0, min_line - 1)])
            session_matches = list(re.finditer(r'ישיבה\s+מס[\'׳\']?\s*(\d+)', text_before))
            if session_matches:
                found_witnesses[hebrew_name]["sessions"].add(int(session_matches[-1].group(1)))
    
    # Find key figures
    found_key_figures = {}
    for hebrew_name, info in witness_index.get("keyFigures", {}).items():
        mentions = []
        for i, line in enumerate(lines):
            for term in info["searchTerms"]:
                if term in line:
                    mentions.append(i + 1)
                    break
        
        if mentions:
            if hebrew_name not in found_key_figures:
                found_key_figures[hebrew_name] = {
                    "hebrew": info["hebrew"],
                    "english": info["english"],
                    "role": info["role"],
                    "category": info["category"],
                    "isWitness": False,
                    "mentions": [],
                    "files": set(),
                    "sessions": set()
                }
            
            found_key_figures[hebrew_name]["mentions"].extend(mentions)
            found_key_figures[hebrew_name]["files"].add(file_name)
    
    # Find locations
    found_locations = {}
    for hebrew_name, info in KNOWN_LOCATIONS.items():
        mentions = []
        for i, line in enumerate(lines):
            if hebrew_name in line:
                mentions.append(i + 1)
        
        if mentions:
            key = info["english"]
            if key not in found_locations:
                found_locations[key] = {
                    "hebrew": hebrew_name,
                    "english": info["english"],
                    "type": info["type"],
                    "mentions": [],
                    "files": set(),
                    "sessions": set()
                }
            
            found_locations[key]["mentions"].extend(mentions)
            found_locations[key]["files"].add(file_name)
    
    # Find organizations
    found_orgs = {}
    for hebrew_name, info in KNOWN_ORGS.items():
        mentions = []
        for i, line in enumerate(lines):
            if hebrew_name in line:
                mentions.append(i + 1)
        
        if mentions:
            key = info["english"]
            if key not in found_orgs:
                found_orgs[key] = {
                    "hebrew": hebrew_name,
                    "english": info["english"],
                    "type": info["type"],
                    "mentions": [],
                    "files": set(),
                    "sessions": set()
                }
            
            found_orgs[key]["mentions"].extend(mentions)
            found_orgs[key]["files"].add(file_name)
    
    return {
        "file": file_name,
        "lines": len(lines),
        "sessions": sessions,
        "session_numbers": session_numbers,
        "witnesses": found_witnesses,
        "key_figures": found_key_figures,
        "locations": found_locations,
        "organizations": found_orgs
    }


# =============================================================================
# Merge and Build Graph
# =============================================================================

def merge_all_results(all_results: List[Dict], witness_index: Dict) -> Dict:
    """Merge results from all files and build graph."""
    
    # Merged entities
    all_witnesses = {}
    all_key_figures = {}
    all_locations = {}
    all_orgs = {}
    all_sessions = set()
    
    for result in all_results:
        # Sessions
        for s in result.get("session_numbers", set()):
            all_sessions.add(s)
        
        # Witnesses
        for key, data in result.get("witnesses", {}).items():
            if key not in all_witnesses:
                all_witnesses[key] = {
                    "hebrew": data["hebrew"],
                    "english": data["english"],
                    "isWitness": True,
                    "mentions": 0,
                    "files": set(),
                    "sessions": set(),
                    "sources": []
                }
            all_witnesses[key]["mentions"] += len(data["mentions"])
            all_witnesses[key]["files"].update(data["files"])
            all_witnesses[key]["sessions"].update(data["sessions"])
            
            # Add source
            if data["mentions"]:
                all_witnesses[key]["sources"].append({
                    "file": result["file"],
                    "lineStart": min(data["mentions"]),
                    "lineEnd": max(data["mentions"]),
                    "session": min(data["sessions"]) if data["sessions"] else 0
                })
        
        # Key figures
        for key, data in result.get("key_figures", {}).items():
            if key not in all_key_figures:
                all_key_figures[key] = {
                    "hebrew": data["hebrew"],
                    "english": data["english"],
                    "role": data["role"],
                    "category": data["category"],
                    "isWitness": False,
                    "mentions": 0,
                    "files": set(),
                    "sessions": set()
                }
            all_key_figures[key]["mentions"] += len(data["mentions"])
            all_key_figures[key]["files"].update(data["files"])
        
        # Locations
        for key, data in result.get("locations", {}).items():
            if key not in all_locations:
                all_locations[key] = {
                    "hebrew": data["hebrew"],
                    "english": data["english"],
                    "type": data["type"],
                    "mentions": 0,
                    "files": set()
                }
            all_locations[key]["mentions"] += len(data["mentions"])
            all_locations[key]["files"].update(data["files"])
        
        # Organizations
        for key, data in result.get("organizations", {}).items():
            if key not in all_orgs:
                all_orgs[key] = {
                    "hebrew": data["hebrew"],
                    "english": data["english"],
                    "type": data["type"],
                    "mentions": 0,
                    "files": set()
                }
            all_orgs[key]["mentions"] += len(data["mentions"])
            all_orgs[key]["files"].update(data["files"])
    
    # Ensure ALL 108 witnesses are in the list (even if not found in text)
    for hebrew_name, info in witness_index.get("witnesses", {}).items():
        if hebrew_name not in all_witnesses:
            all_witnesses[hebrew_name] = {
                "hebrew": info["hebrew"],
                "english": info["english"],
                "isWitness": True,
                "mentions": 0,
                "files": set(),
                "sessions": set(),
                "sources": [],
                "notFoundInText": True
            }
    
    # Build nodes
    nodes = []
    node_id = 1
    node_lookup = {}
    
    # Witness nodes
    for key, data in all_witnesses.items():
        node = {
            "id": f"witness_{node_id}",
            "type": "PERSON",
            "name": data["english"],
            "hebrewName": data["hebrew"],
            "isWitness": True,
            "role": "Witness",
            "sessions": sorted(list(data["sessions"])),
            "mentions": data["mentions"],
            "sources": data.get("sources", []),
            "files": sorted(list(data["files"])) if data["files"] else []
        }
        if data.get("notFoundInText"):
            node["notFoundInText"] = True
        nodes.append(node)
        node_lookup[key] = node["id"]
        node_id += 1
    
    # Key figure nodes
    for key, data in all_key_figures.items():
        node = {
            "id": f"figure_{node_id}",
            "type": "PERSON",
            "name": data["english"],
            "hebrewName": data["hebrew"],
            "isWitness": False,
            "role": data["role"],
            "category": data["category"],
            "mentions": data["mentions"],
            "files": sorted(list(data["files"])) if data["files"] else []
        }
        nodes.append(node)
        node_lookup[key] = node["id"]
        node_id += 1
    
    # Location nodes
    for key, data in all_locations.items():
        node = {
            "id": f"location_{node_id}",
            "type": data["type"],
            "name": data["english"],
            "hebrewName": data["hebrew"],
            "isWitness": False,
            "mentions": data["mentions"],
            "files": sorted(list(data["files"])) if data["files"] else []
        }
        nodes.append(node)
        node_lookup[key] = node["id"]
        node_id += 1
    
    # Organization nodes
    for key, data in all_orgs.items():
        node = {
            "id": f"org_{node_id}",
            "type": "ORGANIZATION",
            "name": data["english"],
            "hebrewName": data["hebrew"],
            "isWitness": False,
            "mentions": data["mentions"],
            "files": sorted(list(data["files"])) if data["files"] else []
        }
        nodes.append(node)
        node_lookup[key] = node["id"]
        node_id += 1
    
    # Build sessions
    sessions_list = []
    for num in sorted(all_sessions):
        witnesses_in_session = [
            node_lookup[k] for k, v in all_witnesses.items() 
            if num in v.get("sessions", set())
        ]
        sessions_list.append({
            "number": num,
            "witnesses": witnesses_in_session,
            "hebrewLabel": f"ישיבה מס' {num}"
        })
    
    # Build edges
    edges = []
    edge_id = 1
    
    # Witness-session edges
    for node in nodes:
        if node.get("isWitness") and node.get("sessions"):
            for session in node["sessions"]:
                edges.append({
                    "id": f"edge_{edge_id}",
                    "source": node["id"],
                    "target": f"session_{session}",
                    "type": "TESTIFIED_IN"
                })
                edge_id += 1
    
    # Count statistics
    witnesses_found = sum(1 for w in all_witnesses.values() if w["mentions"] > 0)
    witnesses_not_found = sum(1 for w in all_witnesses.values() if w["mentions"] == 0)
    
    return {
        "metadata": {
            "extractedAt": datetime.now().isoformat(),
            "totalFiles": len(all_results),
            "totalNodes": len(nodes),
            "totalEdges": len(edges),
            "totalSessions": len(sessions_list),
            "witnessesTotal": 108,
            "witnessesFound": witnesses_found,
            "witnessesNotFound": witnesses_not_found,
            "locationsFound": len(all_locations),
            "organizationsFound": len(all_orgs),
            "keyFiguresFound": len(all_key_figures),
            "source": "OCR_clean"
        },
        "nodes": nodes,
        "edges": edges,
        "sessions": sessions_list
    }


# =============================================================================
# Main
# =============================================================================

def main():
    print("=" * 60)
    print("FULL Entity Extraction - ALL Types")
    print("=" * 60)
    
    start_time = datetime.now()
    
    # Load witness index
    print("\n[1] Loading witness index...")
    witness_index = load_witness_index()
    print(f"    {witness_index.get('total', 0)} official witnesses loaded")
    print(f"    {len(witness_index.get('keyFigures', {}))} key figures")
    print(f"    {len(KNOWN_LOCATIONS)} known locations")
    print(f"    {len(KNOWN_ORGS)} known organizations")
    
    # Get OCR files
    print("\n[2] Finding OCR files...")
    if not OCR_DIR.exists():
        print(f"❌ OCR directory not found: {OCR_DIR}")
        return
    
    # Skip small files and audio transcripts
    skip_patterns = ["Vol5_band", "Vol6_band"]
    ocr_files = sorted([
        f for f in OCR_DIR.glob("*.txt") 
        if f.stat().st_size > 1000 and not any(p in f.name for p in skip_patterns)
    ])
    
    print(f"    Found {len(ocr_files)} files to process")
    
    # Process each file
    print("\n[3] Processing files...")
    all_results = []
    
    for i, file_path in enumerate(ocr_files):
        print(f"    [{i+1}/{len(ocr_files)}] {file_path.name}...", end=" ", flush=True)
        
        try:
            result = find_entities_in_file(file_path, witness_index)
            all_results.append(result)
            
            w_count = len(result.get("witnesses", {}))
            l_count = len(result.get("locations", {}))
            s_count = len(result.get("session_numbers", set()))
            print(f"✓ {w_count} witnesses, {l_count} locations, {s_count} sessions")
        except Exception as e:
            print(f"✗ Error: {e}")
    
    # Merge results
    print("\n[4] Merging results...")
    graph = merge_all_results(all_results, witness_index)
    
    # Print summary
    print("\n" + "=" * 60)
    print("EXTRACTION COMPLETE")
    print("=" * 60)
    meta = graph["metadata"]
    print(f"Total files processed: {meta['totalFiles']}")
    print(f"Total nodes: {meta['totalNodes']}")
    print(f"Total edges: {meta['totalEdges']}")
    print(f"Total sessions: {meta['totalSessions']}")
    print(f"\nWitnesses: {meta['witnessesFound']} found / {meta['witnessesTotal']} total")
    print(f"  (Not found in text: {meta['witnessesNotFound']})")
    print(f"Locations: {meta['locationsFound']}")
    print(f"Organizations: {meta['organizationsFound']}")
    print(f"Key figures: {meta['keyFiguresFound']}")
    
    # List witnesses found
    witnesses = [n for n in graph["nodes"] if n.get("isWitness")]
    found = [w for w in witnesses if w["mentions"] > 0]
    not_found = [w for w in witnesses if w["mentions"] == 0]
    
    print(f"\nWitnesses FOUND in text ({len(found)}):")
    for w in found[:20]:
        print(f"  ✓ {w['name']} ({w.get('hebrewName', '')}) - {w['mentions']} mentions")
    if len(found) > 20:
        print(f"  ... and {len(found) - 20} more")
    
    if not_found:
        print(f"\nWitnesses NOT found in text ({len(not_found)}):")
        for w in not_found:
            print(f"  ✗ {w['name']} ({w.get('hebrewName', '')})")
    
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

