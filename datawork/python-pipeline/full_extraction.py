#!/usr/bin/env python3
"""
Full Entity Graph Extraction Pipeline

Outputs in the exact format expected by the Next.js app:
- metadata: file info, stats
- nodes: entities with unique IDs, variants, sources
- edges: co-occurrence connections between entities
- sessions: trial session metadata with linked entity IDs

Usage:
    python full_extraction.py --file Vol2_p6575.txt
    python full_extraction.py --all
"""

import os
import sys
import json
import asyncio
import argparse
import re
import hashlib
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional, Set, Tuple
from collections import defaultdict
from dataclasses import dataclass, field, asdict

from openai import AsyncOpenAI
from dotenv import load_dotenv
from tqdm import tqdm

try:
    import diskcache
    HAS_CACHE = True
except ImportError:
    HAS_CACHE = False

load_dotenv()

# =============================================================================
# Configuration
# =============================================================================

BASE_DIR = Path(__file__).parent.parent.parent
OCR_DIR = BASE_DIR / "downloads" / "pdf" / "OCR"
OUTPUT_DIR = BASE_DIR / "eichmann-entities"
CACHE_DIR = Path(__file__).parent / ".cache"
WITNESS_INDEX = OUTPUT_DIR / "witness-index.json"

MODEL = "o4-mini"
MAX_CONCURRENT = 10
CHUNK_SIZE = 5000  # Characters per chunk

# =============================================================================
# Caching
# =============================================================================

class Cache:
    def __init__(self):
        if HAS_CACHE:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            self.cache = diskcache.Cache(str(CACHE_DIR))
        else:
            self.cache = {}
    
    def get(self, key: str):
        if HAS_CACHE:
            return self.cache.get(key)
        return self.cache.get(key)
    
    def set(self, key: str, value: Any):
        if HAS_CACHE:
            self.cache.set(key, value, expire=86400*7)
        else:
            self.cache[key] = value

cache = Cache()

# =============================================================================
# ID Generation
# =============================================================================

def make_id(entity_type: str, name: str) -> str:
    """Generate a unique, URL-safe ID for an entity."""
    # Normalize name
    clean = name.lower().strip()
    clean = re.sub(r'[^\w\s-]', '', clean)
    clean = re.sub(r'\s+', '-', clean)
    clean = clean[:50]  # Limit length
    
    type_prefix = entity_type.lower()
    if type_prefix == "person":
        return f"person-{clean}"
    elif type_prefix == "location":
        return f"location-{clean}"
    elif type_prefix == "organization":
        return f"organization-{clean}"
    elif type_prefix == "session":
        return f"session-{clean}"
    elif type_prefix == "event":
        return f"event-{clean}"
    elif type_prefix == "date":
        return f"date-{clean}"
    else:
        return f"{type_prefix}-{clean}"

# =============================================================================
# Load Witness Index
# =============================================================================

def load_witness_index() -> Dict[str, Dict]:
    """Load official witness list."""
    if not WITNESS_INDEX.exists():
        return {}
    
    with open(WITNESS_INDEX) as f:
        data = json.load(f)
    
    # Create lookup by Hebrew name variants
    lookup = {}
    for w in data.get("witnesses", []):
        # Handle both key formats
        hebrew = w.get("hebrew", w.get("hebrewName", ""))
        english = w.get("english", w.get("englishName", ""))
        if hebrew:
            lookup[hebrew.lower()] = {"english": english, "hebrew": hebrew}
            # Also index parts of the name (last name)
            parts = hebrew.split()
            if len(parts) > 1:
                lookup[parts[-1].lower()] = {"english": english, "hebrew": hebrew}
            # Also index without title prefixes
            for prefix in ["דר'", "דר׳", "ד\"ר", "פרופ'", "פרופ׳"]:
                if hebrew.startswith(prefix):
                    clean = hebrew[len(prefix):].strip()
                    lookup[clean.lower()] = {"english": english, "hebrew": hebrew}
    
    return lookup

# =============================================================================
# Session Detection
# =============================================================================

def find_sessions(text: str) -> List[Dict]:
    """Find all sessions and their line boundaries."""
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
    
    # Dedupe: keep largest range per session
    by_num = {}
    for s in sessions:
        n = s["number"]
        if n not in by_num or (s["lineEnd"] - s["lineStart"]) > (by_num[n]["lineEnd"] - by_num[n]["lineStart"]):
            by_num[n] = s
    
    return sorted(by_num.values(), key=lambda x: x["number"])

