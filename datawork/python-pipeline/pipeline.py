#!/usr/bin/env python3
"""
Eichmann Trial Corpus Processing Pipeline

Hybrid approach:
1. Local extraction (regex) - FREE, instant
2. PDF re-extraction with PyMuPDF - Better than OCR
3. OpenAI for consolidation and role classification
4. Parallel processing with rate limiting
5. Caching to avoid reprocessing

Usage:
    python pipeline.py --mode extract --files all
    python pipeline.py --mode consolidate
    python pipeline.py --mode testimonies
    python pipeline.py --mode sessions
"""

import os
import sys
import json
import asyncio
import argparse
import hashlib
import re
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field, asdict
from collections import defaultdict
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

# Third-party imports
try:
    import fitz  # PyMuPDF
except ImportError:
    print("❌ PyMuPDF not installed. Run: pip install pymupdf")
    sys.exit(1)

try:
    from openai import AsyncOpenAI
except ImportError:
    print("❌ OpenAI not installed. Run: pip install openai")
    sys.exit(1)

try:
    import diskcache
except ImportError:
    diskcache = None
    print("⚠️  diskcache not installed. Caching disabled.")

from tqdm import tqdm
from dotenv import load_dotenv

# Load environment
load_dotenv()

# =============================================================================
# Configuration
# =============================================================================

BASE_DIR = Path(__file__).parent.parent.parent
PDF_DIR = BASE_DIR / "downloads" / "pdf" / "filestoprocess"
OCR_DIR = BASE_DIR / "downloads" / "pdf" / "OCR"
OUTPUT_DIR = BASE_DIR / "eichmann-entities"
CACHE_DIR = BASE_DIR / "datawork" / "python-pipeline" / ".cache"
WITNESS_INDEX = OUTPUT_DIR / "witness-index.json"

# OpenAI settings
MODEL = "o4-mini"  # Fast, cheap, good for structured extraction
MAX_CONCURRENT_REQUESTS = 10  # Rate limiting
CHUNK_SIZE = 4000  # Characters per chunk

# =============================================================================
# Data Models
# =============================================================================

@dataclass
class Entity:
    """Represents an extracted entity."""
    id: str
    name: str
    type: str  # PERSON, LOCATION, ORGANIZATION, DATE, EVENT, SESSION
    hebrew_name: Optional[str] = None
    variants: List[str] = field(default_factory=list)
    role: Optional[str] = None  # witness, prosecutor, defense, judge, etc.
    is_witness: bool = False
    contexts: List[str] = field(default_factory=list)
    sessions: List[int] = field(default_factory=list)
    mentions: int = 0
    sources: List[Dict] = field(default_factory=list)


@dataclass
class Session:
    """Represents a trial session."""
    id: str
    number: int
    name: str
    hebrew_name: str
    line_start: int
    line_end: int
    file: str
    witness_ids: List[str] = field(default_factory=list)
    entity_ids: List[str] = field(default_factory=list)


# =============================================================================
# Caching Layer
# =============================================================================

class Cache:
    """Simple disk cache for avoiding reprocessing."""
    
    def __init__(self, cache_dir: Path):
        self.enabled = diskcache is not None
        if self.enabled:
            cache_dir.mkdir(parents=True, exist_ok=True)
            self.cache = diskcache.Cache(str(cache_dir))
        else:
            self.cache = {}
    
    def get(self, key: str) -> Optional[Any]:
        if self.enabled:
            return self.cache.get(key)
        return self.cache.get(key)
    
    def set(self, key: str, value: Any, expire: int = 86400 * 7):
        if self.enabled:
            self.cache.set(key, value, expire=expire)
        else:
            self.cache[key] = value
    
    def file_hash(self, file_path: Path) -> str:
        """Get hash of file for cache invalidation."""
        content = file_path.read_bytes()
        return hashlib.md5(content).hexdigest()[:16]

cache = Cache(CACHE_DIR)

# =============================================================================
# Text Extraction
# =============================================================================

