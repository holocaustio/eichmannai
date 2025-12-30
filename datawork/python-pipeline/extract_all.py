#!/usr/bin/env python3
"""
Full Entity Extraction Pipeline - All Files

Runs DictaBERT NER on all OCR files, consolidates with OpenAI,
and outputs a complete entity graph with sessions.

Usage:
    python extract_all.py
    python extract_all.py --skip-extraction  # Use cached extraction, just consolidate
"""

import os
import sys
import json
import asyncio
import argparse
import re
import time
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional, Set, Tuple
from collections import defaultdict, Counter

from dotenv import load_dotenv
from tqdm import tqdm

load_dotenv()

# =============================================================================
# Configuration
# =============================================================================

BASE_DIR = Path(__file__).parent.parent.parent
OCR_DIR = BASE_DIR / "downloads" / "pdf" / "OCR"
OUTPUT_DIR = BASE_DIR / "app" / "public" / "data"
CACHE_DIR = Path(__file__).parent / ".extraction_cache"
TRIAL_INDEX = BASE_DIR / "datawork" / "trial-index.json"
WITNESS_INDEX = BASE_DIR / "eichmann-entities" / "witness-index.json"
APP_ENTITIES = BASE_DIR / "app" / "public" / "data" / "entities.json"

CACHE_DIR.mkdir(exist_ok=True)

# =============================================================================
# Load Trial Index for Sessions
# =============================================================================

def load_trial_index() -> Dict:
    """Load trial index with session and witness data."""
    if not TRIAL_INDEX.exists():
        print(f"❌ Trial index not found: {TRIAL_INDEX}")
        return {}
    
    with open(TRIAL_INDEX, encoding='utf-8') as f:
        return json.load(f)

# =============================================================================
# Load Witness Data from App
# =============================================================================

def load_app_witnesses() -> List[Dict]:
    """Load existing witness data from app entities."""
    if not APP_ENTITIES.exists():
        print(f"❌ App entities not found: {APP_ENTITIES}")
        return []
    
    with open(APP_ENTITIES, encoding='utf-8') as f:
        data = json.load(f)
    
    return [n for n in data.get("nodes", []) if n.get("isWitness")]

# =============================================================================
# DictaBERT Extraction
# =============================================================================

