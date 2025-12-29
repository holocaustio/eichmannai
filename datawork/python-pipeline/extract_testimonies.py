#!/usr/bin/env python3
"""
Extract all 108 witness testimonies as clean markdown files.

For each witness:
1. Find exact testimony boundaries (sworn in → dismissed)
2. Clean artifacts (page numbers, headers, etc.)
3. Format with proper speaker detection
4. Validate no overlap with adjacent testimonies
5. Save as markdown
"""

import json
import re
import os
from pathlib import Path
from typing import List, Dict, Tuple, Optional
from datetime import datetime

# =============================================================================
# Configuration
# =============================================================================

BASE_DIR = Path(__file__).parent.parent.parent
OCR_DIR = BASE_DIR / "downloads" / "pdf" / "OCR_clean"
OUTPUT_DIR = BASE_DIR / "app" / "public" / "data" / "testimonies"
WITNESS_INDEX = BASE_DIR / "eichmann-entities" / "witness-index.json"
ENTITIES_FILE = BASE_DIR / "app" / "public" / "data" / "entities.json"

# Key figures for speaker detection
SPEAKERS = {
    "היועץ המשפטי": "**היועץ המשפטי (התובע):**",
    "אב בית הדין": "**אב בית הדין (השופט לנדאו):**",
    "השופט הלוי": "**השופט הלוי:**",
    "השופט רווה": "**השופט רווה:**",
    "ד״ר סרבציוס": "**ד״ר סרבציוס (הסנגור):**",
    "דר' סרבציוס": "**ד״ר סרבציוס (הסנגור):**",
    "סרבציוס": "**ד״ר סרבציוס (הסנגור):**",
}

# =============================================================================
# Load Data
# =============================================================================

def load_witness_index() -> List[Dict]:
    """Load the official witness list."""
    with open(WITNESS_INDEX, encoding='utf-8') as f:
        data = json.load(f)
    return data.get("witnesses", [])


def load_entities() -> Dict:
    """Load the entities file with source information."""
    with open(ENTITIES_FILE, encoding='utf-8') as f:
        return json.load(f)


def get_all_ocr_text() -> Dict[str, Tuple[str, List[str]]]:
    """Load all OCR files into memory for searching."""
    files = {}
    # Include both Vol*.txt and vol*.txt patterns (case insensitive)
    for f in sorted(list(OCR_DIR.glob("Vol*.txt")) + list(OCR_DIR.glob("vol*.txt"))):
        content = f.read_text(encoding='utf-8')
        lines = content.split('\n')
        files[f.name] = (content, lines)
    return files


# =============================================================================
# Testimony Boundary Detection
# =============================================================================

def get_name_variants(hebrew_name: str, alias: str = "", variants: List[str] = None) -> set:
    """Build set of name variants for matching."""
    last_name = hebrew_name.split()[-1] if hebrew_name else ""
    
    # Remove title prefixes for matching
    clean_name = hebrew_name
    for prefix in ["דר'", "דר׳", 'ד"ר', "פרופ'", "פרופ׳"]:
        if clean_name.startswith(prefix):
            clean_name = clean_name[len(prefix):].strip()
    clean_last_name = clean_name.split()[-1] if clean_name else last_name
    
    name_variants = set([last_name, clean_last_name])
    name_variants.add(last_name.replace('-', ''))
    name_variants.add(clean_last_name.replace('-', ''))
    
    if alias:
        name_variants.add(alias)
        name_variants.add(alias.replace('-', ''))
    
    if variants:
        for v in variants:
            if v:
                name_variants.add(v)
                name_variants.add(v.replace('-', ''))
    
    # Remove very short variants
    name_variants = {n for n in name_variants if len(n) >= 3}
    
    return name_variants


