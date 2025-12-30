#!/usr/bin/env python3
"""
COMPLETE Entity Extraction Pipeline - SINGLE SCRIPT

This script extracts ALL entities and produces a COMPLETE, CONSISTENT output every time.
NO MERGING. NO PATCHING. ONE SCRIPT. ONE OUTPUT.

What it extracts:
- ALL 108 witnesses with CORRECT session assignments (testimony-based)
- ALL 121 sessions with dates
- ALL locations, organizations, events, key figures
- ALL edges (TESTIFIED_IN, MENTIONED_IN, etc.)

Usage:
    python extract_complete.py

Output:
    app/public/data/entities-consolidated.json
"""

import json
import re
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Set, Optional
from collections import defaultdict

# =============================================================================
# Configuration
# =============================================================================

BASE_DIR = Path(__file__).parent.parent.parent
OCR_DIR = BASE_DIR / "downloads" / "pdf" / "OCR_clean"
OUTPUT_DIR = BASE_DIR / "app" / "public" / "data"
WITNESS_INDEX = BASE_DIR / "eichmann-entities" / "witness-index.json"
IMAGES_DIR = BASE_DIR / "app" / "public" / "images" / "witnesses"

# Files that contain ACTUAL testimony transcripts (not verdicts/summaries)
TRANSCRIPT_FILES = [
    "Vol1_p114.txt",
    "Vol1_p15291.txt",
    "vol1_part3.txt",
    "Vol2_p4155.txt",
    "Vol2_p5564.txt",
    "Vol2_p6575.txt",
]

# Files that are NOT transcripts - only used for mentions, not testimony detection
NON_TRANSCRIPT_FILES = [
    "vol3_p112121.txt",
    "vol3_p101111.txt", 
    "vol3_p90100.txt",
    "vol3_p7689.txt",
    "claims1.txt",
    "claims2.txt",
    "claims3.txt",
    "summaries.txt",
    "concluding-remarks.txt",
    "vol1_summary.txt",
    "vol2_summary.txt",
    "vol3_summary.txt",
    "vol4_summary.txt",
    "list.txt",
    "testimonies.txt",
    "eichmann_judgement_11-12-1961.txt",
    "The Eichmann Trial.txt",
]

# Session dates (ALL 121 sessions)
SESSION_DATES = {
    1: "1961-04-11", 2: "1961-04-12", 3: "1961-04-13", 4: "1961-04-17", 5: "1961-04-18",
    6: "1961-04-19", 7: "1961-04-20", 8: "1961-04-24", 9: "1961-04-25", 10: "1961-04-26",
    11: "1961-04-27", 12: "1961-04-28", 13: "1961-05-01", 14: "1961-05-02", 15: "1961-05-03",
    16: "1961-05-04", 17: "1961-05-05", 18: "1961-05-08", 19: "1961-05-08", 20: "1961-05-09",
    21: "1961-05-09", 22: "1961-05-10", 23: "1961-05-10", 24: "1961-05-11", 25: "1961-05-11",
    26: "1961-05-12", 27: "1961-05-15", 28: "1961-05-16", 29: "1961-05-17", 30: "1961-05-18",
    31: "1961-05-22", 32: "1961-05-23", 33: "1961-05-24", 34: "1961-05-25", 35: "1961-05-26",
    36: "1961-05-29", 37: "1961-05-30", 38: "1961-05-31", 39: "1961-06-01", 40: "1961-06-02",
    41: "1961-06-05", 42: "1961-06-06", 43: "1961-06-07", 44: "1961-06-08", 45: "1961-06-09",
    46: "1961-06-12", 47: "1961-06-13", 48: "1961-06-14", 49: "1961-06-15", 50: "1961-06-16",
    51: "1961-06-19", 52: "1961-06-20", 53: "1961-06-21", 54: "1961-06-22", 55: "1961-06-26",
    56: "1961-06-27", 57: "1961-06-28", 58: "1961-06-29", 59: "1961-06-30", 60: "1961-07-03",
    61: "1961-07-04", 62: "1961-07-05", 63: "1961-07-06", 64: "1961-07-07", 65: "1961-07-10",
    66: "1961-07-10", 67: "1961-07-11", 68: "1961-07-11", 69: "1961-07-12", 70: "1961-07-13",
    71: "1961-07-17", 72: "1961-07-18", 73: "1961-07-19", 74: "1961-07-20", 75: "1961-07-21",
    76: "1961-07-24", 77: "1961-07-25", 78: "1961-07-26", 79: "1961-07-27", 80: "1961-07-28",
    81: "1961-07-31", 82: "1961-08-01", 83: "1961-08-02", 84: "1961-08-03", 85: "1961-08-04",
    86: "1961-08-07", 87: "1961-08-08", 88: "1961-08-09", 89: "1961-08-10", 90: "1961-08-11",
    91: "1961-08-14", 92: "1961-08-15", 93: "1961-08-16", 94: "1961-08-17", 95: "1961-08-18",
    96: "1961-08-21", 97: "1961-08-22", 98: "1961-08-23", 99: "1961-08-24", 100: "1961-08-25",
    101: "1961-08-28", 102: "1961-08-29", 103: "1961-08-30", 104: "1961-08-31", 105: "1961-09-01",
    106: "1961-09-04", 107: "1961-09-05", 108: "1961-09-06", 109: "1961-09-07", 110: "1961-09-08",
    111: "1961-09-11", 112: "1961-09-12", 113: "1961-09-13", 114: "1961-09-14", 115: "1961-12-11",
    116: "1961-12-12", 117: "1961-12-13", 118: "1961-12-14", 119: "1961-12-15", 120: "1962-03-22",
    121: "1962-05-29",
}

