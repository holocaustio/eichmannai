#!/usr/bin/env python3
"""
Hebrew NER Entity Extraction Pipeline

Uses DictaBERT for local NER extraction + OpenAI for consolidation.
Validates witnesses against official Yad Vashem list.
Outputs proper node/edge graph structure.

Usage:
    python hebner_pipeline.py --file Vol1_p15291.txt
    python hebner_pipeline.py --file Vol1_p15291.txt --output ../../app/public/data/entities.json
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

load_dotenv()

# =============================================================================
# Configuration
# =============================================================================

BASE_DIR = Path(__file__).parent.parent.parent
OCR_DIR = BASE_DIR / "downloads" / "pdf" / "OCR"
OUTPUT_DIR = BASE_DIR / "eichmann-entities"
APP_DATA_DIR = BASE_DIR / "app" / "public" / "data"
WITNESS_INDEX_FILE = OUTPUT_DIR / "witness-index.json"

MODEL_OPENAI = "o4-mini"
MAX_CONCURRENT = 5

# =============================================================================
# Load Witness Index
# =============================================================================

def load_witness_index() -> Dict:
    """Load the official witness index with all variants."""
    if not WITNESS_INDEX_FILE.exists():
        print(f"❌ Witness index not found: {WITNESS_INDEX_FILE}")
        return {"witnesses": [], "keyFigures": {}}
    
    with open(WITNESS_INDEX_FILE, encoding='utf-8') as f:
        data = json.load(f)
    
    # Build lookup tables
    witness_lookup = {}
    for w in data.get("witnesses", []):
        hebrew = w.get("hebrew", "")
        english = w.get("english", "")
        alias = w.get("alias", "")
        
        # Index by various forms
        if hebrew:
            witness_lookup[hebrew.lower()] = {"hebrew": hebrew, "english": english, "isWitness": True}
            # Index by last name
            parts = hebrew.split()
            if len(parts) > 1:
                witness_lookup[parts[-1].lower()] = {"hebrew": hebrew, "english": english, "isWitness": True}
            # Without title prefixes
            for prefix in ["דר'", "דר׳", "ד\"ר", "פרופ'", "פרופ׳"]:
                if hebrew.startswith(prefix):
                    clean = hebrew[len(prefix):].strip()
                    witness_lookup[clean.lower()] = {"hebrew": hebrew, "english": english, "isWitness": True}
        
        if alias:
            witness_lookup[alias.lower()] = {"hebrew": hebrew, "english": english, "isWitness": True}
    
    # Build key figures lookup
    key_figures = {}
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
                key_figures[hebrew.lower()] = entry
                parts = hebrew.split()
                if len(parts) > 1:
                    key_figures[parts[-1].lower()] = entry
            
            for v in variants:
                key_figures[v.lower()] = entry
    
    return {
        "witnesses": data.get("witnesses", []),
        "witness_lookup": witness_lookup,
        "key_figures": key_figures,
        "keyFigures": data.get("keyFigures", {})
    }

# =============================================================================
# Text Normalization
# =============================================================================

def normalize_text(text: str) -> str:
    """Normalize Hebrew text for better NER."""
    # Normalize quotes
    text = text.replace('״', '"').replace('׳', "'")
    text = text.replace('"', '"').replace('"', '"')
    
    # Remove extra whitespace but preserve newlines for session detection
    lines = text.split('\n')
    lines = [re.sub(r'[ \t]+', ' ', line).strip() for line in lines]
    return '\n'.join(lines)


def canonicalize_name(name: str) -> str:
    """Remove titles and normalize a name."""
    titles = [
        r'^ד["\״׳\']ר\s+',
        r'^דר\s+',
        r'^פרופ[\'׳]?\s+',
        r'^מר\s+',
        r'^גב[\'׳]?\s+',
        r'^העד\s+',
        r'^העדה\s+',
        r'^השופט\s+',
    ]
    
    result = name.strip()
    for pattern in titles:
        result = re.sub(pattern, '', result, flags=re.IGNORECASE)
    
    return result.strip()

# =============================================================================
# Session Detection
# =============================================================================

def detect_sessions(text: str) -> List[Dict]:
    """Detect all sessions and their line boundaries."""
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


def get_session_for_line(line_num: int, sessions: List[Dict]) -> Optional[int]:
    """Get session number for a given line."""
    for s in sessions:
        if s["lineStart"] <= line_num <= s["lineEnd"]:
            return s["number"]
    return None

# =============================================================================
# DictaBERT NER Extraction
# =============================================================================

def extract_entities_dictabert(text: str, sessions: List[Dict], file_name: str) -> Dict[str, List[Dict]]:
    """Extract entities using DictaBERT NER model."""
    try:
        from transformers import pipeline
    except ImportError:
        print("❌ transformers not installed. Run: pip install transformers torch")
        return {}
    
    print("  📦 Loading DictaBERT NER model...")
    start = time.time()
    
    ner = pipeline(
        "ner",
        model="dicta-il/dictabert-ner",
        aggregation_strategy="simple",
    )
    
    print(f"     Model loaded in {time.time() - start:.1f}s")
    print("  🔍 Extracting entities...")
    
    start = time.time()
    
    # Process line by line to track positions
    lines = text.split('\n')
    entities_raw = defaultdict(list)
    
    # Process in batches for efficiency
    batch_size = 50
    total_batches = (len(lines) + batch_size - 1) // batch_size
    
    for batch_idx in range(total_batches):
        batch_start = batch_idx * batch_size
        batch_end = min((batch_idx + 1) * batch_size, len(lines))
        batch_lines = lines[batch_start:batch_end]
        batch_text = ' '.join(batch_lines)
        
        if not batch_text.strip():
            continue
        
        try:
            results = ner(batch_text[:2000])  # Limit per batch
            
            for r in results:
                entity_type = r.get("entity_group", "UNKNOWN")
                word = r.get("word", "").strip()
                score = r.get("score", 0)
                
                # Filter low confidence and short entities
                if score < 0.6 or len(word) < 2:
                    continue
                
                # Skip fragments (single chars, punctuation)
                if re.match(r'^[\'\"\-\.\,\;\:\(\)\[\]]+$', word):
                    continue
                
                session_num = get_session_for_line(batch_start, sessions)
                
                entities_raw[entity_type].append({
                    "text": word,
                    "score": score,
                    "lineStart": batch_start,
                    "lineEnd": batch_end,
                    "session": session_num,
                    "file": file_name
                })
        
        except Exception as e:
            print(f"     ⚠️ Batch {batch_idx} error: {e}")
    
    print(f"     Extracted in {time.time() - start:.1f}s")
    
    return dict(entities_raw)

# =============================================================================
# Local Pattern-Based Extraction
# =============================================================================

def extract_entities_patterns(text: str, sessions: List[Dict], file_name: str, witness_index: Dict) -> Dict[str, List[Dict]]:
    """Extract entities using regex patterns."""
    entities = defaultdict(list)
    lines = text.split('\n')
    
    # Known camps/locations
    locations = {
        "אושוויץ": "Auschwitz", "בירקנאו": "Birkenau", "טרבלינקה": "Treblinka",
        "סוביבור": "Sobibor", "מיידנק": "Majdanek", "חלמנו": "Chelmno",
        "בלזץ": "Belzec", "ברגן-בלזן": "Bergen-Belsen", "דכאו": "Dachau",
        "בוכנוואלד": "Buchenwald", "מאוטהאוזן": "Mauthausen",
        "ורשה": "Warsaw", "לודז": "Lodz", "קראקוב": "Krakow",
        "לובלין": "Lublin", "ווילנה": "Vilna", "קובנו": "Kovno",
        "בודפשט": "Budapest", "ברלין": "Berlin", "וינה": "Vienna",
        "פראג": "Prague", "ירושלים": "Jerusalem", "תל אביב": "Tel Aviv",
        "גרמניה": "Germany", "פולין": "Poland", "הונגריה": "Hungary",
        "ישראל": "Israel", "אוסטריה": "Austria", "צ'כוסלובקיה": "Czechoslovakia",
        "טרזין": "Theresienstadt", "ראוונסבריק": "Ravensbrück",
    }
    
    for hebrew, english in locations.items():
        pattern = re.compile(re.escape(hebrew))
        for i, line in enumerate(lines):
            for match in pattern.finditer(line):
                session_num = get_session_for_line(i, sessions)
                entities["LOCATION"].append({
                    "text": hebrew,
                    "english": english,
                    "score": 1.0,
                    "lineStart": i,
                    "lineEnd": i,
                    "session": session_num,
                    "file": file_name,
                    "category": "location"
                })
    
    # Key figures from witness index
    for hebrew, info in witness_index.get("key_figures", {}).items():
        pattern = re.compile(re.escape(hebrew), re.IGNORECASE)
        for i, line in enumerate(lines):
            if pattern.search(line.lower()):
                session_num = get_session_for_line(i, sessions)
                entities["KEY_FIGURE"].append({
                    "text": info["hebrew"],
                    "english": info["english"],
                    "role": info["role"],
                    "category": info["category"],
                    "isWitness": False,
                    "score": 1.0,
                    "lineStart": i,
                    "lineEnd": i,
                    "session": session_num,
                    "file": file_name
                })
    
    # Witness patterns
    witness_patterns = [
        r'עדותו\s+של\s+([^\n,\.]{3,40})',
        r'העד\s+([א-ת][א-ת\"\'\-\s]{2,30}?)(?:\s*[,:;]|\s+מ|\s+ב|\s+ה|\s*$)',
        r'העדה\s+([א-ת][א-ת\"\'\-\s]{2,30}?)(?:\s*[,:;]|\s+מ|\s+ב|\s+ה|\s*$)',
    ]
    
    for pattern in witness_patterns:
        for i, line in enumerate(lines):
            for match in re.finditer(pattern, line):
                name = match.group(1).strip()
                if len(name) > 2 and len(name) < 40:
                    session_num = get_session_for_line(i, sessions)
                    entities["WITNESS_CANDIDATE"].append({
                        "text": name,
                        "score": 0.8,
                        "lineStart": i,
                        "lineEnd": i,
                        "session": session_num,
                        "file": file_name
                    })
    
    return dict(entities)

# =============================================================================
# Validate and Merge Entities
# =============================================================================

def validate_and_merge_entities(
    ner_entities: Dict[str, List[Dict]],
    pattern_entities: Dict[str, List[Dict]],
    witness_index: Dict
) -> Dict[str, List[Dict]]:
    """Merge NER and pattern entities, validate witnesses."""
    
    merged = defaultdict(list)
    witness_lookup = witness_index.get("witness_lookup", {})
    key_figures = witness_index.get("key_figures", {})
    
    # Map NER entity types to our types
    type_mapping = {
        "PER": "PERSON",
        "GPE": "LOCATION", 
        "LOC": "LOCATION",
        "FAC": "LOCATION",  # Facilities are locations
        "ORG": "ORGANIZATION",
        "TIMEX": "DATE",
        "EVE": "EVENT",
        "TTL": "TITLE",  # Titles - skip these
        "ANG": "LANGUAGE",  # Languages - skip
        "MISC": "MISC",
        "DUC": "DOCUMENT",
        "WOA": "WORK",  # Works of art
    }
    
    # Process NER entities
    for ner_type, entities in ner_entities.items():
        our_type = type_mapping.get(ner_type)
        if not our_type or our_type in ["TITLE", "LANGUAGE"]:
            continue
        
        for e in entities:
            text = e["text"]
            canonical = canonicalize_name(text).lower()
            
            # Check if this is a known witness
            if canonical in witness_lookup:
                info = witness_lookup[canonical]
                e["isWitness"] = True
                e["english"] = info["english"]
                e["validatedWitness"] = True
                merged["WITNESS"].append(e)
            # Check if key figure
            elif canonical in key_figures:
                info = key_figures[canonical]
                e["isWitness"] = False
                e["english"] = info["english"]
                e["role"] = info["role"]
                e["category"] = info["category"]
                merged["KEY_FIGURE"].append(e)
            else:
                merged[our_type].append(e)
    
    # Add pattern-based entities
    for ptype, entities in pattern_entities.items():
        for e in entities:
            if ptype == "WITNESS_CANDIDATE":
                canonical = canonicalize_name(e["text"]).lower()
                if canonical in witness_lookup:
                    info = witness_lookup[canonical]
                    e["isWitness"] = True
                    e["english"] = info["english"]
                    e["validatedWitness"] = True
                    merged["WITNESS"].append(e)
            else:
                merged[ptype].append(e)
    
    return dict(merged)

# =============================================================================
# Consolidate Entities with OpenAI
# =============================================================================

async def consolidate_with_openai(entities: Dict[str, List[Dict]], witness_index: Dict) -> Dict[str, List[Dict]]:
    """Use OpenAI to consolidate duplicate entity names."""
    from openai import AsyncOpenAI
    
    client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
    consolidated = {}
    
    for entity_type, entity_list in entities.items():
        if not entity_list:
            consolidated[entity_type] = []
            continue
        
        # Group by approximate name
        by_name = defaultdict(list)
        for e in entity_list:
            key = canonicalize_name(e.get("text", "")).lower()[:20]
            by_name[key].append(e)
        
        # Local merge first
        locally_merged = []
        for key, dupes in by_name.items():
            if not dupes:
                continue
            
            base = dupes[0].copy()
            all_sessions = set()
            all_sources = []
            total_mentions = 0
            variants = set()
            
            for d in dupes:
                if d.get("session"):
                    all_sessions.add(d["session"])
                all_sources.append({
                    "file": d.get("file", ""),
                    "lineStart": d.get("lineStart", 0),
                    "lineEnd": d.get("lineEnd", 0),
                    "session": d.get("session")
                })
                total_mentions += 1
                variants.add(d.get("text", ""))
            
            base["sessions"] = sorted(list(all_sessions))
            base["sources"] = all_sources[:10]  # Limit sources
            base["mentions"] = total_mentions
            base["variants"] = list(variants)
            locally_merged.append(base)
        
        # If too many entities, use OpenAI to consolidate names
        if len(locally_merged) > 20 and entity_type in ["PERSON", "LOCATION", "ORGANIZATION", "WITNESS"]:
            print(f"     🤖 Consolidating {len(locally_merged)} {entity_type} with OpenAI...")
            
            names = [e.get("text", "") for e in locally_merged]
            
            try:
                response = await client.chat.completions.create(
                    model=MODEL_OPENAI,
                    reasoning_effort="low",
                    messages=[
                        {
                            "role": "system",
                            "content": f"""Consolidate these {entity_type} names from Eichmann trial transcripts.
