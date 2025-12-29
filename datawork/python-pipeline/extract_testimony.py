#!/usr/bin/env python3
"""
Extract complete testimony for a specific witness.

Usage:
    python extract_testimony.py "Moshe Bahir"
    python extract_testimony.py "משה בהיר"
    python extract_testimony.py --list  # List all witnesses
"""

import os
import sys
import json
import asyncio
import argparse
from pathlib import Path
from datetime import datetime

from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()

# =============================================================================
# Configuration
# =============================================================================

BASE_DIR = Path(__file__).parent.parent.parent
OCR_DIR = BASE_DIR / "downloads" / "pdf" / "OCR"
OUTPUT_DIR = BASE_DIR / "eichmann-entities"
ENTITIES_FILE = OUTPUT_DIR / "entities.json"
WITNESS_INDEX = OUTPUT_DIR / "witness-index.json"

MODEL = "o4-mini"

# =============================================================================
# Load Data
# =============================================================================

def load_witness_index() -> dict:
    """Load official witness index."""
    if WITNESS_INDEX.exists():
        with open(WITNESS_INDEX) as f:
            data = json.load(f)
        # Normalize keys
        witnesses = []
        for w in data.get("witnesses", []):
            witnesses.append({
                "hebrewName": w.get("hebrew", w.get("hebrewName", "")),
                "englishName": w.get("english", w.get("englishName", ""))
            })
        return {"witnesses": witnesses}
    return {"witnesses": []}


def load_entities() -> dict:
    """Load extracted entities."""
    if ENTITIES_FILE.exists():
        with open(ENTITIES_FILE) as f:
            return json.load(f)
    return {"nodes": [], "sessions": []}


def find_witness(name: str, witness_index: dict, entities: dict) -> dict:
    """Find a witness by name (English or Hebrew)."""
    name_lower = name.lower()
    
    # Search in witness index first
    for w in witness_index.get("witnesses", []):
        if (name_lower in w.get("hebrewName", "").lower() or 
            name_lower in w.get("englishName", "").lower()):
            return w
    
    # Search in extracted entities
    for node in entities.get("nodes", []):
        if node.get("type") == "PERSON" and node.get("isWitness"):
            if (name_lower in node.get("name", "").lower() or
                name_lower in node.get("hebrewName", "").lower() or
                any(name_lower in v.lower() for v in node.get("variants", []))):
                return {
                    "englishName": node.get("name"),
                    "hebrewName": node.get("hebrewName"),
                    "sessions": node.get("sessions", [])
                }
    
    return None


def get_witness_text_ranges(witness: dict, entities: dict) -> list:
    """Get text ranges where witness appears."""
    witness_name = witness.get("englishName", "")
    hebrew_name = witness.get("hebrewName", "")
    
    ranges = []
    for node in entities.get("nodes", []):
        if node.get("name") == witness_name or node.get("hebrewName") == hebrew_name:
            for source in node.get("sources", []):
                ranges.append({
                    "file": source.get("file"),
                    "lineStart": source.get("lineStart"),
                    "lineEnd": source.get("lineEnd"),
                    "session": source.get("session")
                })
    
    return ranges


# =============================================================================
# Extraction
# =============================================================================

async def extract_testimony(witness_name: str, hebrew_name: str, text: str) -> str:
    """Extract and format testimony using AI."""
    client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
    # Split into manageable chunks if text is very long
    max_input = 100000  # ~25k tokens
    if len(text) > max_input:
        text = text[:max_input]
        print(f"  ⚠️ Text truncated to {max_input:,} characters")
    
    try:
        response = await client.chat.completions.create(
            model=MODEL,
            reasoning_effort="medium",
            messages=[
                {
                    "role": "system",
                    "content": f"""You are extracting the complete testimony of {witness_name} ({hebrew_name}) from the Eichmann trial transcripts.

Format the testimony as follows:
1. Start with witness identification (name, oath)
2. Format Q&A exchanges:
   ש: [Question from prosecutor/defense attorney]
   ת: [Answer from witness]
3. Include context about who is asking (היועץ המשפטי, ד"ר סרבציוס, etc.)
4. Mark session transitions with: --- ישיבה XX ---
5. Include the complete testimony, not summaries
6. End when the witness's testimony concludes

Extract ALL the testimony text for this witness. Do not summarize."""
                },
                {
                    "role": "user",
                    "content": f"Extract the complete testimony of {witness_name} ({hebrew_name}) from this trial transcript:\n\n{text}"
                }
            ]
        )
        
        return response.choices[0].message.content
    
    except Exception as e:
        print(f"  ❌ Extraction error: {e}")
        return ""