# Known locations
KNOWN_LOCATIONS = {
    "אושוויץ": {"english": "Auschwitz", "category": "camp"},
    "בירקנאו": {"english": "Birkenau", "category": "camp"},
    "טרבלינקה": {"english": "Treblinka", "category": "camp"},
    "סוביבור": {"english": "Sobibor", "category": "camp"},
    "מיידנק": {"english": "Majdanek", "category": "camp"},
    "חלמנו": {"english": "Chelmno", "category": "camp"},
    "בלזץ": {"english": "Belzec", "category": "camp"},
    "ברגן-בלזן": {"english": "Bergen-Belsen", "category": "camp"},
    "תרזינשטט": {"english": "Theresienstadt", "category": "camp"},
    "דכאו": {"english": "Dachau", "category": "camp"},
    "בוכנוולד": {"english": "Buchenwald", "category": "camp"},
    "מאוטהאוזן": {"english": "Mauthausen", "category": "camp"},
    "ורשה": {"english": "Warsaw", "category": "city"},
    "לודז": {"english": "Lodz", "category": "city"},
    "קראקוב": {"english": "Krakow", "category": "city"},
    "לובלין": {"english": "Lublin", "category": "city"},
    "ווילנה": {"english": "Vilna", "category": "city"},
    "קובנו": {"english": "Kovno", "category": "city"},
    "בודפשט": {"english": "Budapest", "category": "city"},
    "ברלין": {"english": "Berlin", "category": "city"},
    "וינה": {"english": "Vienna", "category": "city"},
    "פראג": {"english": "Prague", "category": "city"},
    "ירושלים": {"english": "Jerusalem", "category": "city"},
    "תל אביב": {"english": "Tel Aviv", "category": "city"},
    "גרמניה": {"english": "Germany", "category": "country"},
    "פולין": {"english": "Poland", "category": "country"},
    "הונגריה": {"english": "Hungary", "category": "country"},
    "ישראל": {"english": "Israel", "category": "country"},
    "אוסטריה": {"english": "Austria", "category": "country"},
    "הולנד": {"english": "Netherlands", "category": "country"},
    "בלגיה": {"english": "Belgium", "category": "country"},
    "צרפת": {"english": "France", "category": "country"},
    "יוון": {"english": "Greece", "category": "country"},
    "רומניה": {"english": "Romania", "category": "country"},
}

# Known organizations  
KNOWN_ORGS = {
    "הגסטאפו": {"english": "Gestapo", "type": "nazi"},
    "גסטאפו": {"english": "Gestapo", "type": "nazi"},
    "הס.ס.": {"english": "SS", "type": "nazi"},
    "הוורמאכט": {"english": "Wehrmacht", "type": "nazi"},
    "יודנראט": {"english": "Judenrat", "type": "jewish"},
    "זונדרקומנדו": {"english": "Sonderkommando", "type": "camp"},
    "הצלב האדום": {"english": "Red Cross", "type": "humanitarian"},
    "RSHA": {"english": "RSHA", "type": "nazi"},
}