def extract_file_dictabert(file_path: Path, ner_pipeline) -> Dict:
    """Extract entities from a single file using DictaBERT."""
    file_name = file_path.name
    cache_file = CACHE_DIR / f"{file_name}.json"
    
    # Check cache
    if cache_file.exists():
        with open(cache_file, encoding='utf-8') as f:
            return json.load(f)
    
    text = file_path.read_text(encoding='utf-8')
    lines = text.split('\n')
    
    # Detect sessions
    sessions = detect_sessions(text)
    
    entities = defaultdict(list)
    
    # Process in chunks
    chunk_size = 100  # lines per chunk
    for i in range(0, len(lines), chunk_size):
        chunk_lines = lines[i:i+chunk_size]
        chunk_text = ' '.join(chunk_lines)
        
        if not chunk_text.strip():
            continue
        
        # Get session for this chunk
        session_num = get_session_for_line(i, sessions)
        
        try:
            # Limit text length for model
            results = ner_pipeline(chunk_text[:3000])
            
            for r in results:
                entity_type = r.get("entity_group", "UNKNOWN")
                word = r.get("word", "").strip()
                score = r.get("score", 0)
                
                if len(word) < 2 or score < 0.5:
                    continue
                
                # Map DictaBERT types to our types
                type_map = {
                    "PER": "PERSON",
                    "PERS": "PERSON",
                    "LOC": "LOCATION",
                    "ORG": "ORGANIZATION",
                    "GPE": "LOCATION",
                    "DATE": "DATE",
                    "TIME": "DATE",
                    "EVE": "EVENT",
                    "FAC": "LOCATION",
                }
                
                mapped_type = type_map.get(entity_type, entity_type)
                
                entities[mapped_type].append({
                    "name": word,
                    "hebrewName": word,
                    "type": mapped_type,
                    "score": score,
                    "session": session_num,
                    "file": file_name
                })
        except Exception as e:
            print(f"  ⚠️ Error processing chunk {i}: {e}")
    
    result = {
        "file": file_name,
        "sessions": sessions,
        "entities": dict(entities)
    }
    
    # Cache result
    with open(cache_file, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    
    return result


def detect_sessions(text: str) -> List[Dict]:
    """Detect session boundaries in text."""
    sessions = []
    pattern = r'ישיבה\s+(?:מס[\'׳]?\s*)?(\d+)'
    
    lines = text.split('\n')
    current_session = None
    session_start = 0
    
    for i, line in enumerate(lines):
        match = re.search(pattern, line)
        if match:
            num = int(match.group(1))
            if current_session is not None and current_session != num:
                sessions.append({
                    "number": current_session,
                    "lineStart": session_start,
                    "lineEnd": i - 1
                })
            if current_session != num:
                current_session = num
                session_start = i
    
    if current_session is not None:
        sessions.append({
            "number": current_session,
            "lineStart": session_start,
            "lineEnd": len(lines) - 1
        })
    
    # Dedupe
    by_num = {}
    for s in sessions:
        n = s["number"]
        if n not in by_num or (s["lineEnd"] - s["lineStart"]) > (by_num[n]["lineEnd"] - by_num[n]["lineStart"]):
            by_num[n] = s
    
    return sorted(by_num.values(), key=lambda x: x["number"])


def get_session_for_line(line_num: int, sessions: List[Dict]) -> Optional[int]:
    """Get session number for a given line."""
    for s in sessions:
        if s["lineStart"] <= line_num <= s["lineEnd"]:
            return s["number"]
    return None

# =============================================================================
# Consolidation with OpenAI
# =============================================================================

async def consolidate_with_openai(all_entities: Dict[str, List[Dict]]) -> Dict[str, List[Dict]]:
    """Use OpenAI to consolidate and deduplicate entities."""
    from openai import AsyncOpenAI
    
    client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
    consolidated = {}
    
    for entity_type, entities in all_entities.items():
        if not entities:
            consolidated[entity_type] = []
            continue
        
        # First pass: local deduplication
        by_name = defaultdict(list)
        for e in entities:
            key = e.get("name", "").lower().strip()
            if key:
                by_name[key].append(e)
        
        # Merge duplicates locally
        merged = []
        for name, dupes in by_name.items():
            if not dupes:
                continue
            
            base = dupes[0].copy()
            sessions = set()
            files = set()
            total_score = 0
            
            for d in dupes:
                if d.get("session"):
                    sessions.add(d["session"])
                if d.get("file"):
                    files.add(d["file"])
                total_score += d.get("score", 0.5)
            
            base["sessions"] = sorted(list(sessions))
            base["files"] = list(files)
            base["mentions"] = len(dupes)
            base["avgScore"] = total_score / len(dupes) if dupes else 0
            
            merged.append(base)
        
        # Only use OpenAI for large entity lists
        if len(merged) > 20 and entity_type in ["PERSON", "LOCATION", "ORGANIZATION"]:
            print(f"  🤖 Consolidating {len(merged)} {entity_type} entities with OpenAI...")
            
            names = [m.get("name", "") for m in merged[:100]]  # Limit for token size
            
            try:
                response = await client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {
                            "role": "system",
                            "content": f"""You are consolidating {entity_type} entities from Holocaust trial transcripts.
Group entities that refer to the same real-world entity (e.g., "אייכמן" and "אדולף אייכמן" are the same person).

Return JSON: {{"groups": [[indices of same entity], ...]}}

Be conservative - only group if CLEARLY the same entity."""
                        },
                        {
                            "role": "user",
                            "content": "Entities to consolidate:\n" + "\n".join(f"{i}. {n}" for i, n in enumerate(names))
                        }
                    ],
                    response_format={"type": "json_object"}
                )
                
                result = json.loads(response.choices[0].message.content)
                groups = result.get("groups", [])
                
                # Apply grouping
                used = set()
                final_merged = []
                
                for group in groups:
                    if not group:
                        continue
                    group = [i for i in group if i < len(merged) and i not in used]
                    if not group:
                        continue
                    
                    base = merged[group[0]].copy()
                    all_sessions = set(base.get("sessions", []))
                    all_files = set(base.get("files", []))
                    total_mentions = base.get("mentions", 1)
                    variants = set([base.get("name", "")])
                    
                    for idx in group[1:]:
                        other = merged[idx]
                        all_sessions.update(other.get("sessions", []))
                        all_files.update(other.get("files", []))
                        total_mentions += other.get("mentions", 1)
                        variants.add(other.get("name", ""))
                    
                    base["sessions"] = sorted(list(all_sessions))
                    base["files"] = list(all_files)
                    base["mentions"] = total_mentions
                    base["variants"] = list(variants)
                    
                    final_merged.append(base)
                    used.update(group)
                
                # Add ungrouped
                for i, m in enumerate(merged):
                    if i not in used:
                        final_merged.append(m)
                
                merged = final_merged
                print(f"     Reduced to {len(merged)} entities")
                
            except Exception as e:
                print(f"  ⚠️ OpenAI consolidation error: {e}")
        
        consolidated[entity_type] = merged
    
    return consolidated

