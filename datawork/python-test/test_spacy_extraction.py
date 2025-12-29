#!/usr/bin/env python3
"""
Test script to compare spaCy local NER vs OpenAI API extraction.
Goal: See how much entity extraction we can do locally before using AI.
"""

import os
import sys
import json
import time
from pathlib import Path
from collections import defaultdict, Counter
from typing import List, Dict, Tuple, Any

# PDF Processing
try:
    import pdfplumber
    HAS_PDFPLUMBER = True
except ImportError:
    HAS_PDFPLUMBER = False
    print("⚠️  pdfplumber not installed. Run: pip install pdfplumber")

try:
    import fitz  # PyMuPDF
    HAS_PYMUPDF = True
except ImportError:
    HAS_PYMUPDF = False
    print("⚠️  PyMuPDF not installed. Run: pip install pymupdf")

# NLP
try:
    import spacy
    HAS_SPACY = True
except ImportError:
    HAS_SPACY = False
    print("⚠️  spaCy not installed. Run: pip install spacy")

# Progress
try:
    from tqdm import tqdm
except ImportError:
    def tqdm(x, **kwargs):
        return x

# =============================================================================
# Configuration
# =============================================================================

BASE_DIR = Path(__file__).parent.parent.parent
PDF_DIR = BASE_DIR / "downloads" / "pdf" / "filestoprocess"
OCR_DIR = BASE_DIR / "downloads" / "pdf" / "OCR"
ENTITIES_DIR = BASE_DIR / "eichmann-entities"

# Test files
TEST_PDF = PDF_DIR / "Vol2_p6575.pdf"
TEST_OCR = OCR_DIR / "Vol2_p6575.txt"
TEST_ENTITIES = ENTITIES_DIR / "entities.json"

# =============================================================================
# PDF Text Extraction
# =============================================================================

def extract_text_pdfplumber(pdf_path: Path) -> Tuple[str, float]:
    """Extract text using pdfplumber (good for tables and complex layouts)."""
    if not HAS_PDFPLUMBER:
        return "", 0
    
    start = time.time()
    text_parts = []
    
    with pdfplumber.open(pdf_path) as pdf:
        for page in tqdm(pdf.pages, desc="pdfplumber"):
            text = page.extract_text()
            if text:
                text_parts.append(text)
    
    elapsed = time.time() - start
    return "\n\n".join(text_parts), elapsed


def extract_text_pymupdf(pdf_path: Path) -> Tuple[str, float]:
    """Extract text using PyMuPDF (faster, good for simple layouts)."""
    if not HAS_PYMUPDF:
        return "", 0
    
    start = time.time()
    text_parts = []
    
    doc = fitz.open(pdf_path)
    for page in tqdm(doc, desc="PyMuPDF"):
        text = page.get_text()
        if text:
            text_parts.append(text)
    doc.close()
    
    elapsed = time.time() - start
    return "\n\n".join(text_parts), elapsed


def extract_text_pymupdf_blocks(pdf_path: Path) -> Tuple[str, float, List[Dict]]:
    """Extract text with layout info using PyMuPDF blocks."""
    if not HAS_PYMUPDF:
        return "", 0, []
    
    start = time.time()
    all_blocks = []
    
    doc = fitz.open(pdf_path)
    for page_num, page in enumerate(tqdm(doc, desc="PyMuPDF blocks")):
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
    
    # Sort blocks: by page, then by column (x position), then by y
    # This helps with two-column layouts
    page_width = 612  # Approximate A4 width in points
    mid_x = page_width / 2
    
    def sort_key(b):
        column = 0 if b["x0"] < mid_x else 1
        return (b["page"], column, b["y0"])
    
    all_blocks.sort(key=sort_key)
    
    text = "\n\n".join(b["text"] for b in all_blocks)
    elapsed = time.time() - start
    
    return text, elapsed, all_blocks


# =============================================================================
# spaCy NER Extraction
# =============================================================================

def load_spacy_model():
    """Load Hebrew spaCy model."""
    if not HAS_SPACY:
        return None
    
    # Try Hebrew models in order of preference
    models = ["he_core_news_lg", "he_core_news_md", "he_core_news_sm"]
    
    for model_name in models:
        try:
            nlp = spacy.load(model_name)
            print(f"✅ Loaded spaCy model: {model_name}")
            return nlp
        except OSError:
            continue
    
    print("⚠️  No Hebrew spaCy model found.")
    print("   Install with: python -m spacy download he_core_news_lg")
    return None