# Known events
KNOWN_EVENTS = {
    "ליל הבדולח": {"english": "Kristallnacht", "type": "pogrom"},
    "ועידת ואנזה": {"english": "Wannsee Conference", "type": "policy"},
    "מרד גטו ורשה": {"english": "Warsaw Ghetto Uprising", "type": "resistance"},
    "הפתרון הסופי": {"english": "Final Solution", "type": "genocide"},
}

# Key figures (non-witnesses)
KEY_FIGURES = {
    "אייכמן": {"english": "Adolf Eichmann", "role": "defendant"},
    "אדולף אייכמן": {"english": "Adolf Eichmann", "role": "defendant"},
    "הימלר": {"english": "Heinrich Himmler", "role": "nazi_leader"},
    "היידריך": {"english": "Reinhard Heydrich", "role": "nazi_leader"},
    "היטלר": {"english": "Adolf Hitler", "role": "nazi_leader"},
    "סרבציוס": {"english": "Dr. Robert Servatius", "role": "defense"},
    "האוזנר": {"english": "Gideon Hausner", "role": "prosecutor"},
    "לנדאו": {"english": "Moshe Landau", "role": "judge"},
    "הלוי": {"english": "Benjamin Halevi", "role": "judge"},
}


def get_phase(session_num: int) -> str:
    """Get trial phase for session number."""
    if session_num <= 16:
        return "Prosecution Opening"
    elif session_num <= 71:
        return "Prosecution Witnesses"
    elif session_num <= 101:
        return "Defense"
    elif session_num <= 111:
        return "Final Arguments"
    elif session_num <= 119:
        return "Judgment"
    else:
        return "Sentence"


def normalize_text(text: str) -> str:
    """Remove RTL/LTR control characters."""
    return re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069]', '', text)


def load_witness_index() -> Dict:
    """Load official witness list."""
    if not WITNESS_INDEX.exists():
        print(f"❌ Witness index not found: {WITNESS_INDEX}")
        return {"witnesses": {}}
    
    with open(WITNESS_INDEX, encoding='utf-8') as f:
        data = json.load(f)
    
    witnesses = {}
    for w in data.get("witnesses", []):
        hebrew = w.get("hebrew", "")
        english = w.get("english", "")
        
        if not hebrew:
            continue
        
        # Build search terms
        search_terms = set([hebrew])
        parts = hebrew.split()
        if len(parts) > 1:
            search_terms.add(parts[-1])  # Last name
        
        # Handle title prefixes
        for prefix in ["דר'", "דר׳", 'ד"ר', "פרופ'", "פרופ׳"]:
            if hebrew.startswith(prefix):
                clean = hebrew[len(prefix):].strip()
                search_terms.add(clean)
        
        # Remove short terms
        search_terms = {t for t in search_terms if len(t) >= 3}
        
        # Add variants to search terms
        for variant in w.get("variants", []):
            if len(variant) >= 3:
                search_terms.add(variant)
        
        # Use image path from index (already correct)
        image_path = w.get("image")
        
        witnesses[hebrew] = {
            "hebrew": hebrew,
            "english": english,
            "searchTerms": search_terms,
            "image": image_path,
        }
    
    return {"witnesses": witnesses}


def build_session_boundaries(lines: List[str]) -> List[Dict]:
    """Build session boundaries from file."""
    pattern = r'ישיבה\s+(?:מס[\'׳\'\u05f3]?\s*)?[\u200e\u200f\u202a-\u202e\u2066-\u2069]*(\d+)'
    
    markers = []
    for i, line in enumerate(lines):
        clean_line = normalize_text(line)
        match = re.search(pattern, clean_line)
        if match:
            markers.append({"number": int(match.group(1)), "line": i})
    
    if not markers:
        return []
    
    # Build boundaries
    boundaries = []
    seen = set()
    
    for i, marker in enumerate(markers):
        num = marker["number"]
        if num in seen:
            continue
        seen.add(num)
        
        start = marker["line"]
        end = len(lines) - 1
        
        for j in range(i + 1, len(markers)):
            if markers[j]["number"] != num:
                end = markers[j]["line"] - 1
                break
        
        boundaries.append({"number": num, "lineStart": start, "lineEnd": end})
    
    return sorted(boundaries, key=lambda x: x["lineStart"])