def extract_text_from_pdf(pdf_path: Path) -> Tuple[str, List[Dict]]:
    """
    Extract text from PDF using PyMuPDF with column handling.
    Returns text and block metadata.
    """
    doc = fitz.open(pdf_path)
    all_blocks = []
    
    for page_num in range(len(doc)):
        page = doc[page_num]
        blocks = page.get_text("dict")["blocks"]
        
        for block in blocks:
            if block.get("type") == 0:  # Text block
                block_text = ""
                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        block_text += span.get("text", "")
                    block_text += "\n"
                
                if block_text.strip():
                    all_blocks.append({
                        "page": page_num,
                        "x0": block["bbox"][0],
                        "y0": block["bbox"][1],
                        "x1": block["bbox"][2],
                        "y1": block["bbox"][3],
                        "text": block_text.strip()
                    })
    
    doc.close()
    
    # Sort for RTL two-column: right column first (higher x), then top to bottom
    # Hebrew PDFs typically have right column first
    page_width = 612  # Standard A4 width in points
    mid_x = page_width / 2
    
    def sort_key(b):
        # For RTL: right column (higher x) should come first
        column = 0 if b["x0"] > mid_x else 1  # Right column = 0, Left = 1
        return (b["page"], column, b["y0"])
    
    all_blocks.sort(key=sort_key)
    
    text = "\n\n".join(b["text"] for b in all_blocks)
    return text, all_blocks


def read_ocr_text(ocr_path: Path) -> str:
    """Read existing OCR text file."""
    return ocr_path.read_text(encoding='utf-8')


# =============================================================================
# Local Entity Extraction (Regex-based, FREE)
# =============================================================================

def extract_entities_local(text: str) -> Dict[str, List[Dict]]:
    """
    Fast local entity extraction using regex patterns.
    This is FREE and instant - use it to reduce AI calls.
    """
    entities = defaultdict(list)
    
    # Session patterns
    session_pattern = r'ישיבה\s+(?:מס[\'׳]?\s*)?(\d+)'
    for match in re.finditer(session_pattern, text):
        entities["SESSION"].append({
            "name": f"Session {match.group(1)}",
            "hebrew_name": f"ישיבה {match.group(1)}",
            "number": int(match.group(1)),
            "start": match.start(),
            "end": match.end()
        })
    
    # Witness declaration patterns
    witness_patterns = [
        (r'עדותו\s+של\s+([^\n,\.]+)', "witness_declaration"),
        (r'העד\s+([א-ת"״\'\-\s]{2,30}?)(?:\s*[,:;]|\s+מ|\s+ב|\s+ה|\s*$)', "witness_mention"),
        (r'העדה\s+([א-ת"״\'\-\s]{2,30}?)(?:\s*[,:;]|\s+מ|\s+ב|\s+ה|\s*$)', "witness_mention"),
    ]
    
    for pattern, role in witness_patterns:
        for match in re.finditer(pattern, text):
            name = match.group(1).strip()
            if len(name) > 2 and len(name) < 40:
                entities["WITNESS_CANDIDATE"].append({
                    "name": name,
                    "role": role,
                    "start": match.start(),
                    "context": text[max(0, match.start()-50):match.end()+50]
                })
    
    # Known locations (Holocaust-related)
    locations = {
        "camps": ["אושוויץ", "בירקנאו", "טרבלינקה", "סוביבור", "מיידנק", "חלמנו", "בלזץ", "דכאו", "בוכנוואלד", "ברגן-בלזן", "מאוטהאוזן", "ראוונסבריק"],
        "ghettos": ["ורשה", "לודז", "קראקוב", "לובלין", "ווילנה", "קובנו", "מינסק", "ריגה", "ביאליסטוק", "טרזין"],
        "cities": ["ברלין", "וינה", "פראג", "בודפשט", "אמסטרדם", "פריז", "סלוניקי", "רומא"],
        "israel": ["ירושלים", "תל אביב", "חיפה", "ישראל", "רמת גן"],
        "countries": ["גרמניה", "פולין", "הונגריה", "צרפת", "הולנד", "יוון", "איטליה"]
    }
    
    for category, locs in locations.items():
        for loc in locs:
            count = text.count(loc)
            if count > 0:
                entities["LOCATION"].append({
                    "name": loc,
                    "category": category,
                    "mentions": count
                })
    
    # Key figures (known names)
    key_figures = {
        "אייכמן": {"english": "Adolf Eichmann", "role": "defendant"},
        "אדולף אייכמן": {"english": "Adolf Eichmann", "role": "defendant"},
        "הימלר": {"english": "Heinrich Himmler", "role": "nazi_leader"},
        "היידריך": {"english": "Reinhard Heydrich", "role": "nazi_leader"},
        "גרינג": {"english": "Hermann Göring", "role": "nazi_leader"},
        "היטלר": {"english": "Adolf Hitler", "role": "nazi_leader"},
        "סרבציוס": {"english": "Dr. Robert Servatius", "role": "defense_attorney"},
        "האוזנר": {"english": "Gideon Hausner", "role": "prosecutor"},
        "גדעון האוזנר": {"english": "Gideon Hausner", "role": "prosecutor"},
        "לנדאו": {"english": "Moshe Landau", "role": "judge"},
    }
    
    for hebrew, info in key_figures.items():
        if hebrew in text:
            entities["KEY_FIGURE"].append({
                "name": info["english"],
                "hebrew_name": hebrew,
                "role": info["role"],
                "mentions": text.count(hebrew)
            })
    
    # Organizations
    org_patterns = [
        (r'הגסטאפו', "Gestapo"),
        (r'הס\.ס\.?|ה?ס\"ס|SS', "SS"),
        (r'הוורמאכט|Wehrmacht', "Wehrmacht"),
        (r'יודנראט', "Judenrat"),
        (r'הצלב האדום', "Red Cross"),
        (r'זונדרקומנדו', "Sonderkommando"),
    ]
    
    for pattern, name in org_patterns:
        matches = list(re.finditer(pattern, text))
        if matches:
            entities["ORGANIZATION"].append({
                "name": name,
                "mentions": len(matches)
            })
    
    return dict(entities)