def find_testimony_boundaries(
    lines: List[str], 
    hebrew_name: str,
    file_name: str,
    aliases: List[str] = None
) -> Tuple[Optional[int], Optional[int]]:
    """
    Find the exact start and end lines of a testimony.
    
    Start: Line with [העד הושבע] or [העדה הושבעה] followed by witness name
    End: Line with "סיימת את עדותך" or "זאת עדותך" with witness name
    """
    last_name = hebrew_name.split()[-1]
    
    # Remove title prefixes for matching
    clean_name = hebrew_name
    for prefix in ["דר'", "דר׳", 'ד"ר', "פרופ'", "פרופ׳"]:
        if clean_name.startswith(prefix):
            clean_name = clean_name[len(prefix):].strip()
    clean_last_name = clean_name.split()[-1] if clean_name else last_name
    
    # Build list of all name variants to search for
    name_variants = set([last_name, clean_last_name])
    
    # Add variants without hyphens
    name_variants.add(last_name.replace('-', ''))
    name_variants.add(clean_last_name.replace('-', ''))
    
    # Add aliases if provided
    if aliases:
        for alias in aliases:
            if alias:
                name_variants.add(alias)
                name_variants.add(alias.replace('-', ''))
    
    # Special handling for common patterns
    # "די-נור" -> "דינור"
    if '-' in last_name:
        name_variants.add(last_name.replace('-', ''))
    
    # Remove very short variants
    name_variants = {n for n in name_variants if len(n) >= 3}
    
    start_line = None
    end_line = None
    
    # Find start - look for sworn in marker followed by witness name within 20 lines
    for i, line in enumerate(lines):
        # Clean RTL markers for matching
        clean_line = re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069‪‫‬‭‮]', '', line)
        
        # Check for sworn in marker OR declaration marker (both bracket directions due to RTL)
        if 'העד הושבע' in clean_line or 'העדה הושבעה' in clean_line or \
           'הער הושבע' in clean_line or 'הערה הושבעה' in clean_line or \
           'העד מצהיר' in clean_line or 'העדה מצהירה' in clean_line or \
           'העד הצהיר' in clean_line or 'העדה הצהירה' in clean_line or \
           'הצהיר בהן צדק' in clean_line or 'הצהירה בהן צדק' in clean_line:
            # Check next 20 lines for witness name
            context_lines = [re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069‪‫‬‭‮]', '', l) 
                            for l in lines[i:min(len(lines), i+20)]]
            context = '\n'.join(context_lines)
            if any(variant in context for variant in name_variants):
                # Verify this is the right witness by checking for name introduction
                name_context = '\n'.join(context_lines[:10])
                if any(variant in name_context for variant in name_variants):
                    start_line = i
                    break
    
    if start_line is None:
        # Alternative: look for "אני קורא ל" + name pattern (may not have sworn-in marker)
        for i, line in enumerate(lines):
            clean_line = re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069‪‫‬‭‮]', '', line)
            if 'קורא את' in clean_line and any(variant in clean_line for variant in name_variants):
                # Look for sworn in marker OR "מה שמך" pattern after this
                for j in range(i, min(len(lines), i + 30)):
                    check_line = re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069‪‫‬‭‮]', '', lines[j])
                    if 'העד הושבע' in check_line or 'העדה הושבעה' in check_line or \
                       'העד מצהיר' in check_line or 'העדה מצהירה' in check_line:
                        start_line = j
                        break
                    # Also accept "מה שמך" as testimony start marker
                    if 'מה שמך' in check_line or 'מה שמו' in check_line:
                        # Check if witness name appears in the next few lines
                        ctx = '\n'.join([re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069‪‫‬‭‮]', '', l) 
                                        for l in lines[j:min(len(lines), j+10)]])
                        if any(variant in ctx for variant in name_variants):
                            start_line = i  # Use the "קורא את" line as start
                            break
                if start_line:
                    break
    
    if start_line is None:
        # Alternative 3: look for "העד X" pattern directly (no sworn-in marker)
        for i, line in enumerate(lines):
            clean_line = re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069‪‫‬‭‮]', '', line)
            for variant in name_variants:
                if f'העד {variant}' in clean_line or f'העדה {variant}' in clean_line:
                    # Make sure this is the start of testimony (previous line should have something indicative)
                    if i > 0:
                        prev_line = re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069‪‫‬‭‮]', '', lines[i-1])
                        # Look for a blank line or session marker before
                        if len(prev_line.strip()) < 20 or 'שמך' in prev_line or 'מה שמ' in prev_line or 'ישיבה' in prev_line:
                            # Check context confirms this is testimony
                            ctx_lines = [re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069‪‫‬‭‮]', '', l) 
                                        for l in lines[i:min(len(lines), i+15)]]
                            ctx = '\n'.join(ctx_lines)
                            # Should have Q&A pattern
                            if 'ש .' in ctx or '.ש' in ctx or '? ' in ctx:
                                start_line = i
                                break
            if start_line:
                break
    
    if start_line is None:
        return None, None
    
    # Find end - look for dismissal with witness name
    for i in range(start_line + 10, len(lines)):
        line = lines[i]
        clean_line = re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069‪‫‬‭‮]', '', line)
        
        # Check for dismissal patterns
        is_dismissal = False
        
        # Pattern 1: "סיימת את עדותך" or "גמרת את עדותך" or "בזה סיימת" with name nearby
        if 'סיימת את עדותך' in clean_line or 'סיימת את עדות' in clean_line or \
           'גמרת את עדותך' in clean_line or 'גמרת את עדות' in clean_line or \
           'בזה סיימת' in clean_line or 'בזה גמרת' in clean_line:
            # Check if witness name is in this line or adjacent
            nearby_lines = [re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069‪‫‬‭‮]', '', l) 
                           for l in lines[max(0,i-2):min(len(lines),i+3)]]
            nearby = '\n'.join(nearby_lines)
            if any(variant in nearby for variant in name_variants):
                is_dismissal = True
        
        # Pattern 2: "זאת עדותך" with name
        if 'זאת עדותך' in clean_line or 'זו עדותך' in clean_line:
            nearby_lines = [re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069‪‫‬‭‮]', '', l) 
                           for l in lines[max(0,i-2):min(len(lines),i+3)]]
            nearby = '\n'.join(nearby_lines)
            if any(variant in nearby for variant in name_variants):
                is_dismissal = True
        
        # Pattern 3: "תודה, מר/גברת/פקד X" with name (even without explicit dismissal)
        if 'תודה' in clean_line and any(variant in clean_line for variant in name_variants):
            # Check if this is Judge/Court thanking (dismissal context)
            if 'אב בית הדין' in clean_line or 'השופט' in clean_line:
                is_dismissal = True
            # Or if it has explicit dismissal words
            elif 'סיימת' in clean_line or 'עדותך' in clean_line or 'גמרת' in clean_line:
                is_dismissal = True
        
        # Pattern 4: Just "תודה, X, גמרת/סיימת את עדותך"
        if 'עדותך' in clean_line and any(variant in clean_line for variant in name_variants):
            is_dismissal = True
        
        # Pattern 5: "הגברת/מר X. יכול/יכולה להיות" (informal dismissal)
        if any(variant in clean_line for variant in name_variants):
            if 'יכול להיות' in clean_line or 'יכולה להיות' in clean_line:
                is_dismissal = True
        
        if is_dismissal:
            end_line = i
            break
        
        # Safety: if we hit another witness being sworn in, stop
        if i > start_line + 50:  # At least 50 lines into testimony
            if 'העד הושבע' in clean_line or 'העדה הושבעה' in clean_line or \
               'העד מצהיר' in clean_line or 'העדה מצהירה' in clean_line:
                # New witness - this is the boundary
                end_line = i - 1
                break
    
    return start_line, end_line