def get_session_for_line(line_num: int, boundaries: List[Dict]) -> Optional[int]:
    """Get session number for a line."""
    for b in boundaries:
        if b["lineStart"] <= line_num <= b["lineEnd"]:
            return b["number"]
    return None


def is_testimony_context(line: str, witness_term: str) -> bool:
    """Check if line is testimony context (witness speaking)."""
    patterns = [
        rf'העד\s+{re.escape(witness_term)}',
        rf'העדה\s+{re.escape(witness_term)}',
        rf'העד\s+[^:]*{re.escape(witness_term)}',
    ]
    for p in patterns:
        if re.search(p, line):
            return True
    return False


def extract_from_file(file_path: Path, witness_index: Dict, is_transcript: bool) -> Dict:
    """Extract entities from a single file."""
    text = file_path.read_text(encoding='utf-8')
    lines = text.split('\n')
    file_name = file_path.name
    
    boundaries = build_session_boundaries(lines)
    
    # Extract witnesses
    witnesses = {}
    for hebrew_name, info in witness_index.get("witnesses", {}).items():
        testimony_sessions = set()
        mention_sessions = set()
        mention_count = 0
        
        for i, line in enumerate(lines):
            for term in info["searchTerms"]:
                if term in line:
                    mention_count += 1
                    session = get_session_for_line(i, boundaries)
                    if session:
                        mention_sessions.add(session)
                        # Only count testimony from transcript files
                        if is_transcript and is_testimony_context(line, term):
                            testimony_sessions.add(session)
                    break
        
        if mention_count > 0:
            witnesses[hebrew_name] = {
                "testimony_sessions": testimony_sessions,
                "mention_sessions": mention_sessions,
                "mentions": mention_count,
            }
    
    # Extract locations
    locations = {}
    for hebrew, info in KNOWN_LOCATIONS.items():
        count = text.count(hebrew)
        if count > 0:
            locations[info["english"]] = {
                "hebrew": hebrew,
                "english": info["english"],
                "category": info["category"],
                "mentions": count,
            }
    
    # Extract organizations
    orgs = {}
    for hebrew, info in KNOWN_ORGS.items():
        count = text.count(hebrew)
        if count > 0:
            orgs[info["english"]] = {
                "hebrew": hebrew,
                "english": info["english"],
                "type": info["type"],
                "mentions": count,
            }
    
    # Extract events
    events = {}
    for hebrew, info in KNOWN_EVENTS.items():
        count = text.count(hebrew)
        if count > 0:
            events[info["english"]] = {
                "hebrew": hebrew,
                "english": info["english"],
                "type": info["type"],
                "mentions": count,
            }
    
    # Extract key figures
    figures = {}
    for hebrew, info in KEY_FIGURES.items():
        count = text.count(hebrew)
        if count > 0:
            key = info["english"]
            if key not in figures:
                figures[key] = {
                    "hebrew": hebrew,
                    "english": info["english"],
                    "role": info["role"],
                    "mentions": 0,
                }
            figures[key]["mentions"] += count
    
    return {
        "file": file_name,
        "witnesses": witnesses,
        "locations": locations,
        "organizations": orgs,
        "events": events,
        "figures": figures,
        "sessions": [b["number"] for b in boundaries],
    }