# =============================================================================
# OpenAI Integration
# =============================================================================

async def extract_entities_ai(
    text: str,
    client: AsyncOpenAI,
    semaphore: asyncio.Semaphore,
    witness_names: List[str]
) -> Dict[str, Any]:
    """
    Use OpenAI for complex entity extraction.
    Only call this for tasks that regex can't handle well.
    """
    async with semaphore:
        try:
            response = await client.chat.completions.create(
                model=MODEL,
                reasoning_effort="low",
                messages=[
                    {
                        "role": "system",
                        "content": f"""You are an expert in the Eichmann trial documents.
Extract entities from this Hebrew trial transcript.

IMPORTANT - Official witness list (only these can be WITNESS type):
{', '.join(witness_names[:20])}... (and {len(witness_names)-20} more)

Return JSON with:
- persons: [{{"name": "...", "hebrewName": "...", "role": "witness|prosecutor|defense|judge|mentioned", "isWitness": true/false}}]
- locations: [{{"name": "...", "category": "camp|ghetto|city|country"}}]
- organizations: [{{"name": "...", "type": "nazi|jewish|other"}}]
- dates: [{{"text": "...", "normalized": "YYYY-MM-DD or description"}}]
- events: [{{"name": "...", "type": "selection|transport|uprising|trial"}}]

Only mark someone as "witness" if they appear in the official witness list."""
                    },
                    {
                        "role": "user",
                        "content": text[:CHUNK_SIZE]
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
                                            "category": {"type": "string"}
                                        },
                                        "required": ["name", "category"],
                                        "additionalProperties": False
                                    }
                                },
                                "organizations": {
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
            
            return json.loads(response.choices[0].message.content)
        
        except Exception as e:
            print(f"  ⚠️ AI extraction error: {e}")
            return {"persons": [], "locations": [], "organizations": [], "dates": [], "events": []}


async def consolidate_entities_ai(
    entities: List[str],
    entity_type: str,
    client: AsyncOpenAI,
    semaphore: asyncio.Semaphore
) -> List[Dict]:
    """
    Use AI to consolidate duplicate entities.
    """
    async with semaphore:
        try:
            response = await client.chat.completions.create(
                model=MODEL,
                reasoning_effort="low",
                messages=[
                    {
                        "role": "system",
                        "content": f"""Consolidate these {entity_type} names, merging duplicates.
For each unique entity, provide:
- canonical: The best English name
- hebrewName: The Hebrew name if applicable
- variants: All spelling variants found

Examples:
- אייכמן, אדולף אייכמן, Eichmann → canonical: "Adolf Eichmann", variants: ["אייכמן", "אדולף אייכמן"]
- ד"ר סרבציוס, סרבציוס → canonical: "Dr. Robert Servatius", variants: ["ד\"ר סרבציוס", "סרבציוס"]

Only merge if clearly the same entity. Do not over-merge."""
                    },
                    {
                        "role": "user",
                        "content": f"Consolidate these {len(entities)} {entity_type} names:\n" + "\n".join(entities)
                    }
                ],
                response_format={
                    "type": "json_schema",
                    "json_schema": {
                        "name": "consolidation",
                        "strict": True,
                        "schema": {
                            "type": "object",
                            "properties": {
                                "entities": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "canonical": {"type": "string"},
                                            "hebrewName": {"type": "string"},
                                            "variants": {"type": "array", "items": {"type": "string"}}
                                        },
                                        "required": ["canonical", "hebrewName", "variants"],
                                        "additionalProperties": False
                                    }
                                }
                            },
                            "required": ["entities"],
                            "additionalProperties": False
                        }
                    }
                }
            )
            
            result = json.loads(response.choices[0].message.content)
            return result.get("entities", [])
        
        except Exception as e:
            print(f"  ⚠️ Consolidation error: {e}")
            return []


