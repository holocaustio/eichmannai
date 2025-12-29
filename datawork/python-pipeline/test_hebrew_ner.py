#!/usr/bin/env python3
"""
Test Hebrew NER models for entity extraction.

Models tested:
1. DictaBERT NER (dicta-il/dictabert-ner) - Recommended for Modern Hebrew
2. HebSpaCy (he_ner_news_trf) - SpaCy-compatible transformer NER
3. EHRI Holocaust NER (ehri/ehri-ner) - Multilingual, Holocaust-trained

Usage:
    python test_hebrew_ner.py --model dictabert
    python test_hebrew_ner.py --model hebspacy
    python test_hebrew_ner.py --compare
"""

import os
import sys
import json
import time
import re
import argparse
from pathlib import Path
from collections import defaultdict, Counter
from typing import List, Dict, Tuple, Any

# =============================================================================
# Configuration
# =============================================================================

BASE_DIR = Path(__file__).parent.parent.parent
OCR_DIR = BASE_DIR / "downloads" / "pdf" / "OCR"
OUTPUT_DIR = BASE_DIR / "eichmann-entities"
TEST_FILE = OUTPUT_DIR / "test-file.txt"

# Sample text for quick testing
SAMPLE_TEXT = """
ישיבה מס' 65 - כ"א בסיון תשכ"א (5 ביוני 1961)
אב בית הדין: השופט משה לנדאו
היועץ המשפטי: מר גדעון האוזנר
סניגור: ד"ר רוברט סרבציוס

העד משה בהיר מעיד על מה שראה במחנה חלמנו.
הוא תיאר את ההשמדה ההמונית בסוביבור וטרבלינקה.
אדולף אייכמן ישב בשקט בזמן העדות.
העד סיפר על הטרנספורטים מוורשה ולודז'.
"""

# =============================================================================
# Text Normalization for Hebrew
# =============================================================================

def normalize_hebrew_text(text: str) -> str:
    """
    Normalize Hebrew text for better NER performance.
    - Fix common OCR issues
    - Normalize quotes and punctuation
    - Handle hyphenation
    """
    # Normalize different quote styles
    text = text.replace('״', '"').replace('׳', "'")
    text = text.replace('"', '"').replace('"', '"')
    text = text.replace(''', "'").replace(''', "'")
    
    # Normalize Hebrew geresh/gershayim
    text = re.sub(r'(\w)\'(\w)', r'\1׳\2', text)
    
    # Fix common OCR issues
    text = text.replace('וו', 'ו')  # Double vav
    
    # Remove extra whitespace
    text = re.sub(r'\s+', ' ', text)
    
    return text.strip()


def canonicalize_name(name: str) -> str:
    """
    Canonicalize a Hebrew name by removing titles and normalizing.
    """
    # Remove common titles
    titles = [
        r'^ד["\״׳\']ר\s+',  # Dr.
        r'^דר\s+',
        r'^פרופ[\'׳]?\s+',  # Prof.
        r'^מר\s+',  # Mr.
        r'^גב[\'׳]?\s+',  # Mrs.
        r'^העד\s+',  # The witness
        r'^העדה\s+',
        r'^השופט\s+',  # The judge
    ]
    
    result = name
    for pattern in titles:
        result = re.sub(pattern, '', result, flags=re.IGNORECASE)
    
    return result.strip()


# =============================================================================
# DictaBERT NER
# =============================================================================

def test_dictabert(text: str, verbose: bool = True) -> Tuple[Dict[str, List[str]], float]:
    """
    Test DictaBERT NER model.
    """
    try:
        from transformers import pipeline
    except ImportError:
        print("❌ transformers not installed. Run: pip install transformers torch")
        return {}, 0
    
    if verbose:
        print("\n📦 Loading DictaBERT NER model...")
    
    start = time.time()
    
    try:
        ner = pipeline(
            "ner",
            model="dicta-il/dictabert-ner",
            aggregation_strategy="simple",
        )
        load_time = time.time() - start
        if verbose:
            print(f"   Model loaded in {load_time:.1f}s")
    except Exception as e:
        print(f"❌ Error loading model: {e}")
        return {}, 0
    
    # Process text in chunks (model has token limits)
    if verbose:
        print("   Processing text...")
    
    start = time.time()
    
    # Split into manageable chunks
    max_chars = 512 * 4  # Rough estimate of 512 tokens
    chunks = [text[i:i+max_chars] for i in range(0, len(text), max_chars)]
    
    entities = defaultdict(list)
    all_results = []
    
    for chunk in chunks:
        try:
            results = ner(chunk)
            all_results.extend(results)
        except Exception as e:
            if verbose:
                print(f"   ⚠️ Chunk error: {e}")
    
    process_time = time.time() - start
    
    # Group by entity type
    for r in all_results:
        entity_type = r.get("entity_group", "UNKNOWN")
        word = r.get("word", "").strip()
        score = r.get("score", 0)
        
        if word and score > 0.5:  # Filter low confidence
            entities[entity_type].append({
                "text": word,
                "score": round(score, 3)
            })
    
    # Deduplicate
    unique_entities = {}
    for etype, elist in entities.items():
        seen = set()
        unique = []
        for e in elist:
            canonical = canonicalize_name(e["text"])
            if canonical not in seen:
                seen.add(canonical)
                unique.append(e)
        unique_entities[etype] = unique
    
    if verbose:
        print(f"   ⏱️ Processed in {process_time:.2f}s")
        print(f"\n   Results:")
        for etype, elist in unique_entities.items():
            print(f"   {etype}: {len(elist)} entities")
            for e in elist[:5]:
                print(f"      - {e['text']} ({e['score']:.2f})")
            if len(elist) > 5:
                print(f"      ... and {len(elist)-5} more")
    
    return unique_entities, process_time