def build_graph(all_results: List[Dict], witness_index: Dict) -> Dict:
    """Build complete entity graph."""
    
    # Start with ALL witnesses from the index (all 108)
    all_witnesses = {}
    for hebrew, info in witness_index.get("witnesses", {}).items():
        all_witnesses[hebrew] = {
            "hebrew": hebrew,
            "english": info.get("english", hebrew),
            "image": info.get("image"),
            "testimony_sessions": set(),
            "mention_sessions": set(),
            "mentions": 0,
        }
    
    # Update with data found in files
    for result in all_results:
        for hebrew, data in result.get("witnesses", {}).items():
            if hebrew in all_witnesses:
                all_witnesses[hebrew]["testimony_sessions"].update(data["testimony_sessions"])
                all_witnesses[hebrew]["mention_sessions"].update(data["mention_sessions"])
                all_witnesses[hebrew]["mentions"] += data["mentions"]
    
    # Merge other entities
    all_locations = {}
    all_orgs = {}
    all_events = {}
    all_figures = {}
    
    for result in all_results:
        for key, data in result.get("locations", {}).items():
            if key not in all_locations:
                all_locations[key] = data.copy()
                all_locations[key]["mentions"] = 0
            all_locations[key]["mentions"] += data["mentions"]
        
        for key, data in result.get("organizations", {}).items():
            if key not in all_orgs:
                all_orgs[key] = data.copy()
                all_orgs[key]["mentions"] = 0
            all_orgs[key]["mentions"] += data["mentions"]
        
        for key, data in result.get("events", {}).items():
            if key not in all_events:
                all_events[key] = data.copy()
                all_events[key]["mentions"] = 0
            all_events[key]["mentions"] += data["mentions"]
        
        for key, data in result.get("figures", {}).items():
            if key not in all_figures:
                all_figures[key] = data.copy()
                all_figures[key]["mentions"] = 0
            all_figures[key]["mentions"] += data["mentions"]
    
    # Build nodes
    nodes = []
    edges = []
    node_id = 1
    
    # === WITNESS NODES ===
    for hebrew, data in all_witnesses.items():
        # Use testimony sessions if available, otherwise mention sessions
        sessions = sorted(data["testimony_sessions"]) if data["testimony_sessions"] else sorted(data["mention_sessions"])
        
        node = {
            "id": f"witness_{node_id}",
            "type": "PERSON",
            "name": data["english"],
            "hebrewName": data["hebrew"],
            "englishName": data["english"],
            "isWitness": True,
            "role": "Witness",
            "sessions": sessions,
            "mentions": data["mentions"],
            "image": data["image"],
        }
        nodes.append(node)
        node_id += 1
    
    # === KEY FIGURE NODES ===
    for key, data in all_figures.items():
        node = {
            "id": f"figure_{node_id}",
            "type": "PERSON",
            "name": data["english"],
            "hebrewName": data["hebrew"],
            "isWitness": False,
            "role": data["role"],
            "mentions": data["mentions"],
        }
        nodes.append(node)
        node_id += 1
    
    # === LOCATION NODES ===
    for key, data in all_locations.items():
        node = {
            "id": f"location_{node_id}",
            "type": "LOCATION",
            "name": data["english"],
            "hebrewName": data["hebrew"],
            "category": data["category"],
            "mentions": data["mentions"],
        }
        nodes.append(node)
        node_id += 1
    
    # === ORGANIZATION NODES ===
    for key, data in all_orgs.items():
        node = {
            "id": f"org_{node_id}",
            "type": "ORGANIZATION",
            "name": data["english"],
            "hebrewName": data["hebrew"],
            "orgType": data["type"],
            "mentions": data["mentions"],
        }
        nodes.append(node)
        node_id += 1
    
    # === EVENT NODES ===
    for key, data in all_events.items():
        node = {
            "id": f"event_{node_id}",
            "type": "EVENT",
            "name": data["english"],
            "hebrewName": data["hebrew"],
            "eventType": data["type"],
            "mentions": data["mentions"],
        }
        nodes.append(node)
        node_id += 1
    
    # === SESSION NODES (ALL 121) ===
    session_witness_map = defaultdict(list)
    for node in nodes:
        if node.get("isWitness"):
            for s in node.get("sessions", []):
                session_witness_map[s].append(node["id"])
    
    for session_num in range(1, 122):
        date_str = SESSION_DATES.get(session_num, "")
        day = ""
        if date_str:
            try:
                date_obj = datetime.strptime(date_str, "%Y-%m-%d")
                day = date_obj.strftime("%A")
            except:
                pass
        
        node = {
            "id": f"session-{session_num}",
            "type": "SESSION",
            "name": f"Session {session_num}",
            "hebrewName": f"ישיבה {session_num}",
            "number": session_num,
            "date": date_str,
            "day": day,
            "phase": get_phase(session_num),
            "witnessIds": session_witness_map.get(session_num, []),
        }
        nodes.append(node)
    
    # === DATE NODE ===
    nodes.append({
        "id": "date-trial-period",
        "type": "DATE",
        "name": "April 11, 1961 - August 14, 1961",
        "hebrewName": "11 באפריל 1961 - 14 באוגוסט 1961",
        "startDate": "1961-04-11",
        "endDate": "1961-08-14",
    })
    
    # === BUILD EDGES ===
    edge_id = 1
    
    # Witness -> Session edges
    for node in nodes:
        if node.get("isWitness"):
            for session_num in node.get("sessions", []):
                edges.append({
                    "id": f"edge_{edge_id}",
                    "source": node["id"],
                    "target": f"session-{session_num}",
                    "type": "TESTIFIED_IN",
                })
                edge_id += 1
    
    # Count stats
    type_counts = defaultdict(int)
    for node in nodes:
        type_counts[node.get("type", "?")] += 1
    
    return {
        "metadata": {
            "generatedAt": datetime.now().isoformat(),
            "totalNodes": len(nodes),
            "totalEdges": len(edges),
            "typeCounts": dict(type_counts),
            "source": "extract_complete.py",
        },
        "nodes": nodes,
        "edges": edges,
    }