# =============================================================================
# Text Cleaning and Formatting
# =============================================================================

def truncate_at_dismissal(text: str, name_variants: set) -> str:
    """Truncate text at the dismissal line to remove artifacts from next testimony."""
    lines = text.split('\n')
    dismissal_line = None
    
    # Dismissal patterns
    dismissal_words = ['סיימת את עדותך', 'גמרת את עדותך', 'בזה סיימת', 'בזה גמרת', 
                       'לא יוכל להמשיך בעדותו', 'לא תוכל להמשיך בעדותה']
    
    # Find LAST dismissal with witness name (in case of multiple sessions)
    for i in range(len(lines) - 1, -1, -1):
        line = lines[i]
        clean_line = re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069]', '', line)
        
        # Check for dismissal with name
        for dw in dismissal_words:
            if dw in clean_line:
                if any(v in clean_line for v in name_variants):
                    dismissal_line = i
                    break
        
        # Also check for "תודה" + name in judge context
        if 'תודה' in clean_line and any(v in clean_line for v in name_variants):
            if 'אב בית הדין' in clean_line or 'השופט' in clean_line:
                dismissal_line = i
                break
        
        if dismissal_line is not None:
            break
    
    # Also check for the pattern of calling the NEXT witness - truncate before that
    for i, line in enumerate(lines):
        clean_line = re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069]', '', line)
        # If we see "אני קורא ל" and it's NOT about this witness
        if 'אני קורא ל' in clean_line or 'אני קורא את' in clean_line:
            if not any(v in clean_line for v in name_variants):
                # This is calling the next witness
                if dismissal_line is None or i < dismissal_line:
                    dismissal_line = i - 1  # Stop before this line
                break
    
    if dismissal_line is not None and dismissal_line > 0:
        # Keep up to and including the dismissal line
        return '\n'.join(lines[:dismissal_line + 1])
    
    return text


