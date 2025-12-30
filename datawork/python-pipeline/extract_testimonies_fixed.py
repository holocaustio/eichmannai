#!/usr/bin/env python3
"""
FIXED Testimony Extraction - Strict Boundary Detection

The key insight: Testimonies have VERY clear markers:
1. START: "[העד הושבע]" or "[העדה הושבעה]" or "[העד מצהיר]" followed by witness name
2. END: Judge says "תודה" + witness last name, OR "סיימת את עדותך" with witness name
   OR next witness is called/sworn in

CRITICAL: We must stop AT the end marker, not AFTER. And we must detect when
ANOTHER witness starts speaking (העד/העדה + DIFFERENT name).
"""

import json
import re
import os
from pathlib import Path
from typing import List, Dict, Tuple, Optional, Set
from datetime import datetime

# =============================================================================
# Configuration
# =============================================================================

BASE_DIR = Path(__file__).parent.parent.parent
OCR_DIR = BASE_DIR / "downloads" / "pdf" / "OCR_clean"
OUTPUT_DIR = BASE_DIR / "app" / "public" / "data" / "testimonies"
WITNESS_INDEX = BASE_DIR / "eichmann-entities" / "witness-index.json"

# Key figures for speaker detection
SPEAKERS = {
    "היועץ המשפטי": "**היועץ המשפטי (התובע):**",
    "אב בית הדין": "**אב בית הדין (השופט לנדאו):**",
    "השופט הלוי": "**השופט הלוי:**",
    "השופט רווה": "**השופט רווה:**",
    "השופט רוה": "**השופט רוה:**",
    "הסניגור": "**הסניגור (ד\"ר סרבציוס):**",
    "ד״ר סרבציוס": "**הסניגור (ד\"ר סרבציוס):**",
}

# =============================================================================
# Load Data
# =============================================================================

def load_witness_index() -> List[Dict]:
    """Load the official witness list."""
    with open(WITNESS_INDEX, encoding='utf-8') as f:
        data = json.load(f)
    return data.get("witnesses", [])


def get_all_ocr_text() -> Dict[str, Tuple[str, List[str]]]:
    """Load all OCR files into memory for searching."""
    files = {}
    for f in sorted(list(OCR_DIR.glob("Vol*.txt")) + list(OCR_DIR.glob("vol*.txt"))):
        if f.stat().st_size < 1000:  # Skip tiny files
            continue
        content = f.read_text(encoding='utf-8')
        lines = content.split('\n')
        files[f.name] = (content, lines)
    return files


def clean_line(line: str) -> str:
    """Remove RTL markers and normalize."""
    return re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069‪‫‬‭‮]', '', line)


# =============================================================================
# Build Name Variants for Matching
# =============================================================================

def get_name_variants(witness: Dict) -> Set[str]:
    """Build set of name variants for matching a witness."""
    hebrew_name = witness.get("hebrew", "")
    alias = witness.get("alias", "")
    variants_list = witness.get("variants", [])
    
    variants = set()
    
    if hebrew_name:
        # Full name
        variants.add(hebrew_name)
        
        # Last name
        parts = hebrew_name.split()
        if parts:
            last_name = parts[-1]
            variants.add(last_name)
            # Without hyphen
            variants.add(last_name.replace('-', ''))
            variants.add(last_name.replace('־', ''))  # Hebrew hyphen
        
        # Without title
        for prefix in ["דר'", "דר׳", 'ד"ר', 'ד״ר', "פרופ'", "פרופ׳", "מר ", "גברת "]:
            if hebrew_name.startswith(prefix):
                clean = hebrew_name[len(prefix):].strip()
                variants.add(clean)
                if clean.split():
                    variants.add(clean.split()[-1])
    
    if alias:
        variants.add(alias)
        variants.add(alias.replace('-', ''))
    
    for v in variants_list:
        if v:
            variants.add(v)
            variants.add(v.replace('-', ''))
    
    # Remove very short variants (less than 3 chars)
    return {v for v in variants if len(v) >= 3}