def extract_entities_spacy(text: str, nlp) -> Tuple[Dict[str, List[str]], float]:
    """Extract entities using spaCy."""
    if nlp is None:
        return {}, 0
    
    start = time.time()
    
    # Process in chunks to avoid memory issues
    max_length = 100000
    chunks = [text[i:i+max_length] for i in range(0, len(text), max_length)]
    
    entities_by_type = defaultdict(set)
    
    for chunk in tqdm(chunks, desc="spaCy NER"):
        doc = nlp(chunk)
        for ent in doc.ents:
            if len(ent.text.strip()) > 1:  # Skip single chars
                entities_by_type[ent.label_].add(ent.text.strip())
    
    # Convert sets to sorted lists
    result = {k: sorted(list(v)) for k, v in entities_by_type.items()}
    elapsed = time.time() - start
    
    return result, elapsed


def extract_entities_regex(text: str) -> Tuple[Dict[str, List[str]], float]:
    """Extract entities using regex patterns (fast, no ML needed)."""
    import re
    
    start = time.time()
    entities = defaultdict(set)
    
    # Session patterns
    session_pattern = r'ישיבה\s+(?:מס[\'׳]?\s*)?(\d+)'
    for match in re.finditer(session_pattern, text):
        entities["SESSION"].add(f"ישיבה {match.group(1)}")
    
    # Witness patterns (Hebrew)
    witness_patterns = [
        r'עדותו\s+של\s+([^\n,]+)',
        r'העד\s+([א-ת"״\-\s]+)',
        r'העדה\s+([א-ת"״\-\s]+)',
        r'מר\s+([א-ת"״\-\s]+)',
        r'גב[\'׳]\s+([א-ת"״\-\s]+)',
        r'ד["\״]ר\s+([א-ת"״\-\s]+)',
        r'פרופ[\'׳]?\s+([א-ת"״\-\s]+)',
    ]
    
    for pattern in witness_patterns:
        for match in re.finditer(pattern, text):
            name = match.group(1).strip()
            if len(name) > 2 and len(name) < 50:
                entities["PERSON_CANDIDATE"].add(name)
    
    # Location patterns (common Holocaust locations)
    locations = [
        "אושוויץ", "בירקנאו", "טרבלינקה", "סוביבור", "מיידנק",
        "חלמנו", "בלזץ", "ורשה", "לודז", "קראקוב", "לובלין",
        "ווילנה", "קובנו", "מינסק", "ריגה", "בודפשט", "ברלין",
        "וינה", "פראג", "אמסטרדם", "פריז", "סלוניקי", "רומא",
        "ירושלים", "תל אביב", "חיפה", "ישראל", "גרמניה", "פולין",
    ]
    
    for loc in locations:
        if loc in text:
            entities["LOCATION"].add(loc)
    
    # Organization patterns
    orgs = [
        r'(הגסטאפו)',
        r'(ה?ס\.ס\.?)',
        r'(הנאצים)',
        r'(הוורמאכט)',
        r'(המשטרה הגרמנית)',
        r'(יודנראט)',
        r'(הצלב האדום)',
    ]
    
    for pattern in orgs:
        for match in re.finditer(pattern, text):
            entities["ORGANIZATION"].add(match.group(1))
    
    # Key figures (known names)
    key_figures = [
        "אייכמן", "אדולף אייכמן", "הימלר", "היידריך", "גרינג",
        "היטלר", "סרבציוס", "הויסנר", "גדעון האוזנר",
    ]
    
    for name in key_figures:
        if name in text:
            entities["KEY_FIGURE"].add(name)
    
    result = {k: sorted(list(v)) for k, v in entities.items()}
    elapsed = time.time() - start
    
    return result, elapsed


# =============================================================================
# Comparison with existing entities
# =============================================================================

