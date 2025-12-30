#!/usr/bin/env python3
"""
Fixed Entity Extraction Pipeline

Fixes the session assignment bug by:
1. Building a proper session boundary map for each file
2. Assigning each mention to its correct session based on line position
3. Detecting actual testimony (העד pattern) vs mere mentions
4. Properly tracking all sessions where a witness appears

Usage:
    python extract_entities_fixed.py
"""

import json
import re
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Tuple, Optional
from collections import defaultdict

# =============================================================================
# Configuration
# =============================================================================

BASE_DIR = Path(__file__).parent.parent.parent
OCR_DIR = BASE_DIR / "downloads" / "pdf" / "OCR_clean"
OUTPUT_DIR = BASE_DIR / "app" / "public" / "data"
WITNESS_INDEX_FILE = BASE_DIR / "eichmann-entities" / "witness-index.json"

SKIP_FILES = {"Vol5_band", "Vol6_band"}

# =============================================================================
# Session Boundary Detection
# =============================================================================

def build_session_boundaries(lines: List[str]) -> List[Tuple[int, int, int]]:
    """
    Build a list of (session_number, start_line, end_line) tuples.
    
    This handles the fact that session headers appear multiple times
    (once per page) by grouping consecutive occurrences of the same session.
    """
    pattern = r'ישיבה\s+מס[\'׳\']?\s*(\d+)'
    
    # First pass: find all session markers
    markers = []
    for i, line in enumerate(lines):
        match = re.search(pattern, line)
        if match:
            session_num = int(match.group(1))
            markers.append((i, session_num))
    
    if not markers:
        return []
    
    # Second pass: build boundaries by detecting session changes
    boundaries = []
    current_session = markers[0][1]
    session_start = markers[0][0]
    
    for i, (line_num, session_num) in enumerate(markers[1:], 1):
        if session_num != current_session:
            # Session changed - close previous session
            boundaries.append((current_session, session_start, line_num - 1))
            current_session = session_num
            session_start = line_num
    
    # Close last session
    boundaries.append((current_session, session_start, len(lines) - 1))
    
    return boundaries


def get_session_for_line(line_num: int, boundaries: List[Tuple[int, int, int]]) -> int:
    """Get the session number for a given line number."""
    for session_num, start, end in boundaries:
        if start <= line_num <= end:
            return session_num
    return 0


# =============================================================================
# Witness Index Loading
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
        
        if hebrew:
            witness_lookup[hebrew] = entry
            # Index by last name (for Hebrew, last name is usually last word)
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
            
            for v in variants:
                key_lookup[v] = entry
    
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
    text = re.sub(r'[\u200e\u200f\u202a-\u202e]', '', text)
    text = text.replace('״', '"').replace("׳", "'")
    return text


def is_testimony_context(lines: List[str], line_num: int, name: str) -> bool:
    """
    Check if this mention is actual testimony (witness speaking).
    
    Looks for patterns like:
    - העד <name>
    - העד: שמי <name>
    - [העד מצהיר]
    """
    # Check surrounding context (5 lines before and after)
    start = max(0, line_num - 5)
    end = min(len(lines), line_num + 5)
    context = '\n'.join(lines[start:end])
    
    # Testimony patterns
    patterns = [
        r'העד\s+' + re.escape(name.split()[-1] if name.split() else name),  # העד <lastname>
        r'העד[:\s]+שמי',  # העד: שמי
        r'\[העד מצהיר\]',  # [העד מצהיר]
        r'העד[:\s]+' + re.escape(name.split()[0] if name.split() else name),  # העד <firstname>
    ]
    
    for pattern in patterns:
        if re.search(pattern, context):
            return True
    
    return False


# =============================================================================
# Entity Extraction
# =============================================================================