Group duplicates and variants of the same entity.
Return JSON: {{"groups": [[list of indices that are the same entity], ...]}}

Rules:
- Only merge if CLEARLY the same entity (different spelling, with/without title)
- "אייכמן" and "אדולף אייכמן" = same
- "ד"ר סרבציוס" and "סרבציוס" = same
- When in doubt, keep separate"""
                        },
                        {
                            "role": "user",
                            "content": "Names:\n" + "\n".join(f"{i}. {n}" for i, n in enumerate(names[:100]))
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
                    group = [i for i in group if i < len(locally_merged) and i not in used]
                    if not group:
                        continue
                    
                    base = locally_merged[group[0]].copy()
                    all_variants = set(base.get("variants", []))
                    all_sources = list(base.get("sources", []))
                    all_sessions = set(base.get("sessions", []))
                    total_mentions = base.get("mentions", 1)
                    
                    for idx in group[1:]:
                        other = locally_merged[idx]
                        all_variants.update(other.get("variants", []))
                        all_sources.extend(other.get("sources", []))
                        all_sessions.update(other.get("sessions", []))
                        total_mentions += other.get("mentions", 1)
                    
                    base["variants"] = list(all_variants)
                    base["sources"] = all_sources[:20]
                    base["sessions"] = sorted(list(all_sessions))
                    base["mentions"] = total_mentions
                    
                    final_merged.append(base)
                    used.update(group)
                
                # Add ungrouped
                for i, e in enumerate(locally_merged):
                    if i not in used:
                        final_merged.append(e)
                
                locally_merged = final_merged
                
            except Exception as e:
                print(f"     ⚠️ OpenAI consolidation error: {e}")
        
        consolidated[entity_type] = locally_merged
    
    return consolidated

# =============================================================================
# Build Graph Structure
# =============================================================================

def make_id(entity_type: str, name: str) -> str:
    """Generate a unique, URL-safe ID."""
    clean = name.lower().strip()
    clean = re.sub(r'[^\w\s-]', '', clean)
    clean = re.sub(r'\s+', '-', clean)
    clean = clean[:50]
    
    prefix = entity_type.lower().replace("_", "-")
    return f"{prefix}-{clean}" if clean else f"{prefix}-unknown"


def build_graph(
    consolidated: Dict[str, List[Dict]],
    sessions: List[Dict],
    file_name: str,
    witness_index: Dict
) -> Dict:
    """Build the final node/edge graph structure."""
    
    nodes = []
    edges = []
    node_ids = {}
    
    # Create session nodes first
    session_nodes = []
    for s in sessions:
        session_id = f"session-{s['number']}"
        session_nodes.append({
            "id": session_id,
            "name": f"Session {s['number']}",
            "hebrewName": f"ישיבה {s['number']}",
            "type": "SESSION",
            "number": s["number"],
            "lineStart": s["lineStart"],
            "lineEnd": s["lineEnd"],
            "entityCount": 0,
            "witnessIds": [],
            "locationIds": [],
            "organizationIds": [],
            "personIds": []
        })
    
    # Create entity nodes
    for entity_type, entity_list in consolidated.items():
        for e in entity_list:
            name = e.get("english", e.get("text", "unknown"))
            hebrew_name = e.get("text", "")
            node_id = make_id(entity_type, name)
            
            # Skip duplicates
            if node_id in node_ids:
                # Merge with existing
                existing = nodes[node_ids[node_id]]
                existing["mentions"] = existing.get("mentions", 0) + e.get("mentions", 1)
                existing["sessions"] = sorted(list(set(existing.get("sessions", [])) | set(e.get("sessions", []))))
                existing["variants"] = list(set(existing.get("variants", [])) | set(e.get("variants", [])))
                continue
            
            node_ids[node_id] = len(nodes)
            
            # Determine role and category
            role = e.get("role", "")
            category = e.get("category", "")
            is_witness = e.get("isWitness", False) or e.get("validatedWitness", False)
            
            if entity_type == "WITNESS":
                is_witness = True
                role = "witness"
                category = "witness"
            
            node = {
                "id": node_id,
                "name": name,
                "hebrewName": hebrew_name,
                "type": entity_type if entity_type != "WITNESS" else "PERSON",
                "role": role,
                "isWitness": is_witness,
                "category": category,
                "variants": e.get("variants", []),
                "contexts": [],
                "sessions": e.get("sessions", []),
                "mentions": e.get("mentions", 1),
                "sources": e.get("sources", [])[:10]
            }
            nodes.append(node)
            
            # Link to session nodes
            for sess_num in e.get("sessions", []):
                for sn in session_nodes:
                    if sn["number"] == sess_num:
                        sn["entityCount"] += 1
                        if is_witness:
                            sn["witnessIds"].append(node_id)
                        elif entity_type == "LOCATION":
                            sn["locationIds"].append(node_id)
                        elif entity_type == "ORGANIZATION":
                            sn["organizationIds"].append(node_id)
                        elif entity_type == "PERSON":
                            sn["personIds"].append(node_id)
    
    # Dedupe session lists
    for sn in session_nodes:
        sn["witnessIds"] = list(set(sn["witnessIds"]))
        sn["locationIds"] = list(set(sn["locationIds"]))
        sn["organizationIds"] = list(set(sn["organizationIds"]))
        sn["personIds"] = list(set(sn["personIds"]))
    
    # Create edges (co-occurrence in same session)
    edge_counts = defaultdict(lambda: {"weight": 0, "sessions": set()})
    
    for node in nodes:
        node_sessions = set(node.get("sessions", []))
        for other in nodes:
            if node["id"] >= other["id"]:
                continue
            other_sessions = set(other.get("sessions", []))
            common = node_sessions & other_sessions
            if common:
                key = (node["id"], other["id"])
                edge_counts[key]["weight"] += len(common)
                edge_counts[key]["sessions"].update(common)
    
    for (source, target), data in edge_counts.items():
        if data["weight"] >= 1:  # Minimum weight threshold
            edges.append({
                "source": source,
                "target": target,
                "weight": data["weight"],
                "sessions": sorted(list(data["sessions"]))
            })
    
    # Sort edges by weight
    edges.sort(key=lambda x: -x["weight"])
    
    # Validate witnesses
    validated_witnesses = [n for n in nodes if n.get("isWitness")]
    
    # Count extracted vs official witnesses
    official_witnesses = set(w.get("hebrew", "").lower() for w in witness_index.get("witnesses", []))
    found_official = []
    for n in validated_witnesses:
        hebrew = n.get("hebrewName", "").lower()
        canonical = canonicalize_name(hebrew)
        if hebrew in official_witnesses or canonical in official_witnesses:
            found_official.append(n["name"])
    
    # Build final structure
    return {
        "metadata": {
            "file": file_name,
            "generatedAt": datetime.now().isoformat(),
            "totalNodes": len(nodes),
            "totalEdges": len(edges),
            "totalSessions": len(session_nodes),
            "validatedWitnesses": len(validated_witnesses),
            "officialWitnessesFound": len(found_official),
            "officialWitnessTotal": len(witness_index.get("witnesses", [])),
            "extractionMethod": "DictaBERT + OpenAI consolidation"
        },
        "nodes": nodes,
        "edges": edges[:500],  # Limit edges to top 500
        "sessions": session_nodes
    }

# =============================================================================
# Main Pipeline
# =============================================================================

async def run_pipeline(file_path: Path, output_path: Path):
    """Run the full extraction pipeline."""
    
    print("=" * 60)
    print("Hebrew NER Entity Extraction Pipeline")
    print("=" * 60)
    print(f"Input: {file_path.name}")
    print(f"Output: {output_path}")
    
    start_time = datetime.now()
    
    # Load text
    print("\n[1] Loading text...")
    text = file_path.read_text(encoding='utf-8')
    text = normalize_text(text)
    lines = text.split('\n')
    print(f"    {len(text):,} chars, {len(lines):,} lines")
    
    # Load witness index
    print("\n[2] Loading witness index...")
    witness_index = load_witness_index()
    print(f"    {len(witness_index.get('witnesses', []))} official witnesses")
    print(f"    {len(witness_index.get('key_figures', {}))} key figures")
    
    # Detect sessions
    print("\n[3] Detecting sessions...")
    sessions = detect_sessions(text)
    print(f"    Found {len(sessions)} sessions: {[s['number'] for s in sessions]}")
    
    # Pattern-based extraction (instant)
    print("\n[4] Pattern-based extraction...")
    pattern_entities = extract_entities_patterns(text, sessions, file_path.name, witness_index)
    for etype, elist in pattern_entities.items():
        print(f"    {etype}: {len(elist)}")
    
    # DictaBERT NER extraction
    print("\n[5] DictaBERT NER extraction...")
    ner_entities = extract_entities_dictabert(text, sessions, file_path.name)
    for etype, elist in ner_entities.items():
        print(f"    {etype}: {len(elist)}")
    
    # Merge and validate
    print("\n[6] Merging and validating entities...")
    merged = validate_and_merge_entities(ner_entities, pattern_entities, witness_index)
    for etype, elist in merged.items():
        print(f"    {etype}: {len(elist)}")
    
    # Consolidate with OpenAI
    print("\n[7] Consolidating with OpenAI...")
    consolidated = await consolidate_with_openai(merged, witness_index)
    for etype, elist in consolidated.items():
        print(f"    {etype}: {len(elist)}")
    
    # Build graph
    print("\n[8] Building graph structure...")
    graph = build_graph(consolidated, sessions, file_path.name, witness_index)
    
    # Print validation report
    print("\n" + "=" * 60)
    print("VALIDATION REPORT")
    print("=" * 60)
    print(f"Total nodes: {graph['metadata']['totalNodes']}")
    print(f"Total edges: {graph['metadata']['totalEdges']}")
    print(f"Sessions: {graph['metadata']['totalSessions']}")
    print(f"Validated witnesses: {graph['metadata']['validatedWitnesses']}")
    print(f"Official witnesses found: {graph['metadata']['officialWitnessesFound']} / {graph['metadata']['officialWitnessTotal']}")
    
    # List found witnesses
    witnesses = [n for n in graph["nodes"] if n.get("isWitness")]
    print(f"\nWitnesses found ({len(witnesses)}):")
    for w in witnesses[:20]:
        print(f"  ✓ {w['name']} ({w['hebrewName']})")
    if len(witnesses) > 20:
        print(f"  ... and {len(witnesses) - 20} more")
    
    # Save output
    print("\n[9] Saving output...")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(graph, f, indent=2, ensure_ascii=False)
    
    elapsed = (datetime.now() - start_time).total_seconds()
    print(f"\n✅ Complete in {elapsed:.1f}s")
    print(f"   Output: {output_path}")
    
    return graph


def main():
    parser = argparse.ArgumentParser(description="Hebrew NER Entity Extraction")
    parser.add_argument("--file", default="Vol1_p15291.txt", help="OCR file to process")
    parser.add_argument("--output", help="Output file path")
    args = parser.parse_args()
    
    # Find input file
    file_path = OCR_DIR / args.file
    if not file_path.exists():
        print(f"❌ File not found: {file_path}")
        return
    
    # Set output path
    if args.output:
        output_path = Path(args.output)
    else:
        output_path = APP_DATA_DIR / "entities.json"
    
    # Run pipeline
    asyncio.run(run_pipeline(file_path, output_path))


if __name__ == "__main__":
    main()

