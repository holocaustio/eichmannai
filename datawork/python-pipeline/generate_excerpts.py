#!/usr/bin/env python3
"""
Generate testimony excerpts using OpenAI.

Usage:
    python generate_excerpts.py --test "Israel_Carmel"  # Test with specific witness
    python generate_excerpts.py --all                    # Process all testimonies
    python generate_excerpts.py --all --parallel 10      # Process with 10 parallel workers
    python generate_excerpts.py --lang en --all          # Process only English testimonies
"""

import os
import sys
import json
import argparse
import time
from pathlib import Path
from datetime import datetime
from typing import Optional, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed

from openai import OpenAI
from dotenv import load_dotenv
from tqdm import tqdm

# Load environment variables from multiple locations
BASE_DIR_ENV = Path(__file__).parent.parent.parent
load_dotenv(BASE_DIR_ENV / ".env.local")
load_dotenv(BASE_DIR_ENV / "app" / ".env.local")
load_dotenv()  # Also check local .env

# =============================================================================
# Configuration
# =============================================================================

BASE_DIR = Path(__file__).parent.parent.parent
TESTIMONIES_DIR = BASE_DIR / "app" / "public" / "data" / "testimonies"
EN_DIR = TESTIMONIES_DIR / "en"
HE_DIR = TESTIMONIES_DIR / "he"

MODEL = "gpt-5-nano-2025-08-07"
MAX_EXCERPT_LENGTH = 300  # Max words for excerpt

# =============================================================================
# Prompts
# =============================================================================

ENGLISH_PROMPT = """You are a historian summarizing Holocaust survivor testimonies from the Eichmann Trial (1961).

Read the following testimony and create a compelling excerpt (2-3 sentences, maximum {max_words} words) that:
1. Identifies who the witness is and their role/background
2. Highlights the most significant or moving aspects of their testimony
3. Captures the historical importance of what they witnessed

Write in third person, past tense. Be factual but evocative. Do not start with "This testimony" or "In this testimony".

TESTIMONY:
{testimony}

EXCERPT:"""

HEBREW_PROMPT = """אתה היסטוריון המסכם עדויות של ניצולי שואה ממשפט אייכמן (1961).

קרא את העדות הבאה וצור תקציר מרתק (2-3 משפטים, מקסימום {max_words} מילים) אשר:
1. מזהה מי העד ומה הרקע או התפקיד שלו
2. מדגיש את ההיבטים המשמעותיים או המרגשים ביותר בעדותו
3. לוכד את החשיבות ההיסטורית של מה שהעד חזה

כתוב בגוף שלישי, בזמן עבר. היה עובדתי אך מעורר. אל תתחיל ב"עדות זו" או "בעדות זו".

עדות:
{testimony}

תקציר:"""

# =============================================================================
# Functions
# =============================================================================

def read_testimony(file_path: Path) -> str:
    """Read testimony content from a markdown file."""
    with open(file_path, 'r', encoding='utf-8') as f:
        return f.read()


def generate_excerpt(client: OpenAI, testimony: str, lang: str) -> Optional[str]:
    """Generate an excerpt for a testimony using OpenAI."""
    # Truncate very long testimonies to avoid token limits
    max_chars = 6000
    if len(testimony) > max_chars:
        testimony = testimony[:max_chars] + "\n\n[... testimony continues ...]"
    
    prompt = ENGLISH_PROMPT if lang == "en" else HEBREW_PROMPT
    prompt = prompt.format(testimony=testimony, max_words=MAX_EXCERPT_LENGTH)
    
    try:
        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "user", "content": prompt}
            ]
        )
        
        if not response.choices:
            return None
            
        choice = response.choices[0]
        content = choice.message.content
        
        if content:
            return content.strip()
        else:
            return None
    except Exception as e:
        return None


def save_excerpt(excerpt: str, output_path: Path):
    """Save excerpt to a file."""
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(excerpt)


def get_output_path(testimony_path: Path) -> Path:
    """Get the output path for an excerpt file."""
    stem = testimony_path.stem
    return testimony_path.parent / f"{stem}_excerpt.md"


def process_testimony(client: OpenAI, testimony_path: Path, lang: str, force: bool = False) -> dict:
    """Process a single testimony and generate an excerpt."""
    output_path = get_output_path(testimony_path)
    
    # Skip if excerpt already exists (unless force)
    if output_path.exists() and not force:
        return {"status": "skipped", "reason": "excerpt exists", "path": testimony_path}
    
    # Read testimony
    testimony = read_testimony(testimony_path)
    
    # Generate excerpt
    excerpt = generate_excerpt(client, testimony, lang)
    
    if excerpt:
        save_excerpt(excerpt, output_path)
        return {"status": "success", "excerpt": excerpt, "output": str(output_path), "path": testimony_path}
    else:
        return {"status": "failed", "reason": "generation failed", "path": testimony_path}


def process_testimony_wrapper(args: Tuple) -> dict:
    """Wrapper for parallel processing."""
    client, testimony_path, lang, force = args
    return process_testimony(client, testimony_path, lang, force)