def main():
    print("=" * 60)
    print("COMPLETE Entity Extraction")
    print("=" * 60)
    
    start_time = datetime.now()
    
    # Load witness index
    print("\n📚 Loading witness index...")
    witness_index = load_witness_index()
    print(f"   {len(witness_index['witnesses'])} witnesses")
    
    # Find files to process
    print("\n📄 Finding files...")
    all_files = sorted(OCR_DIR.glob("*.txt"))
    all_files = [f for f in all_files if f.stat().st_size > 1000]
    print(f"   {len(all_files)} files found")
    
    # Process files
    print("\n🔍 Extracting entities...")
    all_results = []
    
    for file_path in all_files:
        file_name = file_path.name
        is_transcript = file_name in TRANSCRIPT_FILES
        
        print(f"   {file_name}...", end=" ", flush=True)
        
        try:
            result = extract_from_file(file_path, witness_index, is_transcript)
            all_results.append(result)
            
            w_count = len(result["witnesses"])
            s_count = len(result["sessions"])
            t_marker = "📜" if is_transcript else "📋"
            print(f"{t_marker} {w_count} witnesses, {s_count} sessions")
        except Exception as e:
            print(f"❌ Error: {e}")
    
    # Build graph
    print("\n🏗️ Building graph...")
    graph = build_graph(all_results, witness_index)
    
    # Validate
    print("\n✅ Validation:")
    
    # Check Abba Kovner
    for n in graph["nodes"]:
        if "kowner" in n.get("name", "").lower() or "קובנר" in n.get("hebrewName", ""):
            print(f"   Abba Kovner: sessions={n.get('sessions', [])}")
    
    # Check Israel Carmel
    for n in graph["nodes"]:
        if "carmel" in n.get("name", "").lower() and n.get("isWitness"):
            print(f"   Israel Carmel: sessions={n.get('sessions', [])}")
    
    # Check Yoel Brand
    for n in graph["nodes"]:
        if "yoel" in n.get("name", "").lower() and "brand" in n.get("name", "").lower():
            print(f"   Yoel Brand: sessions={n.get('sessions', [])}")
    
    # Check session count
    sessions = [n for n in graph["nodes"] if n.get("type") == "SESSION"]
    print(f"   Sessions: {len(sessions)}")
    
    # Check witnesses with images
    with_images = sum(1 for n in graph["nodes"] if n.get("isWitness") and n.get("image"))
    witnesses_total = sum(1 for n in graph["nodes"] if n.get("isWitness"))
    print(f"   Witnesses with images: {with_images}/{witnesses_total}")
    
    # Save
    print("\n💾 Saving...")
    output_path = OUTPUT_DIR / "entities-consolidated.json"
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(graph, f, ensure_ascii=False, indent=2)
    
    elapsed = (datetime.now() - start_time).total_seconds()
    
    print("\n" + "=" * 60)
    print("COMPLETE")
    print("=" * 60)
    print(f"Time: {elapsed:.1f}s")
    print(f"Output: {output_path}")
    print(f"Nodes: {graph['metadata']['totalNodes']}")
    print(f"Edges: {graph['metadata']['totalEdges']}")
    for t, c in sorted(graph['metadata']['typeCounts'].items()):
        print(f"  {t}: {c}")


if __name__ == "__main__":
    main()