# =============================================================================
# HebSpaCy NER
# =============================================================================

def test_hebspacy(text: str, verbose: bool = True) -> Tuple[Dict[str, List[str]], float]:
    """
    Test HebSpaCy NER model.
    """
    try:
        import spacy
    except ImportError:
        print("❌ spaCy not installed. Run: pip install spacy")
        return {}, 0
    
    if verbose:
        print("\n📦 Loading HebSpaCy NER model...")
    
    start = time.time()
    
    # Try to load the Hebrew transformer model
    try:
        # First try the transformer model
        nlp = spacy.load("he_ner_news_trf")
        model_name = "he_ner_news_trf"
    except OSError:
        try:
            # Fallback to smaller model
            nlp = spacy.load("he_core_news_sm")
            model_name = "he_core_news_sm"
        except OSError:
            print("❌ No Hebrew spaCy model found.")
            print("   Install with: pip install hebspacy")
            print("   Then: python -m spacy download he_ner_news_trf")
            return {}, 0
    
    load_time = time.time() - start
    if verbose:
        print(f"   Model '{model_name}' loaded in {load_time:.1f}s")
    
    # Process text
    if verbose:
        print("   Processing text...")
    
    start = time.time()
    
    # Process in chunks to avoid memory issues
    max_chars = 100000
    chunks = [text[i:i+max_chars] for i in range(0, len(text), max_chars)]
    
    entities = defaultdict(list)
    
    for chunk in chunks:
        try:
            doc = nlp(chunk)
            for ent in doc.ents:
                if len(ent.text.strip()) > 1:
                    entities[ent.label_].append({
                        "text": ent.text.strip(),
                        "score": 1.0  # spaCy doesn't provide scores
                    })
        except Exception as e:
            if verbose:
                print(f"   ⚠️ Chunk error: {e}")
    
    process_time = time.time() - start
    
    # Deduplicate
    unique_entities = {}
    for etype, elist in entities.items():
        seen = set()
        unique = []
        for e in elist:
            canonical = canonicalize_name(e["text"])
            if canonical not in seen:
                seen.add(canonical)
                unique.append(e)
        unique_entities[etype] = unique
    
    if verbose:
        print(f"   ⏱️ Processed in {process_time:.2f}s")
        print(f"\n   Results:")
        for etype, elist in unique_entities.items():
            print(f"   {etype}: {len(elist)} entities")
            for e in elist[:5]:
                print(f"      - {e['text']}")
            if len(elist) > 5:
                print(f"      ... and {len(elist)-5} more")
    
    return unique_entities, process_time


# =============================================================================
# EHRI Holocaust NER (Multilingual)
# =============================================================================