def build_all_witness_names(witnesses: List[Dict]) -> Dict[str, str]:
    """Build a map of all last names to full names for detecting OTHER witnesses."""
    name_map = {}
    for w in witnesses:
        hebrew_name = w.get("hebrew", "")
        if hebrew_name:
            parts = hebrew_name.split()
            if parts:
                last_name = parts[-1]
                name_map[last_name] = hebrew_name
                name_map[last_name.replace('-', '')] = hebrew_name
                name_map[last_name.replace('־', '')] = hebrew_name
    return name_map


# =============================================================================
# Strict Testimony Boundary Detection
# =============================================================================

def find_testimony_start(lines: List[str], name_variants: Set[str]) -> Optional[int]:
    """
    Find the exact start line of a testimony.
    
    Markers:
    - [העד הושבע] or [העדה הושבעה] 
    - [העד מצהיר] or [העדה מצהירה]
    - הצהיר/ה בהן צדק
    
    Followed by witness name within 15 lines.
    """
    for i, line in enumerate(lines):
        clean = clean_line(line)
        
        # Check for sworn-in / declaration markers
        is_start_marker = (
            'העד הושבע' in clean or 'העדה הושבעה' in clean or
            'העד מצהיר' in clean or 'העדה מצהירה' in clean or
            'הצהיר בהן צדק' in clean or 'הצהירה בהן צדק' in clean
        )
        
        if is_start_marker:
            # Check next 15 lines for witness name
            context_lines = [clean_line(l) for l in lines[i:min(len(lines), i+15)]]
            context = '\n'.join(context_lines)
            
            for variant in name_variants:
                if variant in context:
                    return i
    
    return None


def find_testimony_end(
    lines: List[str], 
    start_line: int, 
    name_variants: Set[str],
    all_witness_names: Dict[str, str],
    current_hebrew_name: str
) -> int:
    """
    Find the exact end line of a testimony.
    
    End markers (in priority order):
    1. "תודה" + witness name by judge (most common)
    2. "סיימת את עדותך" with witness name
    3. ANOTHER witness being sworn in
    4. ANOTHER witness speaking (העד/העדה + DIFFERENT name)
    
    Returns the LAST line of THIS witness's testimony.
    """
    current_last_name = current_hebrew_name.split()[-1] if current_hebrew_name else ""
    
    for i in range(start_line + 10, len(lines)):  # Start checking after at least 10 lines
        clean = clean_line(lines[i])
        
        # ============================================
        # Check 1: Explicit dismissal with witness name
        # ============================================
        if any(variant in clean for variant in name_variants):
            # "תודה" by judge with witness name
            if 'תודה' in clean and ('אב בית הדין' in clean or 'השופט' in clean):
                return i
            
            # Explicit dismissal phrases
            if 'סיימת את עדותך' in clean or 'סיימת את עדות' in clean:
                return i
            if 'גמרת את עדותך' in clean or 'גמרת את עדות' in clean:
                return i
            if 'בזה סיימת' in clean or 'בזה גמרת' in clean:
                return i
        
        # ============================================
        # Check 2: ANOTHER witness being sworn in
        # ============================================
        is_new_witness_sworn = (
            'העד הושבע' in clean or 'העדה הושבעה' in clean or
            'העד מצהיר' in clean or 'העדה מצהירה' in clean
        )
        
        if is_new_witness_sworn and i > start_line + 50:  # At least 50 lines in
            # Check if this is for a DIFFERENT witness
            context = '\n'.join([clean_line(l) for l in lines[i:min(len(lines), i+10)]])
            is_same_witness = any(variant in context for variant in name_variants)
            
            if not is_same_witness:
                # New witness starting - end BEFORE this line
                return i - 1
        
        # ============================================
        # Check 3: ANOTHER witness speaking (העד/העדה + different name)
        # ============================================
        # Pattern: "העד <name>" or "העדה <name>" where name != current witness
        witness_speaking_match = re.search(r'הע[דה] ([^\s,.:]+)', clean)
        if witness_speaking_match:
            speaking_name = witness_speaking_match.group(1)
            
            # Check if this is a DIFFERENT witness
            if speaking_name not in name_variants and speaking_name in all_witness_names:
                # Another witness is now speaking - this is the boundary
                # But first verify this isn't just a mention (check if it's at line start)
                if clean.strip().startswith('העד') or clean.strip().startswith('העדה'):
                    # Double check: is there testimony-like content after?
                    if i > start_line + 50:  # At least 50 lines in
                        return i - 1
        
        # ============================================
        # Check 4: Judge calling next witness
        # ============================================
        if 'אני קורא ל' in clean or 'אני קורא את' in clean:
            # Calling next witness - check it's not this witness
            if not any(variant in clean for variant in name_variants):
                if i > start_line + 30:
                    return i - 1
    
    # If no end found, return last line (shouldn't happen often)
    return len(lines) - 1