# =============================================================================
# Local Extraction (FREE)
# =============================================================================

def extract_local(text: str, file_name: str) -> Dict[str, List[Dict]]:
    """Fast local extraction using regex."""
    entities = defaultdict(list)
    lines = text.split('\n')
    
    # Sessions
    for s in find_sessions(text):
        entities["SESSION"].append({
            "name": f"Session {s['number']}",
            "hebrewName": f"ישיבה {s['number']}",
            "number": s["number"],
            "lineStart": s["lineStart"],
            "lineEnd": s["lineEnd"],
            "file": file_name
        })
    
    # Known locations
    locations = {
        "אושוויץ": {"english": "Auschwitz", "category": "camp"},
        "בירקנאו": {"english": "Birkenau", "category": "camp"},
        "טרבלינקה": {"english": "Treblinka", "category": "camp"},
        "סוביבור": {"english": "Sobibor", "category": "camp"},
        "מיידנק": {"english": "Majdanek", "category": "camp"},
        "חלמנו": {"english": "Chelmno", "category": "camp"},
        "בלזץ": {"english": "Belzec", "category": "camp"},
        "ברגן-בלזן": {"english": "Bergen-Belsen", "category": "camp"},
        "ורשה": {"english": "Warsaw", "category": "ghetto"},
        "לודז": {"english": "Lodz", "category": "ghetto"},
        "קראקוב": {"english": "Krakow", "category": "city"},
        "לובלין": {"english": "Lublin", "category": "city"},
        "ווילנה": {"english": "Vilna", "category": "ghetto"},
        "קובנו": {"english": "Kovno", "category": "ghetto"},
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
    }
    
    for hebrew, info in locations.items():
        count = text.count(hebrew)
        if count > 0:
            entities["LOCATION"].append({
                "name": info["english"],
                "hebrewName": hebrew,
                "category": info["category"],
                "mentions": count
            })
    
    # Key figures
    key_figures = {
        "אייכמן": {"english": "Adolf Eichmann", "role": "defendant", "isWitness": False},
        "אדולף אייכמן": {"english": "Adolf Eichmann", "role": "defendant", "isWitness": False},
        "הימלר": {"english": "Heinrich Himmler", "role": "nazi_leader", "isWitness": False},
        "היידריך": {"english": "Reinhard Heydrich", "role": "nazi_leader", "isWitness": False},
        "היטלר": {"english": "Adolf Hitler", "role": "nazi_leader", "isWitness": False},
        "סרבציוס": {"english": "Dr. Robert Servatius", "role": "defense", "isWitness": False},
        "ד\"ר סרבציוס": {"english": "Dr. Robert Servatius", "role": "defense", "isWitness": False},
        "האוזנר": {"english": "Gideon Hausner", "role": "prosecutor", "isWitness": False},
        "גדעון האוזנר": {"english": "Gideon Hausner", "role": "prosecutor", "isWitness": False},
        "לנדאו": {"english": "Moshe Landau", "role": "judge", "isWitness": False},
    }
    
    for hebrew, info in key_figures.items():
        count = text.count(hebrew)
        if count > 0:
            entities["PERSON"].append({
                "name": info["english"],
                "hebrewName": hebrew,
                "role": info["role"],
                "isWitness": info["isWitness"],
                "mentions": count
            })
    
    # Organizations
    orgs = {
        "הגסטאפו": {"english": "Gestapo", "type": "nazi"},
        "הס.ס.": {"english": "SS", "type": "nazi"},
        "SS": {"english": "SS", "type": "nazi"},
        "הוורמאכט": {"english": "Wehrmacht", "type": "nazi"},
        "יודנראט": {"english": "Judenrat", "type": "jewish"},
        "זונדרקומנדו": {"english": "Sonderkommando", "type": "camp"},
    }
    
    for pattern, info in orgs.items():
        count = len(re.findall(re.escape(pattern), text, re.IGNORECASE))
        if count > 0:
            entities["ORGANIZATION"].append({
                "name": info["english"],
                "hebrewName": pattern,
                "orgType": info["type"],
                "mentions": count
            })
    
    return dict(entities)

# =============================================================================
# AI Extraction
# =============================================================================