def load_existing_entities(entities_path: Path) -> Dict[str, List[str]]:
    """Load entities from our existing JSON file."""
    if not entities_path.exists():
        return {}
    
    with open(entities_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    entities_by_type = defaultdict(list)
    
    # Handle graph structure
    nodes = data.get("nodes", [])
    for node in nodes:
        entity_type = node.get("type", "UNKNOWN")
        name = node.get("name", "")
        if name:
            entities_by_type[entity_type].append(name)
    
    return dict(entities_by_type)


def compare_entities(extracted: Dict[str, List[str]], 
                     existing: Dict[str, List[str]]) -> Dict[str, Any]:
    """Compare extracted entities with existing ones."""
    comparison = {
        "extracted_types": list(extracted.keys()),
        "existing_types": list(existing.keys()),
        "overlap": {},
        "only_extracted": {},
        "only_existing": {},
    }
    
    # Map spaCy types to our types
    type_mapping = {
        "PER": "PERSON",
        "PERSON": "PERSON",
        "PERSON_CANDIDATE": "PERSON",
        "LOC": "LOCATION",
        "GPE": "LOCATION",
        "LOCATION": "LOCATION",
        "ORG": "ORGANIZATION",
        "ORGANIZATION": "ORGANIZATION",
        "KEY_FIGURE": "PERSON",
    }
    
    # Normalize extracted entities
    normalized_extracted = defaultdict(set)
    for etype, entities in extracted.items():
        mapped_type = type_mapping.get(etype, etype)
        for e in entities:
            normalized_extracted[mapped_type].add(e.lower())
    
    # Normalize existing entities
    normalized_existing = defaultdict(set)
    for etype, entities in existing.items():
        for e in entities:
            normalized_existing[etype].add(e.lower())
    
    # Compare each type
    all_types = set(normalized_extracted.keys()) | set(normalized_existing.keys())
    
    for etype in all_types:
        ext_set = normalized_extracted.get(etype, set())
        exi_set = normalized_existing.get(etype, set())
        
        overlap = ext_set & exi_set
        only_ext = ext_set - exi_set
        only_exi = exi_set - ext_set
        
        if overlap:
            comparison["overlap"][etype] = len(overlap)
        if only_ext:
            comparison["only_extracted"][etype] = list(only_ext)[:10]  # Sample
        if only_exi:
            comparison["only_existing"][etype] = list(only_exi)[:10]  # Sample
    
    return comparison


# =============================================================================
# Main
# =============================================================================

def main():
    print("=" * 70)
    print("spaCy vs OpenAI Entity Extraction Test")
    print("=" * 70)
    print()
    
    results = {
        "pdf_extraction": {},
        "ocr_text": {},
        "entity_extraction": {},
        "comparison": {},
        "recommendations": []
    }
    
    # 1. Test PDF text extraction
    print("\n📄 PDF TEXT EXTRACTION")
    print("-" * 40)
    
    if TEST_PDF.exists():
        print(f"Testing: {TEST_PDF.name}")
        
        if HAS_PDFPLUMBER:
            text_pdfplumber, time_pdfplumber = extract_text_pdfplumber(TEST_PDF)
            results["pdf_extraction"]["pdfplumber"] = {
                "chars": len(text_pdfplumber),
                "time_seconds": round(time_pdfplumber, 2)
            }
            print(f"  pdfplumber: {len(text_pdfplumber):,} chars in {time_pdfplumber:.2f}s")
        
        if HAS_PYMUPDF:
            text_pymupdf, time_pymupdf = extract_text_pymupdf(TEST_PDF)
            results["pdf_extraction"]["pymupdf"] = {
                "chars": len(text_pymupdf),
                "time_seconds": round(time_pymupdf, 2)
            }
            print(f"  PyMuPDF: {len(text_pymupdf):,} chars in {time_pymupdf:.2f}s")
            
            # Try block-based extraction for column handling
            text_blocks, time_blocks, blocks = extract_text_pymupdf_blocks(TEST_PDF)
            results["pdf_extraction"]["pymupdf_blocks"] = {
                "chars": len(text_blocks),
                "blocks": len(blocks),
                "time_seconds": round(time_blocks, 2)
            }
            print(f"  PyMuPDF (blocks): {len(text_blocks):,} chars, {len(blocks)} blocks in {time_blocks:.2f}s")
    else:
        print(f"  ⚠️  PDF not found: {TEST_PDF}")
    
    # 2. Load OCR text
    print("\n📝 OCR TEXT")
    print("-" * 40)
    
    ocr_text = ""
    if TEST_OCR.exists():
        ocr_text = TEST_OCR.read_text(encoding='utf-8')
        results["ocr_text"] = {
            "chars": len(ocr_text),
            "lines": ocr_text.count('\n')
        }
        print(f"  OCR file: {len(ocr_text):,} chars, {ocr_text.count(chr(10)):,} lines")
    else:
        print(f"  ⚠️  OCR not found: {TEST_OCR}")
    
    # 3. Entity extraction tests
    print("\n🔍 ENTITY EXTRACTION")
    print("-" * 40)
    
    # Use OCR text for entity extraction (since it's cleaner for our case)
    test_text = ocr_text if ocr_text else (text_pymupdf if HAS_PYMUPDF else "")
    
    if test_text:
        # Regex-based extraction (fastest)
        print("\n  [Regex-based extraction]")
        entities_regex, time_regex = extract_entities_regex(test_text)
        results["entity_extraction"]["regex"] = {
            "time_seconds": round(time_regex, 2),
            "entities": {k: len(v) for k, v in entities_regex.items()},
            "sample": {k: v[:5] for k, v in entities_regex.items()}
        }
        print(f"    Time: {time_regex:.3f}s")
        for etype, entities in entities_regex.items():
            print(f"    {etype}: {len(entities)} found")
        
        # spaCy-based extraction
        print("\n  [spaCy NER extraction]")
        nlp = load_spacy_model()
        if nlp:
            entities_spacy, time_spacy = extract_entities_spacy(test_text, nlp)
            results["entity_extraction"]["spacy"] = {
                "time_seconds": round(time_spacy, 2),
                "entities": {k: len(v) for k, v in entities_spacy.items()},
                "sample": {k: v[:5] for k, v in entities_spacy.items()}
            }
            print(f"    Time: {time_spacy:.2f}s")
            for etype, entities in entities_spacy.items():
                print(f"    {etype}: {len(entities)} found")
        else:
            results["entity_extraction"]["spacy"] = {"error": "Model not installed"}
    
    # 4. Compare with existing entities
    print("\n📊 COMPARISON WITH OPENAI-EXTRACTED ENTITIES")
    print("-" * 40)
    
    existing_entities = load_existing_entities(TEST_ENTITIES)
    if existing_entities:
        print(f"  Existing entity types: {list(existing_entities.keys())}")
        for etype, entities in existing_entities.items():
            print(f"    {etype}: {len(entities)} entities")
        
        # Compare regex extraction
        if entities_regex:
            comparison_regex = compare_entities(entities_regex, existing_entities)
            results["comparison"]["regex_vs_existing"] = comparison_regex
            print("\n  Regex vs Existing overlap:")
            for etype, count in comparison_regex.get("overlap", {}).items():
                print(f"    {etype}: {count} matching")
        
        # Compare spaCy extraction
        if nlp and entities_spacy:
            comparison_spacy = compare_entities(entities_spacy, existing_entities)
            results["comparison"]["spacy_vs_existing"] = comparison_spacy
            print("\n  spaCy vs Existing overlap:")
            for etype, count in comparison_spacy.get("overlap", {}).items():
                print(f"    {etype}: {count} matching")
    else:
        print("  ⚠️  No existing entities to compare")
    
    # 5. Recommendations
    print("\n💡 RECOMMENDATIONS")
    print("-" * 40)
    
    recommendations = []
    
    if entities_regex:
        regex_total = sum(len(v) for v in entities_regex.values())
        recommendations.append(
            f"✅ Regex extraction found {regex_total} entities in {time_regex:.3f}s (FREE, instant)"
        )
    
    if nlp and entities_spacy:
        spacy_total = sum(len(v) for v in entities_spacy.values())
        recommendations.append(
            f"✅ spaCy found {spacy_total} entities in {time_spacy:.2f}s (FREE, local)"
        )
    
    recommendations.append(
        "🔄 Hybrid approach: Use regex + spaCy for initial extraction, AI only for:"
    )
    recommendations.append("   - Name consolidation (merging variants)")
    recommendations.append("   - Role classification (witness vs lawyer)")
    recommendations.append("   - Relationship inference")
    recommendations.append("   - Complex context understanding")
    
    if existing_entities:
        existing_total = sum(len(v) for v in existing_entities.values())
        recommendations.append(
            f"📊 Current OpenAI extraction: {existing_total} entities (API cost per file)"
        )
    
    results["recommendations"] = recommendations
    for rec in recommendations:
        print(f"  {rec}")
    
    # Save results
    output_path = Path(__file__).parent / "extraction_comparison.json"
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\n📁 Results saved to: {output_path}")
    
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print("""
For your corpus of ~75 files:

BEFORE (OpenAI only):
  - ~50 chunks × 75 files = 3,750 API calls for extraction
  - Plus consolidation calls
  - Time: ~30-60 minutes
  - Cost: ~$5-10 depending on model

AFTER (Hybrid approach):
  - Regex: Extract sessions, known locations, key figures (instant, free)
  - spaCy: Extract PERSON, ORG, LOC candidates (seconds per file, free)
  - OpenAI: Only for consolidation + role classification (~100-200 calls total)
  - Time: ~5-10 minutes
  - Cost: ~$0.50-1.00

Potential savings: 80-90% fewer API calls!
""")
    
    return results


if __name__ == "__main__":
    main()