# =============================================================================
# Validate Testimony Purity
# =============================================================================

def validate_testimony_purity(
    lines: List[str], 
    name_variants: Set[str],
    all_witness_names: Dict[str, str],
    current_hebrew_name: str
) -> Tuple[bool, List[str]]:
    """
    Validate that a testimony contains ONLY content from this witness.
    Returns (is_pure, list_of_issues).
    """
    issues = []
    current_last_name = current_hebrew_name.split()[-1] if current_hebrew_name else ""
    
    # Track other witnesses who appear to speak
    other_witnesses_speaking = set()
    
    for i, line in enumerate(lines):
        clean = clean_line(line)
        
        # Check for "העד/העדה <name>" pattern
        witness_speaking_match = re.search(r'הע[דה] ([^\s,.:]+)', clean)
        if witness_speaking_match:
            speaking_name = witness_speaking_match.group(1)
            
            # Is this a DIFFERENT witness speaking?
            if speaking_name not in name_variants and speaking_name in all_witness_names:
                other_witnesses_speaking.add(speaking_name)
        
        # Check for explicit "תודה, <different name>" pattern
        if 'תודה' in clean and ('גברת' in clean or 'מר ' in clean or 'דר' in clean):
            # Extract name after תודה
            for other_name in all_witness_names.keys():
                if other_name in clean and other_name not in name_variants:
                    # Judge thanking a DIFFERENT witness in this testimony
                    issues.append(f"Line {i+1}: Judge thanks different witness '{other_name}'")
    
    if other_witnesses_speaking:
        for name in other_witnesses_speaking:
            if name != current_last_name:
                issues.append(f"Other witness '{name}' appears to speak in testimony")
    
    is_pure = len(issues) == 0
    return is_pure, issues


# =============================================================================
# Extract Single Testimony with Validation
# =============================================================================

def extract_single_testimony(
    lines: List[str],
    witness: Dict,
    file_name: str,
    all_witness_names: Dict[str, str]
) -> Optional[Dict]:
    """
    Extract a single testimony with strict boundary detection and validation.
    Returns dict with testimony data or None if extraction fails.
    """
    hebrew_name = witness.get("hebrew", "")
    english_name = witness.get("english", "")
    name_variants = get_name_variants(witness)
    
    # Find start
    start = find_testimony_start(lines, name_variants)
    if start is None:
        return None
    
    # Find end
    end = find_testimony_end(lines, start, name_variants, all_witness_names, hebrew_name)
    
    # Extract lines
    testimony_lines = lines[start:end+1]
    
    # Validate purity
    is_pure, issues = validate_testimony_purity(
        testimony_lines, name_variants, all_witness_names, hebrew_name
    )
    
    if not is_pure:
        # Try to fix by finding a better end boundary
        # Look for the FIRST issue and truncate before it
        for i, line in enumerate(testimony_lines):
            clean = clean_line(line)
            
            # Check for other witness speaking
            witness_match = re.search(r'הע[דה] ([^\s,.:]+)', clean)
            if witness_match:
                name = witness_match.group(1)
                if name not in name_variants and name in all_witness_names:
                    # Truncate before this line
                    end = start + i - 1
                    testimony_lines = lines[start:end+1]
                    break
            
            # Check for judge thanking different witness
            if 'תודה' in clean and ('גברת' in clean or 'מר ' in clean):
                for other_name in all_witness_names.keys():
                    if other_name in clean and other_name not in name_variants:
                        # Truncate before this line
                        end = start + i - 1
                        testimony_lines = lines[start:end+1]
                        break
        
        # Re-validate after fix
        is_pure, issues = validate_testimony_purity(
            testimony_lines, name_variants, all_witness_names, hebrew_name
        )
    
    # Final check: testimony should be at least 500 chars
    text = '\n'.join(testimony_lines)
    if len(text) < 500:
        return None
    
    return {
        "hebrew_name": hebrew_name,
        "english_name": english_name,
        "file": file_name,
        "start_line": start + 1,  # 1-based
        "end_line": end + 1,
        "lines": testimony_lines,
        "text": text,
        "is_pure": is_pure,
        "issues": issues
    }