# =============================================================================
# Build Final Graph
# =============================================================================

def build_graph(
    consolidated: Dict[str, List[Dict]],
    witnesses: List[Dict],
    trial_index: Dict
) -> Dict:
    """Build the final entity graph."""
    
    nodes = []
    edges = []
    node_ids = {}
    
    # Add session nodes from trial index
    print("  📅 Adding session nodes...")
    session_entities = {}
    
    for file_info in trial_index.get("files", []):
        for session_num in file_info.get("sessions", []):
            if session_num not in session_entities:
                session_id = f"session-{session_num}"
                session_entities[session_num] = {
                    "id": session_id,
                    "name": f"Session {session_num}",
                    "hebrewName": f"ישיבה {session_num}",
                    "type": "SESSION",
                    "number": session_num,
                    "mentions": 1,
                    "sessions": [session_num]
                }
    
    for session in sorted(session_entities.values(), key=lambda x: x["number"]):
        node_id = session["id"]
        if node_id not in node_ids:
            node_ids[node_id] = len(nodes)
            nodes.append(session)
    
    print(f"     Added {len(session_entities)} sessions")
    
    # Add witnesses
    print("  👥 Adding witnesses...")
    for w in witnesses:
        node_id = w.get("id", f"witness-{len(nodes)}")
        if node_id not in node_ids:
            node_ids[node_id] = len(nodes)
            nodes.append({
                "id": node_id,
                "name": w.get("name", ""),
                "hebrewName": w.get("hebrewName", ""),
                "type": "PERSON",
                "isWitness": True,
                "sessions": w.get("sessions", []),
                "mentions": w.get("mentions", 1),
                "image": w.get("image"),
                "hasTestimony": w.get("hasTestimony", False),
                "testimonyFile": w.get("testimonyFile")
            })
    
    print(f"     Added {len(witnesses)} witnesses")
    
    # Add extracted entities
    print("  🏷️ Adding extracted entities...")
    entity_count = 0
    
    for entity_type, entities in consolidated.items():
        for e in entities:
            name = e.get("name", "")
            if not name or len(name) < 2:
                continue
            
            # Generate ID
            clean_name = re.sub(r'[^\w\s-]', '', name.lower())
            clean_name = re.sub(r'\s+', '-', clean_name)[:50]
            node_id = f"{entity_type.lower()}-{clean_name}"
            
            # Skip if already exists (e.g., witness also extracted)
            if node_id in node_ids:
                continue
            
            node_ids[node_id] = len(nodes)
            nodes.append({
                "id": node_id,
                "name": name,
                "hebrewName": e.get("hebrewName", name),
                "type": entity_type,
                "isWitness": False,
                "sessions": e.get("sessions", []),
                "mentions": e.get("mentions", 1),
                "variants": e.get("variants", [])
            })
            entity_count += 1
    
    print(f"     Added {entity_count} entities")
    
    # Build edges
    print("  🔗 Building edges...")
    
    # Witness to session edges
    for node in nodes:
        if node.get("isWitness"):
            for session_num in node.get("sessions", []):
                session_id = f"session-{session_num}"
                if session_id in node_ids:
                    edges.append({
                        "source": node["id"],
                        "target": session_id,
                        "type": "TESTIFIED_IN",
                        "weight": 1
                    })
    
    # Entity to session edges (co-occurrence)
    for node in nodes:
        if not node.get("isWitness") and node.get("type") != "SESSION":
            for session_num in node.get("sessions", []):
                session_id = f"session-{session_num}"
                if session_id in node_ids:
                    edges.append({
                        "source": node["id"],
                        "target": session_id,
                        "type": "MENTIONED_IN",
                        "weight": 1
                    })
    
    # Entity to entity edges (same session co-occurrence)
    session_to_entities = defaultdict(list)
    for node in nodes:
        if node.get("type") != "SESSION":
            for session_num in node.get("sessions", []):
                session_to_entities[session_num].append(node["id"])
    
    edge_set = set()
    for session_num, entity_ids in session_to_entities.items():
        for i, eid1 in enumerate(entity_ids):
            for eid2 in entity_ids[i+1:]:
                key = tuple(sorted([eid1, eid2]))
                if key not in edge_set:
                    edge_set.add(key)
                    edges.append({
                        "source": eid1,
                        "target": eid2,
                        "type": "CO_OCCURRENCE",
                        "weight": 1
                    })
    
    print(f"     Created {len(edges)} edges")
    
    # Count types
    type_counts = defaultdict(int)
    for node in nodes:
        t = node.get("type", "OTHER")
        if node.get("isWitness"):
            t = "WITNESS"
        type_counts[t] += 1
    
    return {
        "metadata": {
            "totalNodes": len(nodes),
            "totalEdges": len(edges),
            "generatedAt": datetime.now().isoformat(),
            "typeCounts": dict(type_counts)
        },
        "nodes": nodes,
        "edges": edges
    }