async def extract_testimony_ai(
    text: str,
    witness_name: str,
    client: AsyncOpenAI,
    semaphore: asyncio.Semaphore
) -> str:
    """
    Extract formatted testimony for a specific witness.
    """
    async with semaphore:
        try:
            response = await client.chat.completions.create(
                model=MODEL,
                reasoning_effort="medium",
                messages=[
                    {
                        "role": "system",
                        "content": f"""Extract the complete testimony of {witness_name} from this trial transcript.

Format rules:
- Start with witness identification/oath
- Format Q&A as:
  ש: [Question from prosecutor/defense]
  ת: [Answer from witness]
- Include all testimony content
- Note session transitions with --- Session XX ---
- End when testimony concludes (next witness or session end)"""
                    },
                    {
                        "role": "user",
                        "content": text
                    }
                ]
            )
            
            return response.choices[0].message.content
        
        except Exception as e:
            print(f"  ⚠️ Testimony extraction error: {e}")
            return ""


# =============================================================================
# Pipeline Functions
# =============================================================================

async def process_file(
    file_path: Path,
    client: AsyncOpenAI,
    semaphore: asyncio.Semaphore,
    witness_names: List[str],
    use_pdf: bool = False
) -> Dict[str, Any]:
    """
    Process a single file through the hybrid pipeline.
    """
    file_name = file_path.name
    
    # Check cache
    cache_key = f"entities:{file_name}:{cache.file_hash(file_path)}"
    cached = cache.get(cache_key)
    if cached:
        print(f"  📦 Using cached: {file_name}")
        return cached
    
    print(f"  📄 Processing: {file_name}")
    
    # 1. Get text
    if use_pdf and file_path.suffix == '.pdf':
        text, blocks = extract_text_from_pdf(file_path)
    else:
        text = read_ocr_text(file_path)
    
    # 2. Local extraction (FREE, instant)
    local_entities = extract_entities_local(text)
    
    # 3. Chunk text for AI processing
    chunks = [text[i:i+CHUNK_SIZE] for i in range(0, len(text), CHUNK_SIZE)]
    
    # 4. AI extraction for first N chunks only (to reduce cost)
    max_ai_chunks = 10  # Limit AI calls
    ai_results = []
    
    for i, chunk in enumerate(chunks[:max_ai_chunks]):
        result = await extract_entities_ai(chunk, client, semaphore, witness_names)
        ai_results.append(result)
    
    # 5. Merge results
    merged = {
        "file": file_name,
        "local_entities": local_entities,
        "ai_entities": {
            "persons": [],
            "locations": [],
            "organizations": [],
            "dates": [],
            "events": []
        },
        "stats": {
            "text_length": len(text),
            "chunks_processed": len(chunks[:max_ai_chunks]),
            "total_chunks": len(chunks)
        }
    }
    
    for result in ai_results:
        for key in ["persons", "locations", "organizations", "dates", "events"]:
            merged["ai_entities"][key].extend(result.get(key, []))
    
    # Cache results
    cache.set(cache_key, merged)
    
    return merged