# =============================================================================
# Text Cleaning and Formatting
# =============================================================================

def clean_testimony_text(lines: List[str]) -> List[str]:
    """Clean OCR artifacts from testimony lines."""
    cleaned = []
    
    for line in lines:
        clean = clean_line(line)
        
        # Skip page numbers (lines that are just numbers)
        if re.match(r'^\s*\d+\s*$', clean):
            continue
        
        # Skip header lines
        if 'משפט אייכמן' in clean and len(clean) < 50:
            continue
        if re.match(r'^\s*ישיבה\s+מס[\'׳]?\s*\d+\s*$', clean):
            continue
        
        # Normalize quotes and apostrophes
        clean = clean.replace('״', '"').replace('׳', "'")
        
        # Remove excessive whitespace
        clean = re.sub(r'\s+', ' ', clean).strip()
        
        if clean:
            cleaned.append(clean)
    
    return cleaned


def format_as_markdown(lines: List[str], english_name: str, hebrew_name: str) -> str:
    """Format testimony as clean markdown."""
    last_name = hebrew_name.split()[-1] if hebrew_name else ""
    
    formatted = []
    formatted.append(f"# עדות {hebrew_name}")
    formatted.append(f"## Testimony of {english_name}")
    formatted.append("")
    formatted.append("---")
    formatted.append("")
    
    for line in lines:
        # Format speakers
        formatted_line = line
        
        # Check for known speakers
        for speaker, replacement in SPEAKERS.items():
            if line.startswith(speaker) or f'({speaker}' in line[:50]:
                formatted_line = line.replace(speaker, replacement.rstrip(':'), 1)
                break
        
        # Format witness speaking
        if f'העד {last_name}' in formatted_line[:30]:
            formatted_line = formatted_line.replace(f'העד {last_name}', f'**העד {last_name}**', 1)
        if f'העדה {last_name}' in formatted_line[:30]:
            formatted_line = formatted_line.replace(f'העדה {last_name}', f'**העדה {last_name}**', 1)
        
        # Q&A format
        if line.startswith('ש.') or line.startswith('ש '):
            formatted_line = f"**שאלה:** {line[2:].strip()}"
        elif line.startswith('ת.') or line.startswith('ת '):
            formatted_line = f"**תשובה:** {line[2:].strip()}"
        
        formatted.append(formatted_line)
        formatted.append("")
    
    return '\n'.join(formatted)


# =============================================================================
# Main Extraction
# =============================================================================