async def extract_chunk_ai(
    chunk: str,
    chunk_idx: int,
    line_start: int,
    line_end: int,
    session_num: Optional[int],
    file_name: str,
    client: AsyncOpenAI,
    semaphore: asyncio.Semaphore,
    witness_lookup: Dict
) -> Dict:
    """Extract entities from a single chunk using AI."""
    
    async with semaphore:
        try:
            response = await client.chat.completions.create(
                model=MODEL,
                reasoning_effort="low",
                messages=[
                    {
                        "role": "system",
                        "content": """Extract entities from this Eichmann trial transcript chunk.

Return JSON with:
- persons: [{"name": "English Name", "hebrewName": "Hebrew", "role": "witness|prosecutor|defense|judge|nazi|mentioned", "isWitness": true/false}]
- locations: [{"name": "English", "hebrewName": "Hebrew", "category": "camp|ghetto|city|country"}]
- organizations: [{"name": "English", "hebrewName": "Hebrew", "orgType": "nazi|jewish|government"}]
- dates: [{"text": "original", "normalized": "YYYY-MM-DD or description"}]
- events: [{"name": "English description", "type": "transport|selection|uprising|execution"}]

IMPORTANT: Only classify as "witness" if they are testifying. Lawyers, judges are NOT witnesses."""
                    },
                    {
                        "role": "user",
                        "content": chunk
                    }
                ],
                response_format={
                    "type": "json_schema",
                    "json_schema": {
                        "name": "entities",
                        "strict": True,
                        "schema": {
                            "type": "object",
                            "properties": {
                                "persons": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "name": {"type": "string"},
                                            "hebrewName": {"type": "string"},
                                            "role": {"type": "string"},
                                            "isWitness": {"type": "boolean"}
                                        },
                                        "required": ["name", "hebrewName", "role", "isWitness"],
                                        "additionalProperties": False
                                    }
                                },
                                "locations": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "name": {"type": "string"},
                                            "hebrewName": {"type": "string"},
                                            "category": {"type": "string"}
                                        },
                                        "required": ["name", "hebrewName", "category"],
                                        "additionalProperties": False
                                    }
                                },
                                "organizations": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "name": {"type": "string"},
                                            "hebrewName": {"type": "string"},
                                            "orgType": {"type": "string"}
                                        },
                                        "required": ["name", "hebrewName", "orgType"],
                                        "additionalProperties": False
                                    }
                                },
                                "dates": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "text": {"type": "string"},
                                            "normalized": {"type": "string"}
                                        },
                                        "required": ["text", "normalized"],
                                        "additionalProperties": False
                                    }
                                },
                                "events": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "name": {"type": "string"},
                                            "type": {"type": "string"}
                                        },
                                        "required": ["name", "type"],
                                        "additionalProperties": False
                                    }
                                }
                            },
                            "required": ["persons", "locations", "organizations", "dates", "events"],
                            "additionalProperties": False
                        }
                    }
                }
            )
            
            result = json.loads(response.choices[0].message.content)
            
            # Add source info to each entity
            source = {
                "file": file_name,
                "lineStart": line_start,
                "lineEnd": line_end,
                "session": session_num
            }
            
            for entity_list in result.values():
                for e in entity_list:
                    e["source"] = source
            
            # Validate witnesses against official list
            for p in result.get("persons", []):
                hebrew = p.get("hebrewName", "").lower()
                if hebrew in witness_lookup:
                    p["isWitness"] = True
                    p["name"] = witness_lookup[hebrew]["english"]
                elif p.get("isWitness") and p.get("role") not in ["witness"]:
                    p["isWitness"] = False
            
            return result
            
        except Exception as e:
            print(f"  ⚠️ Chunk {chunk_idx} error: {e}")
            return {"persons": [], "locations": [], "organizations": [], "dates": [], "events": []}

# =============================================================================
# Consolidation
# =============================================================================

