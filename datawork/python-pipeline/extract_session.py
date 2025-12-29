#!/usr/bin/env python3
"""
Extract session summary and details.

Usage:
    python extract_session.py 65
    python extract_session.py --list  # List all sessions
    python extract_session.py --all   # Extract all sessions
"""

import os
import sys
import json
import asyncio
import argparse
import re
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional

from openai import AsyncOpenAI
from dotenv import load_dotenv
from tqdm import tqdm

load_dotenv()

# =============================================================================
# Configuration
# =============================================================================

BASE_DIR = Path(__file__).parent.parent.parent
OCR_DIR = BASE_DIR / "downloads" / "pdf" / "OCR"
OUTPUT_DIR = BASE_DIR / "eichmann-entities"
ENTITIES_FILE = OUTPUT_DIR / "entities.json"

MODEL = "o4-mini"
MAX_CONCURRENT = 5

# =============================================================================
# Session Detection
# =============================================================================

def find_sessions_in_text(text: str) -> List[Dict]:
    """Find all sessions and their boundaries in text."""
    sessions = []
    pattern = r'ישיבה\s+(?:מס[\'׳]?\s*)?(\d+)'
    
    lines = text.split('\n')
    current_session = None
    session_start_line = 0
    
    for i, line in enumerate(lines):
        match = re.search(pattern, line)
        if match:
            session_num = int(match.group(1))
            
            # Close previous session
            if current_session is not None:
                sessions.append({
                    "number": current_session,
                    "lineStart": session_start_line,
                    "lineEnd": i - 1
                })
            
            current_session = session_num
            session_start_line = i
    
    # Close last session
    if current_session is not None:
        sessions.append({
            "number": current_session,
            "lineStart": session_start_line,
            "lineEnd": len(lines) - 1
        })
    
    # Deduplicate by session number (keep largest range)
    seen = {}
    for s in sessions:
        num = s["number"]
        if num not in seen or (s["lineEnd"] - s["lineStart"]) > (seen[num]["lineEnd"] - seen[num]["lineStart"]):
            seen[num] = s
    
    return sorted(seen.values(), key=lambda x: x["number"])


def get_session_text(text: str, session: Dict, context_lines: int = 50) -> str:
    """Extract text for a specific session with context."""
    lines = text.split('\n')
    start = max(0, session["lineStart"] - context_lines)
    end = min(len(lines), session["lineEnd"] + context_lines)
    return '\n'.join(lines[start:end])


# =============================================================================
# Extraction
# =============================================================================

async def extract_session_summary(
    session_num: int,
    text: str,
    client: AsyncOpenAI,
    semaphore: asyncio.Semaphore
) -> Dict:
    """Extract detailed summary for a session."""
    async with semaphore:
        # Truncate if too long
        max_input = 80000
        if len(text) > max_input:
            text = text[:max_input]
        
        try:
            response = await client.chat.completions.create(
                model=MODEL,
                reasoning_effort="medium",
                messages=[
                    {
                        "role": "system",
                        "content": """You are summarizing a session from the Eichmann trial.

Provide a comprehensive summary including:
1. Session Overview: Date, main topics discussed
2. Witnesses: Who testified in this session
3. Key Testimony: Important revelations or statements
4. Locations Mentioned: Camps, ghettos, cities discussed
5. Documents: Any documents presented as evidence
6. Notable Exchanges: Important Q&A between attorneys and witnesses

Format as structured markdown with these sections."""
                    },
                    {
                        "role": "user",
                        "content": f"Summarize Session {session_num} from this Eichmann trial transcript:\n\n{text}"
                    }
                ]
            )
            
            return {
                "session": session_num,
                "summary": response.choices[0].message.content,
                "extracted_at": datetime.now().isoformat()
            }
        
        except Exception as e:
            print(f"  ❌ Session {session_num} error: {e}")
            return {
                "session": session_num,
                "error": str(e)
            }


async def extract_session_entities(
    session_num: int,
    text: str,
    client: AsyncOpenAI,
    semaphore: asyncio.Semaphore
) -> Dict:
    """Extract entities from a specific session."""
    async with semaphore:
        max_input = 50000
        if len(text) > max_input:
            text = text[:max_input]
        
        try:
            response = await client.chat.completions.create(
                model=MODEL,
                reasoning_effort="low",
                messages=[
                    {
                        "role": "system",
                        "content": """Extract entities from this Eichmann trial session.

Return JSON with:
- witnesses: [{name, hebrewName}] - People who testified
- locations: [{name, type}] - Places mentioned (camps, cities, countries)
- organizations: [{name}] - Organizations mentioned
- dates: [{text, context}] - Dates mentioned with context
- topics: [string] - Main topics/themes discussed
- documents: [{id, description}] - Documents presented as evidence"""
                    },
                    {
                        "role": "user",
                        "content": f"Extract entities from Session {session_num}:\n\n{text}"
                    }
                ],
                response_format={
                    "type": "json_schema",
                    "json_schema": {
                        "name": "session_entities",
                        "strict": True,
                        "schema": {
                            "type": "object",
                            "properties": {
                                "witnesses": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "name": {"type": "string"},
                                            "hebrewName": {"type": "string"}
                                        },
                                        "required": ["name", "hebrewName"],
                                        "additionalProperties": False
                                    }
                                },
                                "locations": {
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
                                "organizations": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "name": {"type": "string"}
                                        },
                                        "required": ["name"],
                                        "additionalProperties": False
                                    }
                                },
                                "dates": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "text": {"type": "string"},
                                            "context": {"type": "string"}
                                        },
                                        "required": ["text", "context"],
                                        "additionalProperties": False
                                    }
                                },
                                "topics": {
                                    "type": "array",
                                    "items": {"type": "string"}
                                },
                                "documents": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "id": {"type": "string"},
                                            "description": {"type": "string"}
                                        },
                                        "required": ["id", "description"],
                                        "additionalProperties": False
                                    }
                                }
                            },
                            "required": ["witnesses", "locations", "organizations", "dates", "topics", "documents"],
                            "additionalProperties": False
                        }
                    }
                }
            )
            
            entities = json.loads(response.choices[0].message.content)
            return {
                "session": session_num,
                "entities": entities,
                "extracted_at": datetime.now().isoformat()
            }
        
        except Exception as e:
            print(f"  ❌ Session {session_num} entities error: {e}")
            return {
                "session": session_num,
                "error": str(e)
            }