def clean_text(text: str) -> str:
    """Remove OCR artifacts, page numbers, headers."""
    lines = text.split('\n')
    cleaned = []
    
    for line in lines:
        # Skip page numbers (lines that are just numbers)
        if re.match(r'^\s*\d+\s*$', line):
            continue
        
        # Skip header lines (common patterns)
        if 'משפט אייכמן' in line and len(line) < 50:
            continue
        if re.match(r'^\s*ישיבה\s+מס[\'׳]?\s*\d+\s*$', line):
            continue
        
        # Clean up RTL markers and weird characters
        line = re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069]', '', line)
        line = re.sub(r'[‪‫‬‭‮]', '', line)
        
        # Normalize quotes and apostrophes
        line = line.replace('״', '"').replace('׳', "'")
        
        # Remove excessive whitespace
        line = re.sub(r'\s+', ' ', line).strip()
        
        if line:
            cleaned.append(line)
    
    return '\n'.join(cleaned)


def format_as_markdown(text: str, witness_name: str, hebrew_name: str) -> str:
    """Format testimony as clean markdown with speaker detection."""
    lines = text.split('\n')
    formatted = []
    
    # Add header
    formatted.append(f"# עדות {hebrew_name}")
    formatted.append(f"## Testimony of {witness_name}")
    formatted.append("")
    formatted.append("---")
    formatted.append("")
    
    last_name = hebrew_name.split()[-1]
    witness_speaker = f"**העד {last_name}:**"
    
    current_paragraph = []
    
    for line in lines:
        # Skip empty lines
        if not line.strip():
            if current_paragraph:
                formatted.append(' '.join(current_paragraph))
                formatted.append("")
                current_paragraph = []
            continue
        
        # Detect and format speakers
        formatted_line = line
        
        # Check for known speakers
        speaker_found = False
        for speaker, replacement in SPEAKERS.items():
            if line.startswith(speaker) or f' {speaker}' in line[:50]:
                # This is a speaker line
                if current_paragraph:
                    formatted.append(' '.join(current_paragraph))
                    formatted.append("")
                    current_paragraph = []
                
                # Format the speaker line
                formatted_line = line.replace(speaker, replacement, 1)
                formatted.append(formatted_line)
                formatted.append("")
                speaker_found = True
                break
        
        if speaker_found:
            continue
        
        # Check for witness speaking (העד X)
        if f'העד {last_name}' in line[:30] or line.startswith(f'העד {last_name}'):
            if current_paragraph:
                formatted.append(' '.join(current_paragraph))
                formatted.append("")
                current_paragraph = []
            
            formatted_line = line.replace(f'העד {last_name}', witness_speaker, 1)
            formatted.append(formatted_line)
            formatted.append("")
            continue
        
        # Check for Q&A format (ש. / ת.)
        if line.startswith('ש.') or line.startswith('ש '):
            if current_paragraph:
                formatted.append(' '.join(current_paragraph))
                formatted.append("")
                current_paragraph = []
            formatted.append(f"**שאלה:** {line[2:].strip()}")
            formatted.append("")
            continue
        
        if line.startswith('ת.') or line.startswith('ת '):
            if current_paragraph:
                formatted.append(' '.join(current_paragraph))
                formatted.append("")
                current_paragraph = []
            formatted.append(f"**תשובה:** {line[2:].strip()}")
            formatted.append("")
            continue
        
        # Regular line - add to paragraph
        current_paragraph.append(line)
    
    # Don't forget the last paragraph
    if current_paragraph:
        formatted.append(' '.join(current_paragraph))
    
    # Add footer
    formatted.append("")
    formatted.append("---")
    formatted.append(f"*Extracted from the Eichmann Trial transcripts*")
    
    return '\n'.join(formatted)