async def consolidate_entities(
    entities_by_type: Dict[str, List[Dict]],
    client: AsyncOpenAI,
    semaphore: asyncio.Semaphore
) -> Dict[str, List[Dict]]:
    """Consolidate duplicate entities using AI."""
    
    consolidated = {}
    
    for entity_type, entities in entities_by_type.items():
        if not entities:
            consolidated[entity_type] = []
            continue
        
        # Group by name first
        by_name = defaultdict(list)
        for e in entities:
            key = e.get("name", "").lower() or e.get("hebrewName", "").lower()
            by_name[key].append(e)
        
        # Merge duplicates locally
        merged = []
        for name, dupes in by_name.items():
            if not dupes:
                continue
            
            base = dupes[0].copy()
            
            # Collect all variants
            variants = set()
            sources = []
            sessions = set()
            contexts = []
            
            for d in dupes:
                if d.get("hebrewName"):
                    variants.add(d["hebrewName"])
                if d.get("name"):
                    variants.add(d["name"])
                if d.get("source"):
                    sources.append(d["source"])
                    if d["source"].get("session"):
                        sessions.add(d["source"]["session"])
            
            base["variants"] = list(variants)
            base["sources"] = sources
            base["sessions"] = sorted(list(sessions))
            base["mentions"] = len(dupes)
            
            merged.append(base)
        
        # Use AI to merge similar names (e.g., "Eichmann" and "Adolf Eichmann")
        if len(merged) > 5 and entity_type in ["PERSON", "LOCATION", "ORGANIZATION"]:
            names = [m.get("name", m.get("hebrewName", "")) for m in merged]
            
            async with semaphore:
                try:
                    response = await client.chat.completions.create(
                        model=MODEL,
                        reasoning_effort="low",
                        messages=[
                            {
                                "role": "system",
                                "content": f"""Consolidate these {entity_type} names. Group duplicates/variants.

Return JSON: {{"groups": [[indices of same entity], ...]}}

Example for PERSON: ["Adolf Eichmann", "Eichmann", "אייכמן"] are the same → [0, 1, 2]
Only group if CLEARLY the same entity. When in doubt, keep separate."""
                            },
                            {
                                "role": "user",
                                "content": f"Names to consolidate:\n" + "\n".join(f"{i}. {n}" for i, n in enumerate(names))
                            }
                        ],
                        response_format={
                            "type": "json_schema",
                            "json_schema": {
                                "name": "groups",
                                "strict": True,
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "groups": {
                                            "type": "array",
                                            "items": {
                                                "type": "array",
                                                "items": {"type": "integer"}
                                            }
                                        }
                                    },
                                    "required": ["groups"],
                                    "additionalProperties": False
                                }
                            }
                        }
                    )
                    
                    groups = json.loads(response.choices[0].message.content).get("groups", [])
                    
                    # Merge groups
                    used = set()
                    final_merged = []
                    
                    for group in groups:
                        if not group:
                            continue
                        group = [i for i in group if i < len(merged) and i not in used]
                        if not group:
                            continue
                        
                        base = merged[group[0]].copy()
                        all_variants = set(base.get("variants", []))
                        all_sources = list(base.get("sources", []))
                        all_sessions = set(base.get("sessions", []))
                        total_mentions = base.get("mentions", 1)
                        
                        for idx in group[1:]:
                            other = merged[idx]
                            all_variants.update(other.get("variants", []))
                            all_sources.extend(other.get("sources", []))
                            all_sessions.update(other.get("sessions", []))
                            total_mentions += other.get("mentions", 1)
                        
                        base["variants"] = list(all_variants)
                        base["sources"] = all_sources
                        base["sessions"] = sorted(list(all_sessions))
                        base["mentions"] = total_mentions
                        
                        final_merged.append(base)
                        used.update(group)
                    
                    # Add ungrouped
                    for i, m in enumerate(merged):
                        if i not in used:
                            final_merged.append(m)
                    
                    merged = final_merged
                    
                except Exception as e:
                    print(f"  ⚠️ Consolidation error for {entity_type}: {e}")
        
        consolidated[entity_type] = merged
    
    return consolidated

# =============================================================================
# Build Graph Structure
# =============================================================================

