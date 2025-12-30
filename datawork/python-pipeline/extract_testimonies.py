#!/usr/bin/env python3
"""
Extract testimonies from OCR files based on witness-index.json source lines.
"""

import json
import re
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent.parent
OCR_DIR = BASE_DIR / "downloads" / "pdf" / "OCR_clean"
OUTPUT_DIR = BASE_DIR / "app" / "public" / "data" / "testimonies"
WITNESS_INDEX = BASE_DIR / "eichmann-entities" / "witness-index.json"


def clean_line(line: str) -> str:
    """Clean OCR line for markdown output."""
    # Remove RTL/LTR control characters
    line = re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069]', '', line)
    # Remove excessive whitespace
    line = re.sub(r'\s+', ' ', line.strip())
    return line


def format_as_markdown(lines: list, hebrew_name: str, english_name: str) -> str:
    """Format testimony lines as markdown."""
    md = f"# עדות {hebrew_name}\n"
    md += f"## Testimony of {english_name}\n\n"
    md += "---\n\n"
    
    for line in lines:
        clean = clean_line(line)
        if not clean:
            continue
        
        # Format speaker lines
        if any(clean.startswith(prefix) for prefix in ['אב בית הדין', 'אב בית‪ẁ‬הדין', 'אב ביתֿהדין']):
            md += f"\n**אב בית הדין (השופט לנדאו):** {clean.split(maxsplit=3)[-1] if len(clean.split()) > 3 else clean}\n\n"
        elif clean.startswith('היועץ המשפטי') or clean.startswith('היועץ המשפטי'):
            md += f"\n**היועץ המשפטי (התובע):** {clean.split(maxsplit=2)[-1] if len(clean.split()) > 2 else clean}\n\n"
        elif clean.startswith('ד"ר סרבציוס') or clean.startswith('דר\' סרבציוס'):
            md += f"\n**ד\"ר סרבציוס (הסניגור):** {clean.split(maxsplit=2)[-1] if len(clean.split()) > 2 else clean}\n\n"
        elif clean.startswith('השופט הלוי'):
            md += f"\n**השופט הלוי:** {clean.split(maxsplit=2)[-1] if len(clean.split()) > 2 else clean}\n\n"
        elif clean.startswith('השופט רוה') or clean.startswith('השופט רווה'):
            md += f"\n**השופט רווה:** {clean.split(maxsplit=2)[-1] if len(clean.split()) > 2 else clean}\n\n"
        elif clean.startswith('העד ') or clean.startswith('העדה '):
            parts = clean.split(maxsplit=2)
            if len(parts) >= 2:
                md += f"\n**{parts[0]} {parts[1]}:** {parts[2] if len(parts) > 2 else ''}\n\n"
            else:
                md += f"\n**{clean}**\n\n"
        elif clean.startswith('ש.') or clean.startswith('ש .'):
            md += f"\n**שאלה:** {clean[2:].strip()}\n\n"
        elif clean.startswith('ת.') or clean.startswith('ת .'):
            md += f"\n**תשובה:** {clean[2:].strip()}\n\n"
        else:
            md += f"{clean}\n\n"
    
    return md


def extract_testimony(witness: dict) -> bool:
    """Extract testimony for a single witness."""
    hebrew_name = witness.get('hebrew', '')
    english_name = witness.get('english', '')
    source_file = witness.get('sourceFile', '')
    source_lines = witness.get('sourceLines', '')
    
    if not all([hebrew_name, english_name, source_file, source_lines]):
        print(f"  ⚠️  {english_name}: Missing required fields")
        return False
    
    # Parse source lines
    try:
        start, end = map(int, source_lines.split('-'))
    except ValueError:
        print(f"  ⚠️  {english_name}: Invalid source lines format: {source_lines}")
        return False
    
    # Read source file
    source_path = OCR_DIR / source_file
    if not source_path.exists():
        print(f"  ⚠️  {english_name}: Source file not found: {source_file}")
        return False
    
    try:
        with open(source_path, encoding='utf-8') as f:
            all_lines = f.readlines()
    except Exception as e:
        print(f"  ⚠️  {english_name}: Error reading file: {e}")
        return False
    
    # Extract lines (1-indexed in index, 0-indexed in Python)
    testimony_lines = all_lines[start-1:end]
    
    if not testimony_lines:
        print(f"  ⚠️  {english_name}: No lines extracted ({start}-{end})")
        return False
    
    # Format as markdown
    md_content = format_as_markdown(testimony_lines, hebrew_name, english_name)
    
    # Write output
    output_name = english_name.replace(' ', '_').replace('.', '').replace("'", '')
    output_path = OUTPUT_DIR / f"{output_name}.md"
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(md_content)
    
    return True


def main():
    print("=" * 60)
    print("Testimony Extraction")
    print("=" * 60)
    
    # Load witness index
    with open(WITNESS_INDEX, encoding='utf-8') as f:
        index = json.load(f)
    
    witnesses = index.get('witnesses', [])
    print(f"\nProcessing {len(witnesses)} witnesses...")
    
    # Ensure output directory exists
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    success = 0
    failed = 0
    
    for witness in witnesses:
        name = witness.get('english', '?')
        print(f"  {name}...", end=" ")
        
        if extract_testimony(witness):
            print("✓")
            success += 1
        else:
            failed += 1
    
    print("\n" + "=" * 60)
    print(f"Success: {success}")
    print(f"Failed: {failed}")
    print("=" * 60)


if __name__ == "__main__":
    main()