# =============================================================================
# Main
# =============================================================================

async def main():
    parser = argparse.ArgumentParser(description="Full entity extraction")
    parser.add_argument("--skip-extraction", action="store_true", help="Skip DictaBERT, use cache")
    parser.add_argument("--output", default=str(OUTPUT_DIR / "entities-consolidated.json"))
    args = parser.parse_args()
    
    print("=" * 60)
    print("Full Entity Extraction Pipeline")
    print("=" * 60)
    
    start_time = datetime.now()
    
    # Load trial index
    print("\n📚 Loading trial index...")
    trial_index = load_trial_index()
    print(f"   Sessions: {trial_index.get('metadata', {}).get('totalSessions', 0)}")
    
    # Load existing witnesses
    print("\n👥 Loading witnesses...")
    witnesses = load_app_witnesses()
    print(f"   Witnesses: {len(witnesses)}")
    
    # Get OCR files
    ocr_files = sorted(OCR_DIR.glob("*.txt"))
    print(f"\n📄 Found {len(ocr_files)} OCR files")
    
    all_entities = defaultdict(list)
    
    if not args.skip_extraction:
        # Load DictaBERT model
        print("\n📦 Loading DictaBERT NER model...")
        try:
            from transformers import pipeline
            ner = pipeline(
                "ner",
                model="dicta-il/dictabert-ner",
                aggregation_strategy="simple",
            )
            print("   ✅ Model loaded")
        except Exception as e:
            print(f"   ❌ Failed to load model: {e}")
            print("   Run: pip install transformers torch")
            return
        
        # Extract from each file
        print("\n🔍 Extracting entities...")
        for file_path in tqdm(ocr_files, desc="Processing files"):
            result = extract_file_dictabert(file_path, ner)
            
            for entity_type, entities in result.get("entities", {}).items():
                all_entities[entity_type].extend(entities)
    else:
        # Load from cache
        print("\n📂 Loading from cache...")
        for file_path in ocr_files:
            cache_file = CACHE_DIR / f"{file_path.name}.json"
            if cache_file.exists():
                with open(cache_file, encoding='utf-8') as f:
                    result = json.load(f)
                for entity_type, entities in result.get("entities", {}).items():
                    all_entities[entity_type].extend(entities)
    
    print("\n📊 Raw entity counts:")
    for t, e in all_entities.items():
        print(f"   {t}: {len(e)}")
    
    # Consolidate
    print("\n🔄 Consolidating entities...")
    consolidated = await consolidate_with_openai(dict(all_entities))
    
    print("\n📊 Consolidated entity counts:")
    for t, e in consolidated.items():
        print(f"   {t}: {len(e)}")
    
    # Build graph
    print("\n🏗️ Building graph...")
    graph = build_graph(consolidated, witnesses, trial_index)
    
    # Save
    output_path = Path(args.output)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(graph, f, ensure_ascii=False, indent=2)
    
    elapsed = (datetime.now() - start_time).total_seconds()
    
    print("\n" + "=" * 60)
    print("✅ Complete!")
    print(f"   Time: {elapsed:.1f}s")
    print(f"   Nodes: {graph['metadata']['totalNodes']}")
    print(f"   Edges: {graph['metadata']['totalEdges']}")
    print(f"   Types: {graph['metadata']['typeCounts']}")
    print(f"   Output: {output_path}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