def find_witness_mentions(
    lines: List[str], 
    boundaries: List[Tuple[int, int, int]], 
    witness_index: Dict, 
    file_name: str
) -> Dict[str, Dict]:
    """Find all witness mentions with correct session assignment."""
    found_witnesses = {}
    
    for name, info in witness_index.get("lookup", {}).items():
        if len(name) < 3:
            continue
        
        mentions_by_session = defaultdict(list)
        testimony_sessions = set()
        
        for i, line in enumerate(lines):
            if name in line:
                session_num = get_session_for_line(i, boundaries)
                if session_num > 0:
                    mentions_by_session[session_num].append(i + 1)  # 1-based
                    
                    # Check if this is actual testimony
                    if is_testimony_context(lines, i, name):
                        testimony_sessions.add(session_num)
        
        if mentions_by_session:
            hebrew = info["hebrew"]
            english = info["english"]
            key = hebrew or english
            
            if key not in found_witnesses:
                found_witnesses[key] = {
                    "hebrew": hebrew,
                    "english": english,
                    "isWitness": True,
                    "sessions": set(),
                    "testimony_sessions": set(),
                    "mentions_by_session": {},
                    "sources": []
                }
            
            # Add all sessions where mentioned
            for session_num, line_nums in mentions_by_session.items():
                found_witnesses[key]["sessions"].add(session_num)
                
                if session_num in testimony_sessions:
                    found_witnesses[key]["testimony_sessions"].add(session_num)
                
                # Track mentions per session
                if session_num not in found_witnesses[key]["mentions_by_session"]:
                    found_witnesses[key]["mentions_by_session"][session_num] = []
                found_witnesses[key]["mentions_by_session"][session_num].extend(line_nums)
            
            # Add source info per session
            for session_num, line_nums in mentions_by_session.items():
                found_witnesses[key]["sources"].append({
                    "file": file_name,
                    "lineStart": min(line_nums),
                    "lineEnd": max(line_nums),
                    "session": session_num,
                    "isTestimony": session_num in testimony_sessions
                })
    
    return found_witnesses


def find_key_figures(
    lines: List[str], 
    boundaries: List[Tuple[int, int, int]], 
    witness_index: Dict, 
    file_name: str
) -> Dict[str, Dict]:
    """Find key figures with correct session assignment."""
    found = {}
    
    for name, info in witness_index.get("key_lookup", {}).items():
        if len(name) < 3:
            continue
        
        mentions_by_session = defaultdict(list)
        
        for i, line in enumerate(lines):
            if name in line:
                session_num = get_session_for_line(i, boundaries)
                if session_num > 0:
                    mentions_by_session[session_num].append(i + 1)
        
        if mentions_by_session:
            key = info["hebrew"] or info["english"]
            
            if key not in found:
                found[key] = {
                    "hebrew": info["hebrew"],
                    "english": info["english"],
                    "role": info["role"],
                    "category": info["category"],
                    "isWitness": False,
                    "sessions": set(),
                    "sources": []
                }
            
            for session_num, line_nums in mentions_by_session.items():
                found[key]["sessions"].add(session_num)
                found[key]["sources"].append({
                    "file": file_name,
                    "lineStart": min(line_nums),
                    "lineEnd": max(line_nums),
                    "session": session_num
                })
    
    return found


# =============================================================================
# Process Single File
# =============================================================================

def process_file(file_path: Path, witness_index: Dict) -> Dict:
    """Process a single OCR file with fixed session detection."""
    file_name = file_path.name
    
    text = file_path.read_text(encoding='utf-8')
    text = normalize_text(text)
    lines = text.split('\n')
    
    # Build session boundaries
    boundaries = build_session_boundaries(lines)
    
    # Find witnesses with correct sessions
    witnesses = find_witness_mentions(lines, boundaries, witness_index, file_name)
    
    # Find key figures
    key_figures = find_key_figures(lines, boundaries, witness_index, file_name)
    
    # Extract unique sessions from boundaries
    sessions = list(set(b[0] for b in boundaries))
    
    return {
        "file": file_name,
        "chars": len(text),
        "lines": len(lines),
        "sessions": sessions,
        "boundaries": boundaries,
        "witnesses": witnesses,
        "key_figures": key_figures
    }


# =============================================================================
# Merge Results
# =============================================================================