def extract_all_testimonies():
    """Extract all testimonies with strict validation."""
    print("=" * 60)
    print("FIXED TESTIMONY EXTRACTION")
    print("=" * 60)
    
    # Load data
    print("\n[1] Loading data...")
    witnesses = load_witness_index()
    ocr_files = get_all_ocr_text()
    all_witness_names = build_all_witness_names(witnesses)
    
    print(f"    {len(witnesses)} witnesses")
    print(f"    {len(ocr_files)} OCR files")
    print(f"    {len(all_witness_names)} witness name variants indexed")
    
    # Create output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    # Track results
    extracted = []
    failed = []
    impure = []
    
    print("\n[2] Extracting testimonies...")
    
    for i, witness in enumerate(witnesses):
        hebrew_name = witness.get("hebrew", "")
        english_name = witness.get("english", "")
        
        print(f"\n  [{i+1}/108] {english_name} ({hebrew_name})...")
        
        testimony = None
        
        # Search all OCR files for this witness
        for file_name, (content, lines) in ocr_files.items():
            result = extract_single_testimony(lines, witness, file_name, all_witness_names)
            
            if result:
                # Keep the longest pure testimony, or longest if none are pure
                if testimony is None:
                    testimony = result
                elif result["is_pure"] and not testimony["is_pure"]:
                    testimony = result
                elif result["is_pure"] == testimony["is_pure"] and len(result["text"]) > len(testimony["text"]):
                    testimony = result
        
        if testimony:
            # Clean and format
            cleaned_lines = clean_testimony_text(testimony["lines"])
            markdown = format_as_markdown(cleaned_lines, english_name, hebrew_name)
            
            # Save file
            safe_name = english_name.replace(" ", "_").replace("'", "").replace('"', '')
            safe_name = re.sub(r'[^\w\-]', '', safe_name)
            output_file = OUTPUT_DIR / f"{safe_name}.md"
            output_file.write_text(markdown, encoding='utf-8')
            
            status = "✓" if testimony["is_pure"] else "⚠"
            print(f"    {status} Extracted {len(testimony['text'])} chars from {testimony['file']}")
            print(f"      Lines {testimony['start_line']}-{testimony['end_line']}")
            
            if not testimony["is_pure"]:
                print(f"      Issues: {testimony['issues'][:2]}")  # First 2 issues
                impure.append({
                    "witness": english_name,
                    "issues": testimony["issues"]
                })
            
            extracted.append({
                "witness": english_name,
                "hebrew": hebrew_name,
                "file": testimony["file"],
                "lines": f"{testimony['start_line']}-{testimony['end_line']}",
                "chars": len(testimony["text"]),
                "is_pure": testimony["is_pure"],
                "output": str(output_file.name)
            })
        else:
            print(f"    ✗ Could not find testimony")
            failed.append({
                "witness": english_name,
                "hebrew": hebrew_name,
                "reason": "Not found in any file"
            })
    
    # Summary
    print("\n" + "=" * 60)
    print("EXTRACTION COMPLETE")
    print("=" * 60)
    print(f"\n✓ Extracted: {len(extracted)}")
    print(f"⚠ With issues: {len(impure)}")
    print(f"✗ Failed: {len(failed)}")
    
    if impure:
        print("\nTestimonies with issues (may contain other witness content):")
        for item in impure[:10]:
            print(f"  - {item['witness']}: {item['issues'][0] if item['issues'] else 'unknown'}")
        if len(impure) > 10:
            print(f"  ... and {len(impure) - 10} more")
    
    if failed:
        print("\nFailed witnesses:")
        for f in failed[:10]:
            print(f"  - {f['witness']}")
        if len(failed) > 10:
            print(f"  ... and {len(failed) - 10} more")
    
    # Save index
    index_file = OUTPUT_DIR / "_index.json"
    index_data = {
        "extractedAt": datetime.now().isoformat(),
        "total": len(witnesses),
        "extracted": len(extracted),
        "pure": len(extracted) - len(impure),
        "impure": len(impure),
        "failed": len(failed),
        "testimonies": extracted,
        "failures": failed
    }
    index_file.write_text(json.dumps(index_data, indent=2, ensure_ascii=False), encoding='utf-8')
    
    print(f"\nIndex saved to: {index_file}")


if __name__ == "__main__":
    extract_all_testimonies()