async def main():
    parser = argparse.ArgumentParser(description="Extract session details")
    parser.add_argument("session", nargs="?", type=int, help="Session number")
    parser.add_argument("--list", action="store_true", help="List available sessions")
    parser.add_argument("--all", action="store_true", help="Extract all sessions")
    parser.add_argument("--entities", action="store_true", help="Extract entities instead of summary")
    parser.add_argument("--file", help="Specific OCR file to search")
    args = parser.parse_args()
    
    # Get OCR file
    if args.file:
        ocr_file = OCR_DIR / args.file
    else:
        ocr_file = OUTPUT_DIR / "test-file.txt"
        if not ocr_file.exists():
            ocr_file = OCR_DIR / "Vol2_p6575.txt"
    
    if not ocr_file.exists():
        print(f"❌ File not found: {ocr_file}")
        return
    
    print(f"📄 Reading: {ocr_file.name}")
    text = ocr_file.read_text(encoding='utf-8')
    print(f"   {len(text):,} characters")
    
    # Find sessions
    sessions = find_sessions_in_text(text)
    print(f"   Found {len(sessions)} sessions")
    
    # List mode
    if args.list:
        print("\n📋 Sessions in file:")
        print("-" * 50)
        for s in sessions:
            lines = s["lineEnd"] - s["lineStart"]
            print(f"   Session {s['number']:3}: lines {s['lineStart']:6}-{s['lineEnd']:6} ({lines:,} lines)")
        return
    
    # Initialize OpenAI
    client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    
    # Single session mode
    if args.session:
        session = next((s for s in sessions if s["number"] == args.session), None)
        if not session:
            print(f"❌ Session {args.session} not found")
            print(f"   Available: {[s['number'] for s in sessions]}")
            return
        
        print(f"\n🔄 Extracting Session {args.session}...")
        session_text = get_session_text(text, session)
        print(f"   {len(session_text):,} characters")
        
        start_time = datetime.now()
        
        if args.entities:
            result = await extract_session_entities(args.session, session_text, client, semaphore)
            output_file = OUTPUT_DIR / f"session-{args.session}-entities.json"
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
        else:
            result = await extract_session_summary(args.session, session_text, client, semaphore)
            output_file = OUTPUT_DIR / f"session-{args.session}-summary.md"
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(f"# Session {args.session} Summary\n\n")
                f.write(result.get("summary", ""))
        
        elapsed = (datetime.now() - start_time).total_seconds()
        print(f"   ⏱️ Took {elapsed:.1f}s")
        print(f"✅ Saved to: {output_file}")
        
        # Preview
        if not args.entities:
            print(f"\n📝 Preview:")
            print("-" * 50)
            print(result.get("summary", "")[:800])
            print("...")
        return
    
    # All sessions mode
    if args.all:
        print(f"\n🔄 Extracting all {len(sessions)} sessions...")
        start_time = datetime.now()
        
        results = []
        for session in tqdm(sessions, desc="Sessions"):
            session_text = get_session_text(text, session)
            
            if args.entities:
                result = await extract_session_entities(session["number"], session_text, client, semaphore)
            else:
                result = await extract_session_summary(session["number"], session_text, client, semaphore)
            
            results.append(result)
        
        elapsed = (datetime.now() - start_time).total_seconds()
        
        # Save all
        if args.entities:
            output_file = OUTPUT_DIR / "all-sessions-entities.json"
        else:
            output_file = OUTPUT_DIR / "all-sessions-summaries.json"
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump({
                "source": ocr_file.name,
                "extracted_at": datetime.now().isoformat(),
                "total_sessions": len(sessions),
                "elapsed_seconds": elapsed,
                "sessions": results
            }, f, indent=2, ensure_ascii=False)
        
        print(f"\n✅ Extracted {len(sessions)} sessions in {elapsed:.1f}s")
        print(f"   Saved to: {output_file}")
        return
    
    print("❌ Please provide a session number, --list, or --all")


if __name__ == "__main__":
    asyncio.run(main())