def build_graph(
    consolidated: Dict[str, List[Dict]],
    sessions: List[Dict],
    file_name: str
) -> Dict:
    """Build the final graph structure."""
    
    nodes = []
    edges = []
    node_ids = {}
    
    # Create nodes for each entity type
    for entity_type, entities in consolidated.items():
        for e in entities:
            name = e.get("name", e.get("hebrewName", "unknown"))
            node_id = make_id(entity_type, name)
            
            # Avoid duplicates
            if node_id in node_ids:
                continue
            node_ids[node_id] = len(nodes)
            
            node = {
                "id": node_id,
                "name": name,
                "hebrewName": e.get("hebrewName", ""),
                "type": entity_type.upper(),
                "role": e.get("role", ""),
                "isWitness": e.get("isWitness", False),
                "category": e.get("category", e.get("orgType", "")),
                "variants": e.get("variants", []),
                "contexts": [],  # Could extract from sources
                "sessions": e.get("sessions", []),
                "mentions": e.get("mentions", 1),
                "sources": e.get("sources", [])
            }
            nodes.append(node)
    
    # Create session nodes
    session_nodes = []
    for s in sessions:
        session_id = f"session-{s['number']}"
        
        # Find entities in this session
        witness_ids = []
        location_ids = []
        org_ids = []
        person_ids = []
        
        for node in nodes:
            if s["number"] in node.get("sessions", []):
                if node["type"] == "PERSON":
                    if node.get("isWitness"):
                        witness_ids.append(node["id"])
                    else:
                        person_ids.append(node["id"])
                elif node["type"] == "LOCATION":
                    location_ids.append(node["id"])
                elif node["type"] == "ORGANIZATION":
                    org_ids.append(node["id"])
        
        session_nodes.append({
            "id": session_id,
            "name": s["name"],
            "hebrewName": s["hebrewName"],
            "type": "SESSION",
            "number": s["number"],
            "lineStart": s["lineStart"],
            "lineEnd": s["lineEnd"],
            "entityCount": len(witness_ids) + len(location_ids) + len(org_ids) + len(person_ids),
            "witnessIds": witness_ids,
            "locationIds": location_ids,
            "organizationIds": org_ids,
            "personIds": person_ids
        })
    
    # Create edges (co-occurrence in same session)
    edge_counts = defaultdict(lambda: {"weight": 0, "sessions": set()})
    
    for node in nodes:
        node_sessions = node.get("sessions", [])
        for other in nodes:
            if node["id"] >= other["id"]:  # Avoid self-loops and duplicates
                continue
            other_sessions = other.get("sessions", [])
            common = set(node_sessions) & set(other_sessions)
            if common:
                key = (node["id"], other["id"])
                edge_counts[key]["weight"] += len(common)
                edge_counts[key]["sessions"].update(common)
    
    # Convert to edge list
    for (source, target), data in edge_counts.items():
        edges.append({
            "source": source,
            "target": target,
            "weight": data["weight"],
            "sessions": sorted(list(data["sessions"]))
        })
    
    # Sort edges by weight
    edges.sort(key=lambda x: -x["weight"])
    
    # Build final structure
    return {
        "metadata": {
            "file": file_name,
            "generatedAt": datetime.now().isoformat(),
            "chunksProcessed": 0,  # Will be updated
            "totalNodes": len(nodes),
            "totalEdges": len(edges),
            "validatedWitnesses": sum(1 for n in nodes if n.get("isWitness"))
        },
        "nodes": nodes,
        "edges": edges,
        "sessions": session_nodes
    }

# =============================================================================
# Main Pipeline
# =============================================================================