# =============================================================================
# Validation
# =============================================================================

def validate_testimony(text: str, hebrew_name: str, prev_witness: str = None, next_witness: str = None) -> List[str]:
    """Validate that testimony has no artifacts from adjacent witnesses."""
    issues = []
    
    last_name = hebrew_name.split()[-1]
    
    # Check for sworn in markers (should only be at start, not in middle)
    sworn_markers = list(re.finditer(r'\[הע[רד]ה? הושבע[ה]?\]', text))
    if len(sworn_markers) > 1:
        issues.append(f"Found {len(sworn_markers)} sworn-in markers (expected 1)")
    
    # Check for multiple "סיימת את עדותך" (should only be at end)
    end_markers = len(re.findall(r'סיימת את עדותך|סיימת את עדות', text))
    if end_markers > 1:
        issues.append(f"Found {end_markers} testimony-end markers (expected 1)")
    
    # Check if adjacent witness names appear prominently
    if prev_witness:
        prev_last = prev_witness.split()[-1]
        if prev_last != last_name:
            first_500 = text[:500]
            if prev_last in first_500 and f'העד {prev_last}' in first_500:
                issues.append(f"Previous witness '{prev_witness}' appears at start")
    
    if next_witness:
        next_last = next_witness.split()[-1]
        if next_last != last_name:
            last_500 = text[-500:]
            if next_last in last_500 and f'העד {next_last}' in last_500:
                issues.append(f"Next witness '{next_witness}' appears at end")
    
    return issues


# =============================================================================
# Main Extraction
# =============================================================================