def merge_results(all_results: List[Dict], witness_index: Dict) -> Dict:
    """Merge results from all files into a single graph."""
    
    all_witnesses = {}
    all_key_figures = {}
    all_sessions = set()
    
    for result in all_results:
        # Merge witnesses
        for key, data in result.get("witnesses", {}).items():
            if key not in all_witnesses:
                all_witnesses[key] = {
                    "hebrew": data["hebrew"],
                    "english": data["english"],
                    "isWitness": True,
                    "sessions": set(),
                    "testimony_sessions": set(),
                    "sources": []
                }
            
            all_witnesses[key]["sessions"].update(data["sessions"])
            all_witnesses[key]["testimony_sessions"].update(data.get("testimony_sessions", set()))
            all_witnesses[key]["sources"].extend(data["sources"])
        
        # Merge key figures
        for key, data in result.get("key_figures", {}).items():
            if key not in all_key_figures:
                all_key_figures[key] = {
                    "hebrew": data["hebrew"],
                    "english": data["english"],
                    "role": data["role"],
                    "category": data["category"],
                    "isWitness": False,
                    "sessions": set(),
                    "sources": []
                }
            
            all_key_figures[key]["sessions"].update(data["sessions"])
            all_key_figures[key]["sources"].extend(data["sources"])
        
        # Collect sessions
        all_sessions.update(result.get("sessions", []))
    
    # Build graph nodes
    nodes = []
    node_id = 1
    node_lookup = {}
    
    # Add witnesses
    for key, data in all_witnesses.items():
        # Prefer testimony sessions over mere mentions
        testimony_sessions = data.get("testimony_sessions", set())
        all_sessions_for_witness = data["sessions"]
        
        # Use testimony sessions if available, otherwise all sessions
        final_sessions = testimony_sessions if testimony_sessions else all_sessions_for_witness
        
        node = {
            "id": f"witness_{node_id}",
            "type": "PERSON",
            "name": data["english"] or data["hebrew"],
            "hebrewName": data["hebrew"],
            "englishName": data["english"],
            "isWitness": True,
            "role": "Witness",
            "sessions": sorted(list(final_sessions)),
            "allMentionSessions": sorted(list(all_sessions_for_witness)),
            "mentions": sum(len([s for s in data["sources"] if s.get("session") == sess]) 
                          for sess in all_sessions_for_witness),
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
            "mentions": len(data["sources"]),
            "sources": dedupe_sources(data["sources"])
        }
        nodes.append(node)
        node_lookup[key] = node["id"]
        node_id += 1
    
    # Add session nodes
    for num in sorted(all_sessions):
        nodes.append({
            "id": f"session-{num}",
            "name": f"Session {num}",
            "hebrewName": f"ישיבה {num}",
            "type": "SESSION",
            "number": num,
            "sessions": [num],
            "mentions": 1
        })
    
    # Build edges
    edges = []
    edge_id = 1
    for node in nodes:
        if node.get("isWitness"):
            for session in node.get("sessions", []):
                edges.append({
                    "id": f"edge_{edge_id}",
                    "source": node["id"],
                    "target": f"session-{session}",
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
            "totalSessions": len(all_sessions),
            "validatedWitnesses": len(all_witnesses),
            "officialWitnessesFound": official_found,
            "officialWitnessTotal": len(witness_index.get("witnesses", [])),
            "source": "OCR_clean",
            "extractionVersion": "2.0-fixed"
        },
        "nodes": nodes,
        "edges": edges
    }


def dedupe_sources(sources: List[Dict]) -> List[Dict]:
    """Deduplicate sources, keeping per-session info."""
    seen = set()
    result = []
    
    for src in sources:
        key = (src["file"], src["session"])
        if key not in seen:
            seen.add(key)
            result.append(src)
    
    return sorted(result, key=lambda x: (x["file"], x["session"]))


# =============================================================================
# Main
# =============================================================================

def main():
    print("=" * 60)
    print("Fixed Entity Extraction Pipeline v2.0")
    print("=" * 60)
    
    start_time = datetime.now()
    
    # Load witness index
    print("\n[1] Loading witness index...")
    witness_index = load_witness_index()
    print(f"    {len(witness_index.get('witnesses', []))} official witnesses")
    print(f"    {sum(len(v) for v in witness_index.get('keyFigures', {}).values())} key figures")
    
    # Get OCR files
    print("\n[2] Finding OCR files...")
    if not OCR_DIR.exists():
        print(f"❌ OCR directory not found: {OCR_DIR}")
        return
    
    ocr_files = sorted([f for f in OCR_DIR.glob("*.txt") 
                       if not any(skip in f.name for skip in SKIP_FILES)])
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
            import traceback
            traceback.print_exc()
    
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
    
    # Verify Abba Kovner fix
    print("\n🔍 Verification - Checking Abba Kovner...")
    for node in graph["nodes"]:
        if "קובנר" in node.get("hebrewName", "") or "Kovner" in node.get("name", ""):
            print(f"   ✓ {node['name']} ({node.get('hebrewName', '')})")
            print(f"     Sessions: {node.get('sessions', [])}")
            print(f"     All mentions: {node.get('allMentionSessions', [])}")
    
    # Verify Israel Carmel fix
    print("\n🔍 Verification - Checking Israel Carmel...")
    for node in graph["nodes"]:
        if "כרמל" in node.get("hebrewName", "") or "Carmel" in node.get("name", ""):
            print(f"   ✓ {node['name']} ({node.get('hebrewName', '')})")
            print(f"     Sessions: {node.get('sessions', [])}")
    
    # Save output
    print("\n[5] Saving output...")
    output_path = OUTPUT_DIR / "entities-consolidated.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(graph, f, indent=2, ensure_ascii=False)
    
    elapsed = (datetime.now() - start_time).total_seconds()
    print(f"\n✅ Complete in {elapsed:.1f}s")
    print(f"   Output: {output_path}")


if __name__ == "__main__":
    main()