async def process_file(file_path: Path, max_chunks: int = 50) -> Dict:
    """Process a single file through the full pipeline."""
    
    file_name = file_path.name
    print(f"\n{'='*60}")
    print(f"Processing: {file_name}")
    print(f"{'='*60}")
    
    start_time = datetime.now()
    
    # Load text
    text = file_path.read_text(encoding='utf-8')
    lines = text.split('\n')
    print(f"  📄 {len(text):,} chars, {len(lines):,} lines")
    
    # Load witness index
    witness_lookup = load_witness_index()
    print(f"  👥 {len(witness_lookup)} witnesses in index")
    
    # Step 1: Local extraction (FREE)
    print(f"\n  [Step 1] Local extraction...")
    local_start = datetime.now()
    local_entities = extract_local(text, file_name)
    local_elapsed = (datetime.now() - local_start).total_seconds()
    print(f"    ⏱️ {local_elapsed:.2f}s")
    for k, v in local_entities.items():
        print(f"    {k}: {len(v)}")
    
    # Step 2: Find sessions
    print(f"\n  [Step 2] Session detection...")
    sessions_raw = find_sessions(text)
    sessions = []
    for s in sessions_raw:
        sessions.append({
            "name": f"Session {s['number']}",
            "hebrewName": f"ישיבה {s['number']}",
            "number": s["number"],
            "lineStart": s["lineStart"],
            "lineEnd": s["lineEnd"]
        })
    print(f"    Found {len(sessions)} sessions: {[s['number'] for s in sessions]}")
    
    # Step 3: Chunk text with session tracking
    print(f"\n  [Step 3] Chunking...")
    chunks = []
    current_pos = 0
    current_line = 0
    
    while current_pos < len(text) and len(chunks) < max_chunks:
        chunk_end = min(current_pos + CHUNK_SIZE, len(text))
        chunk_text = text[current_pos:chunk_end]
        
        # Find which lines this covers
        chunk_lines = chunk_text.count('\n')
        line_end = current_line + chunk_lines
        
        # Find which session this is in
        session_num = None
        for s in sessions:
            if s["lineStart"] <= current_line <= s["lineEnd"]:
                session_num = s["number"]
                break
        
        chunks.append({
            "text": chunk_text,
            "lineStart": current_line,
            "lineEnd": line_end,
            "session": session_num
        })
        
        current_pos = chunk_end
        current_line = line_end
    
    print(f"    {len(chunks)} chunks (max {max_chunks})")
    
    # Step 4: AI extraction
    print(f"\n  [Step 4] AI extraction...")
    ai_start = datetime.now()
    
    client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    
    ai_results = []
    for i, chunk in enumerate(tqdm(chunks, desc="    AI extraction")):
        result = await extract_chunk_ai(
            chunk["text"],
            i,
            chunk["lineStart"],
            chunk["lineEnd"],
            chunk["session"],
            file_name,
            client,
            semaphore,
            witness_lookup
        )
        ai_results.append(result)
    
    ai_elapsed = (datetime.now() - ai_start).total_seconds()
    print(f"    ⏱️ {ai_elapsed:.1f}s ({ai_elapsed/len(chunks):.2f}s per chunk)")
    
    # Merge all entities by type
    all_entities = defaultdict(list)
    
    # Add local entities
    for entity_type, entities in local_entities.items():
        for e in entities:
            e["source"] = {"file": file_name, "lineStart": 0, "lineEnd": len(lines)}
            all_entities[entity_type].append(e)
    
    # Add AI entities
    for result in ai_results:
        for persons in result.get("persons", []):
            all_entities["PERSON"].append(persons)
        for loc in result.get("locations", []):
            all_entities["LOCATION"].append(loc)
        for org in result.get("organizations", []):
            all_entities["ORGANIZATION"].append(org)
        for date in result.get("dates", []):
            all_entities["DATE"].append(date)
        for event in result.get("events", []):
            all_entities["EVENT"].append(event)
    
    print(f"\n  [Step 5] Consolidation...")
    consol_start = datetime.now()
    consolidated = await consolidate_entities(dict(all_entities), client, semaphore)
    consol_elapsed = (datetime.now() - consol_start).total_seconds()
    print(f"    ⏱️ {consol_elapsed:.1f}s")
    for k, v in consolidated.items():
        print(f"    {k}: {len(v)}")
    
    # Step 6: Build graph
    print(f"\n  [Step 6] Building graph...")
    graph = build_graph(consolidated, sessions, file_name)
    graph["metadata"]["chunksProcessed"] = len(chunks)
    
    total_elapsed = (datetime.now() - start_time).total_seconds()
    
    print(f"\n  {'='*50}")
    print(f"  ✅ Complete in {total_elapsed:.1f}s")
    print(f"     Nodes: {graph['metadata']['totalNodes']}")
    print(f"     Edges: {graph['metadata']['totalEdges']}")
    print(f"     Witnesses: {graph['metadata']['validatedWitnesses']}")
    print(f"     Sessions: {len(graph['sessions'])}")
    
    return graph


async def main():
    parser = argparse.ArgumentParser(description="Full entity graph extraction")
    parser.add_argument("--file", default="Vol2_p6575.txt", help="OCR file to process")
    parser.add_argument("--max-chunks", type=int, default=50, help="Max chunks to process")
    parser.add_argument("--output", help="Output file path")
    args = parser.parse_args()
    
    # Find file
    file_path = OCR_DIR / args.file
    if not file_path.exists():
        # Try test file
        file_path = OUTPUT_DIR / "test-file.txt"
        if not file_path.exists():
            print(f"❌ File not found: {args.file}")
            return
    
    # Process
    graph = await process_file(file_path, args.max_chunks)
    
    # Save
    output_path = args.output or OUTPUT_DIR / "entities-python.json"
    output_path = Path(output_path)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(graph, f, indent=2, ensure_ascii=False)
    
    print(f"\n📁 Saved to: {output_path}")


if __name__ == "__main__":
    asyncio.run(main())