async def main():
    parser = argparse.ArgumentParser(description="Extract witness testimony")
    parser.add_argument("witness", nargs="?", help="Witness name (English or Hebrew)")
    parser.add_argument("--list", action="store_true", help="List available witnesses")
    parser.add_argument("--file", help="Specific OCR file to search")
    parser.add_argument("--output", help="Output file path")
    args = parser.parse_args()
    
    # Load data
    witness_index = load_witness_index()
    entities = load_entities()
    
    # List mode
    if args.list:
        print("\n📋 Official Witnesses (108):")
        print("-" * 50)
        for i, w in enumerate(witness_index.get("witnesses", [])[:20], 1):
            print(f"  {i:3}. {w.get('englishName', 'N/A'):30} | {w.get('hebrewName', '')}")
        if len(witness_index.get("witnesses", [])) > 20:
            print(f"  ... and {len(witness_index.get('witnesses', [])) - 20} more")
        
        print("\n📋 Extracted Witnesses from entities.json:")
        print("-" * 50)
        witness_nodes = [n for n in entities.get("nodes", []) if n.get("isWitness")]
        for i, w in enumerate(witness_nodes[:20], 1):
            print(f"  {i:3}. {w.get('name', 'N/A'):30} | {w.get('hebrewName', '')}")
        if len(witness_nodes) > 20:
            print(f"  ... and {len(witness_nodes) - 20} more")
        return
    
    if not args.witness:
        print("❌ Please provide a witness name or use --list")
        return
    
    # Find witness
    print(f"\n🔍 Searching for: {args.witness}")
    witness = find_witness(args.witness, witness_index, entities)
    
    if not witness:
        print(f"❌ Witness not found: {args.witness}")
        print("   Use --list to see available witnesses")
        return
    
    print(f"✅ Found: {witness.get('englishName')} ({witness.get('hebrewName')})")
    
    # Get text
    if args.file:
        ocr_file = OCR_DIR / args.file
    else:
        # Use test file or find from entities
        ocr_file = OUTPUT_DIR / "test-file.txt"
        if not ocr_file.exists():
            ocr_file = OCR_DIR / "Vol2_p6575.txt"
    
    if not ocr_file.exists():
        print(f"❌ OCR file not found: {ocr_file}")
        return
    
    print(f"📄 Reading: {ocr_file.name}")
    text = ocr_file.read_text(encoding='utf-8')
    print(f"   {len(text):,} characters")
    
    # Extract testimony
    print(f"\n🔄 Extracting testimony...")
    start_time = datetime.now()
    
    testimony = await extract_testimony(
        witness.get("englishName", args.witness),
        witness.get("hebrewName", ""),
        text
    )
    
    elapsed = (datetime.now() - start_time).total_seconds()
    print(f"   ⏱️ Extraction took {elapsed:.1f}s")
    
    if not testimony:
        print("❌ No testimony extracted")
        return
    
    # Save
    output_file = args.output or OUTPUT_DIR / f"testimony-{witness.get('englishName', args.witness).replace(' ', '-')}.txt"
    output_file = Path(output_file)
    
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(f"# Testimony of {witness.get('englishName')} ({witness.get('hebrewName')})\n")
        f.write(f"# Extracted: {datetime.now().isoformat()}\n")
        f.write(f"# Source: {ocr_file.name}\n\n")
        f.write(testimony)
    
    print(f"\n✅ Saved to: {output_file}")
    print(f"   {len(testimony):,} characters")
    
    # Preview
    print(f"\n📝 Preview (first 500 chars):")
    print("-" * 50)
    print(testimony[:500])
    print("...")


if __name__ == "__main__":
    asyncio.run(main())