def extract_all_testimonies():
    """Extract all 108 testimonies."""
    print("=" * 60)
    print("TESTIMONY EXTRACTION")
    print("=" * 60)
    
    # Load data
    print("\n[1] Loading data...")
    witnesses = load_witness_index()
    entities = load_entities()
    ocr_files = get_all_ocr_text()
    
    print(f"    {len(witnesses)} witnesses")
    print(f"    {len(ocr_files)} OCR files")
    
    # Create output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    # Track results
    extracted = []
    failed = []
    
    print("\n[2] Extracting testimonies...")
    
    for i, witness in enumerate(witnesses):
        hebrew_name = witness.get("hebrew", "")
        english_name = witness.get("english", "")
        alias = witness.get("alias", "")
        variants = witness.get("variants", [])
        
        print(f"\n  [{i+1}/108] {english_name} ({hebrew_name})...")
        
        # Find the witness in entities to get source files
        entity = None
        for node in entities.get("nodes", []):
            if node.get("hebrewName") == hebrew_name and node.get("isWitness"):
                entity = node
                break
        
        # Get source files - from entities or search all Vol files directly
        source_files = []
        
        if entity and entity.get("sources"):
            for source in entity.get("sources", []):
                file_name = source.get("file", "")
                if (file_name.startswith("Vol") or file_name.startswith("vol")) and file_name in ocr_files:
                    source_files.append(file_name)
        
        # If no sources from entities, search ALL Vol files directly
        if not source_files:
            print(f"    → Searching all Vol files directly...")
            name_variants = get_name_variants(hebrew_name, alias, variants)
            for file_name in sorted(ocr_files.keys()):
                if not (file_name.startswith("Vol") or file_name.startswith("vol")):
                    continue
                content, lines = ocr_files[file_name]
                # Check if this witness is sworn in in this file
                for j, line in enumerate(lines):
                    clean_line = re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069‪‫‬‭‮]', '', line)
                    if 'העד הושבע' in clean_line or 'העדה הושבעה' in clean_line or \
                       'העד מצהיר' in clean_line or 'העדה מצהירה' in clean_line:
                        # Check if witness name is nearby
                        nearby = '\n'.join([re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069‪‫‬‭‮]', '', l) 
                                           for l in lines[j:min(len(lines), j+15)]])
                        if any(variant in nearby for variant in name_variants):
                            if file_name not in source_files:
                                source_files.append(file_name)
        
        if not source_files:
            print(f"    ✗ No source files found")
            failed.append({
                "witness": english_name,
                "hebrew": hebrew_name,
                "reason": "No source files"
            })
            continue
        
        # Try each source file
        testimony_found = False
        
        for file_name in source_files:
            
            if file_name not in ocr_files:
                continue
            
            content, lines = ocr_files[file_name]
            
            # Find boundaries (pass alias and variants)
            all_aliases = [alias] + variants if alias else variants
            start, end = find_testimony_boundaries(lines, hebrew_name, file_name, all_aliases)
            
            if start is not None and end is not None:
                # Extract text
                testimony_lines = lines[start:end+1]
                raw_text = '\n'.join(testimony_lines)
                
                # Build name variants for truncation
                all_variants = set([hebrew_name.split()[-1]])
                for v in (variants if variants else []):
                    if v and len(v) >= 3:
                        all_variants.add(v)
                
                # Truncate at dismissal and clean
                truncated = truncate_at_dismissal(raw_text, all_variants)
                cleaned = clean_text(truncated)
                
                # Quick validation
                if len(cleaned) < 500:
                    print(f"    ⚠ Too short ({len(cleaned)} chars), trying next source...")
                    continue
                
                issues = validate_testimony(cleaned, hebrew_name)
                if issues:
                    print(f"    ⚠ Validation issues: {', '.join(issues)}")
                
                # Format as markdown
                markdown = format_as_markdown(cleaned, english_name, hebrew_name)
                
                # Save file
                safe_name = english_name.replace(" ", "_").replace("'", "").replace('"', '')
                safe_name = re.sub(r'[^\w\-]', '', safe_name)
                output_file = OUTPUT_DIR / f"{safe_name}.md"
                
                output_file.write_text(markdown, encoding='utf-8')
                
                print(f"    ✓ Extracted {len(cleaned)} chars from {file_name} (lines {start+1}-{end+1})")
                
                extracted.append({
                    "witness": english_name,
                    "hebrew": hebrew_name,
                    "file": file_name,
                    "lines": f"{start+1}-{end+1}",
                    "chars": len(cleaned),
                    "output": str(output_file.name)
                })
                
                testimony_found = True
                break
        
        # If not found in entity sources, try searching ALL Vol files
        if not testimony_found and source_files:
            print(f"    → Entity sources failed, searching all Vol files...")
            name_variants = get_name_variants(hebrew_name, alias, variants)
            for file_name in sorted(ocr_files.keys()):
                if not (file_name.startswith("Vol") or file_name.startswith("vol")) or file_name in source_files:
                    continue
                content, lines = ocr_files[file_name]
                # Check if this witness is sworn in in this file
                for j, line in enumerate(lines):
                    clean_line = re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069‪‫‬‭‮]', '', line)
                    if 'העד הושבע' in clean_line or 'העדה הושבעה' in clean_line or \
                       'העד מצהיר' in clean_line or 'העדה מצהירה' in clean_line or \
                       'העד הצהיר' in clean_line or 'העדה הצהירה' in clean_line or \
                       'הצהיר בהן צדק' in clean_line or 'הצהירה בהן צדק' in clean_line:
                        nearby = '\n'.join([re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069‪‫‬‭‮]', '', l) 
                                           for l in lines[j:min(len(lines), j+15)]])
                        if any(variant in nearby for variant in name_variants):
                            # Try to extract from this file
                            all_aliases = [alias] + variants if alias else variants
                            start, end = find_testimony_boundaries(lines, hebrew_name, file_name, all_aliases)
                            if start is not None and end is not None:
                                testimony_lines = lines[start:end+1]
                                raw_text = '\n'.join(testimony_lines)
                                # Truncate at dismissal
                                truncated = truncate_at_dismissal(raw_text, name_variants)
                                cleaned = clean_text(truncated)
                                if len(cleaned) >= 500:
                                    markdown = format_as_markdown(cleaned, english_name, hebrew_name)
                                    safe_name = english_name.replace(" ", "_").replace("'", "").replace('"', '')
                                    safe_name = re.sub(r'[^\w\-]', '', safe_name)
                                    output_file = OUTPUT_DIR / f"{safe_name}.md"
                                    output_file.write_text(markdown, encoding='utf-8')
                                    print(f"    ✓ Extracted {len(cleaned)} chars from {file_name} (lines {start+1}-{end+1})")
                                    extracted.append({
                                        "witness": english_name,
                                        "hebrew": hebrew_name,
                                        "file": file_name,
                                        "lines": f"{start+1}-{end+1}",
                                        "chars": len(cleaned),
                                        "output": str(output_file.name)
                                    })
                                    testimony_found = True
                                    break
                if testimony_found:
                    break
        
        if not testimony_found:
            print(f"    ✗ Could not find testimony boundaries")
            failed.append({
                "witness": english_name,
                "hebrew": hebrew_name,
                "reason": "Boundaries not found"
            })
    
    # Summary
    print("\n" + "=" * 60)
    print("EXTRACTION COMPLETE")
    print("=" * 60)
    print(f"\n✓ Extracted: {len(extracted)}")
    print(f"✗ Failed: {len(failed)}")
    
    if failed:
        print("\nFailed witnesses:")
        for f in failed:
            print(f"  - {f['witness']}: {f['reason']}")
    
    # Save index
    index_file = OUTPUT_DIR / "_index.json"
    index_data = {
        "extractedAt": datetime.now().isoformat(),
        "total": len(witnesses),
        "extracted": len(extracted),
        "failed": len(failed),
        "testimonies": extracted,
        "failures": failed
    }
    index_file.write_text(json.dumps(index_data, indent=2, ensure_ascii=False), encoding='utf-8')
    
    print(f"\nIndex saved to: {index_file}")
    print(f"Testimonies saved to: {OUTPUT_DIR}")


if __name__ == "__main__":
    extract_all_testimonies()