def test_ehri_ner(text: str, verbose: bool = True) -> Tuple[Dict[str, List[str]], float]:
    """
    Test EHRI Holocaust NER model (multilingual).
    """
    try:
        from transformers import pipeline
    except ImportError:
        print("❌ transformers not installed. Run: pip install transformers torch")
        return {}, 0
    
    if verbose:
        print("\n📦 Loading EHRI Holocaust NER model...")
    
    start = time.time()
    
    try:
        ner = pipeline(
            "ner",
            model="ehri/ehri-ner",
            aggregation_strategy="simple",
        )
        load_time = time.time() - start
        if verbose:
            print(f"   Model loaded in {load_time:.1f}s")
    except Exception as e:
        print(f"❌ Error loading model: {e}")
        return {}, 0
    
    # Process text
    if verbose:
        print("   Processing text...")
    
    start = time.time()
    
    max_chars = 512 * 4
    chunks = [text[i:i+max_chars] for i in range(0, len(text), max_chars)]
    
    entities = defaultdict(list)
    
    for chunk in chunks:
        try:
            results = ner(chunk)
            for r in results:
                entity_type = r.get("entity_group", "UNKNOWN")
                word = r.get("word", "").strip()
                score = r.get("score", 0)
                
                if word and score > 0.5:
                    entities[entity_type].append({
                        "text": word,
                        "score": round(score, 3)
                    })
        except Exception as e:
            if verbose:
                print(f"   ⚠️ Chunk error: {e}")
    
    process_time = time.time() - start
    
    # Deduplicate
    unique_entities = {}
    for etype, elist in entities.items():
        seen = set()
        unique = []
        for e in elist:
            if e["text"] not in seen:
                seen.add(e["text"])
                unique.append(e)
        unique_entities[etype] = unique
    
    if verbose:
        print(f"   ⏱️ Processed in {process_time:.2f}s")
        print(f"\n   Results:")
        for etype, elist in unique_entities.items():
            print(f"   {etype}: {len(elist)} entities")
            for e in elist[:5]:
                print(f"      - {e['text']} ({e['score']:.2f})")
            if len(elist) > 5:
                print(f"      ... and {len(elist)-5} more")
    
    return unique_entities, process_time


# =============================================================================
# Comparison
# =============================================================================

def compare_models(text: str):
    """
    Compare all available NER models on the same text.
    """
    print("=" * 60)
    print("Hebrew NER Model Comparison")
    print("=" * 60)
    print(f"Text length: {len(text):,} characters")
    
    results = {}
    
    # Test DictaBERT
    print("\n" + "-" * 40)
    print("1. DictaBERT NER (dicta-il/dictabert-ner)")
    print("-" * 40)
    dictabert_entities, dictabert_time = test_dictabert(text)
    results["dictabert"] = {
        "entities": dictabert_entities,
        "time": dictabert_time
    }
    
    # Test HebSpaCy (if available)
    print("\n" + "-" * 40)
    print("2. HebSpaCy NER")
    print("-" * 40)
    hebspacy_entities, hebspacy_time = test_hebspacy(text)
    results["hebspacy"] = {
        "entities": hebspacy_entities,
        "time": hebspacy_time
    }
    
    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    
    for model, data in results.items():
        total_entities = sum(len(v) for v in data["entities"].values())
        print(f"\n{model}:")
        print(f"  Time: {data['time']:.2f}s")
        print(f"  Total entities: {total_entities}")
        for etype, elist in data["entities"].items():
            print(f"    {etype}: {len(elist)}")
    
    # Save comparison
    output_file = Path(__file__).parent / "ner_comparison.json"
    
    # Convert to serializable format
    serializable = {}
    for model, data in results.items():
        serializable[model] = {
            "time_seconds": data["time"],
            "entities": {
                etype: [e["text"] for e in elist]
                for etype, elist in data["entities"].items()
            }
        }
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(serializable, f, indent=2, ensure_ascii=False)
    
    print(f"\n📁 Saved comparison to: {output_file}")


# =============================================================================
# Main
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="Test Hebrew NER models")
    parser.add_argument("--model", choices=["dictabert", "hebspacy", "ehri"], 
                       default="dictabert", help="Model to test")
    parser.add_argument("--compare", action="store_true", help="Compare all models")
    parser.add_argument("--sample", action="store_true", help="Use sample text instead of file")
    parser.add_argument("--file", help="OCR file to process")
    args = parser.parse_args()
    
    # Get text
    if args.sample:
        text = SAMPLE_TEXT
        print(f"Using sample text ({len(text)} chars)")
    elif args.file:
        file_path = OCR_DIR / args.file
        if not file_path.exists():
            print(f"❌ File not found: {file_path}")
            return
        text = file_path.read_text(encoding='utf-8')
        print(f"Using file: {args.file} ({len(text):,} chars)")
    else:
        if TEST_FILE.exists():
            text = TEST_FILE.read_text(encoding='utf-8')
            print(f"Using test file ({len(text):,} chars)")
        else:
            text = SAMPLE_TEXT
            print(f"Using sample text ({len(text)} chars)")
    
    # Normalize
    text = normalize_hebrew_text(text)
    
    # Run tests
    if args.compare:
        compare_models(text)
    elif args.model == "dictabert":
        test_dictabert(text)
    elif args.model == "hebspacy":
        test_hebspacy(text)
    elif args.model == "ehri":
        test_ehri_ner(text)


if __name__ == "__main__":
    main()