async def run_extraction(files: List[Path], use_pdf: bool = False):
    """
    Run extraction pipeline on multiple files.
    """
    print("🚀 Starting extraction pipeline")
    print(f"   Files: {len(files)}")
    print(f"   Mode: {'PDF' if use_pdf else 'OCR'}")
    
    # Load witness index
    witness_names = []
    if WITNESS_INDEX.exists():
        with open(WITNESS_INDEX) as f:
            witness_data = json.load(f)
            witness_names = [w.get("hebrewName", "") for w in witness_data.get("witnesses", [])]
        print(f"   Witnesses: {len(witness_names)} loaded")
    
    # Initialize OpenAI
    client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
    
    # Process files
    results = []
    for file_path in tqdm(files, desc="Processing files"):
        result = await process_file(file_path, client, semaphore, witness_names, use_pdf)
        results.append(result)
    
    # Save results
    output_file = OUTPUT_DIR / "extracted_entities_raw.json"
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump({
            "extracted_at": datetime.now().isoformat(),
            "files_processed": len(results),
            "results": results
        }, f, indent=2, ensure_ascii=False)
    
    print(f"\n✅ Extraction complete: {output_file}")
    return results


async def run_consolidation():
    """
    Consolidate entities across all files.
    """
    print("🔄 Starting entity consolidation")
    
    # Load raw extraction
    raw_file = OUTPUT_DIR / "extracted_entities_raw.json"
    if not raw_file.exists():
        print("❌ Run extraction first!")
        return
    
    with open(raw_file) as f:
        data = json.load(f)
    
    # Collect all entities by type
    all_persons = set()
    all_locations = set()
    all_organizations = set()
    
    for result in data["results"]:
        # From local extraction
        local = result.get("local_entities", {})
        for fig in local.get("KEY_FIGURE", []):
            all_persons.add(fig.get("hebrew_name", ""))
        for loc in local.get("LOCATION", []):
            all_locations.add(loc.get("name", ""))
        for org in local.get("ORGANIZATION", []):
            all_organizations.add(org.get("name", ""))
        
        # From AI extraction
        ai = result.get("ai_entities", {})
        for person in ai.get("persons", []):
            all_persons.add(person.get("hebrewName", ""))
            all_persons.add(person.get("name", ""))
        for loc in ai.get("locations", []):
            all_locations.add(loc.get("name", ""))
        for org in ai.get("organizations", []):
            all_organizations.add(org.get("name", ""))
    
    # Clean up
    all_persons = [p for p in all_persons if p and len(p) > 1]
    all_locations = [l for l in all_locations if l and len(l) > 1]
    all_organizations = [o for o in all_organizations if o and len(o) > 1]
    
    print(f"   Persons: {len(all_persons)}")
    print(f"   Locations: {len(all_locations)}")
    print(f"   Organizations: {len(all_organizations)}")
    
    # Initialize OpenAI
    client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
    
    # Consolidate each type
    consolidated = {
        "persons": await consolidate_entities_ai(all_persons, "PERSON", client, semaphore),
        "locations": await consolidate_entities_ai(all_locations, "LOCATION", client, semaphore),
        "organizations": await consolidate_entities_ai(all_organizations, "ORGANIZATION", client, semaphore)
    }
    
    # Save consolidated
    output_file = OUTPUT_DIR / "entities_consolidated.json"
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump({
            "consolidated_at": datetime.now().isoformat(),
            **consolidated
        }, f, indent=2, ensure_ascii=False)
    
    print(f"\n✅ Consolidation complete: {output_file}")
    return consolidated


# =============================================================================
# Main
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="Eichmann Trial Entity Pipeline")
    parser.add_argument("--mode", choices=["extract", "consolidate", "testimonies", "sessions", "all"],
                       default="all", help="Pipeline mode")
    parser.add_argument("--files", default="test", help="Which files: 'all', 'test', or specific pattern")
    parser.add_argument("--use-pdf", action="store_true", help="Use PDF instead of OCR")
    args = parser.parse_args()
    
    # Select files
    if args.files == "test":
        files = [OCR_DIR / "Vol2_p6575.txt"]
    elif args.files == "all":
        files = list(OCR_DIR.glob("Vol*.txt"))
    else:
        files = list(OCR_DIR.glob(args.files))
    
    print(f"\n{'='*60}")
    print("Eichmann Trial Entity Pipeline")
    print(f"{'='*60}")
    print(f"Mode: {args.mode}")
    print(f"Files: {len(files)}")
    
    # Run pipeline
    if args.mode in ["extract", "all"]:
        asyncio.run(run_extraction(files, args.use_pdf))
    
    if args.mode in ["consolidate", "all"]:
        asyncio.run(run_consolidation())
    
    print("\n✅ Pipeline complete!")


if __name__ == "__main__":
    main()