def get_all_testimonies(lang: Optional[str] = None) -> list:
    """Get all testimony files."""
    testimonies = []
    
    if lang in (None, "en"):
        testimonies.extend([
            (f, "en") for f in EN_DIR.glob("*.md") 
            if not f.stem.endswith("_excerpt")
        ])
    
    if lang in (None, "he"):
        testimonies.extend([
            (f, "he") for f in HE_DIR.glob("*.md") 
            if not f.stem.endswith("_excerpt")
        ])
    
    return testimonies


# =============================================================================
# Main
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="Generate testimony excerpts using OpenAI")
    parser.add_argument("--test", help="Test with specific witness (filename without .md)")
    parser.add_argument("--all", action="store_true", help="Process all testimonies")
    parser.add_argument("--lang", choices=["en", "he"], help="Process only specific language")
    parser.add_argument("--force", action="store_true", help="Regenerate existing excerpts")
    parser.add_argument("--parallel", type=int, default=1, help="Number of parallel workers (default: 1)")
    parser.add_argument("--delay", type=float, default=0.1, help="Delay between API calls in sequential mode (seconds)")
    args = parser.parse_args()
    
    # Check for API key
    if not os.getenv("OPENAI_API_KEY"):
        print("❌ OPENAI_API_KEY not set in environment")
        sys.exit(1)
    
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
    print(f"\n{'='*60}")
    print("Testimony Excerpt Generator")
    print(f"{'='*60}")
    print(f"Model: {MODEL}")
    print(f"Testimonies dir: {TESTIMONIES_DIR}")
    print(f"Parallel workers: {args.parallel}")
    
    if args.test:
        # Test mode - process single testimony
        witness_name = args.test
        testimonies_to_process = []
        
        en_path = EN_DIR / f"{witness_name}.md"
        he_path = HE_DIR / f"{witness_name}.md"
        
        if en_path.exists():
            testimonies_to_process.append((en_path, "en"))
        if he_path.exists():
            testimonies_to_process.append((he_path, "he"))
        
        if not testimonies_to_process:
            print(f"❌ No testimony found for: {witness_name}")
            print(f"   Checked: {en_path}")
            print(f"   Checked: {he_path}")
            return
        
        print(f"\n🧪 Test mode: Processing {witness_name}")
        
    elif args.all:
        testimonies_to_process = get_all_testimonies(args.lang)
        print(f"\n📚 Processing {len(testimonies_to_process)} testimonies")
        
    else:
        print("❌ Specify --test <witness_name> or --all")
        return
    
    # Process testimonies
    results = {"success": 0, "skipped": 0, "failed": 0}
    start_time = time.time()
    
    if args.parallel > 1:
        # Parallel processing
        print(f"🚀 Running with {args.parallel} parallel workers...")
        
        # Prepare arguments for parallel processing
        process_args = [(client, path, lang, args.force) for path, lang in testimonies_to_process]
        
        with ThreadPoolExecutor(max_workers=args.parallel) as executor:
            futures = {executor.submit(process_testimony_wrapper, arg): arg for arg in process_args}
            
            with tqdm(total=len(futures), desc="Generating excerpts") as pbar:
                for future in as_completed(futures):
                    result = future.result()
                    results[result["status"]] += 1
                    
                    path = result.get("path", Path("unknown"))
                    if result["status"] == "success":
                        tqdm.write(f"✅ {path.name}")
                    elif result["status"] == "failed":
                        tqdm.write(f"❌ {path.name} - {result.get('reason', 'unknown error')}")
                    
                    pbar.update(1)
    else:
        # Sequential processing
        for testimony_path, lang in tqdm(testimonies_to_process, desc="Generating excerpts"):
            result = process_testimony(client, testimony_path, lang, force=args.force)
            results[result["status"]] += 1
            
            if result["status"] == "success":
                tqdm.write(f"✅ {testimony_path.name} ({lang})")
                if args.test:
                    print(f"\n📝 Excerpt:\n{'-'*40}")
                    print(result["excerpt"])
                    print(f"{'-'*40}")
                    print(f"Saved to: {result['output']}")
            elif result["status"] == "skipped":
                if args.test:
                    tqdm.write(f"⏭️  {testimony_path.name} ({lang}) - {result['reason']}")
            else:
                tqdm.write(f"❌ {testimony_path.name} ({lang}) - {result.get('reason', 'unknown error')}")
            
            if len(testimonies_to_process) > 1:
                time.sleep(args.delay)
    
    elapsed = time.time() - start_time
    
    # Summary
    print(f"\n{'='*60}")
    print("Summary")
    print(f"{'='*60}")
    print(f"✅ Success: {results['success']}")
    print(f"⏭️  Skipped: {results['skipped']}")
    print(f"❌ Failed: {results['failed']}")
    print(f"⏱️  Time: {elapsed:.1f}s ({elapsed/max(1, results['success']+results['failed']):.1f}s per testimony)")


if __name__ == "__main__":
    main()
