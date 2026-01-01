#!/usr/bin/env python3
"""
Add entity markers to markdown files for interactive highlighting.

This script scans markdown files for entity mentions and adds special markers
that can be parsed by React components to create interactive entity links.

Marker format: [[TYPE:entity-id|Display Text]]
Example: [[PERSON:person-adolf-eichmann|Adolf Eichmann]]
"""

import json
import re
import os
from pathlib import Path
from typing import Dict, List, Tuple, Set
from dataclasses import dataclass


@dataclass
class Entity:
    id: str
    name: str
    type: str
    english_name: str = ""
    

def load_entities(entities_path: str) -> List[Entity]:
    """Load entities from the consolidated JSON file."""
    with open(entities_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    entities = []
    for node in data.get('nodes', []):
        entity = Entity(
            id=node.get('id', ''),
            name=node.get('name', ''),
            type=node.get('type', ''),
            english_name=node.get('englishName', node.get('name', ''))
        )
        if entity.id and entity.name:
            entities.append(entity)
    
    return entities


def build_search_terms(entities: List[Entity]) -> Dict[str, Entity]:
    """
    Build a dictionary mapping search terms to entities.
    Longer terms are prioritized to handle overlapping matches.
    """
    term_to_entity: Dict[str, Entity] = {}
    
    # Skip these entity types for now (too generic or session-specific)
    skip_types = {'SESSION', 'TESTIMONY', 'DATE'}
    
    # Terms to skip (too common/ambiguous or partial matches)
    skip_terms = {
        'The', 'A', 'An', 'In', 'Of', 'To', 'For', 'And', 'Or', 'But',
        'It', 'He', 'She', 'They', 'We', 'You', 'I', 'My', 'Our', 'Your',
        'This', 'That', 'These', 'Those', 'There', 'Here', 'Where', 'When',
        'What', 'Who', 'How', 'Why', 'All', 'Some', 'Any', 'No', 'Not',
        'War', 'Law', 'Court', 'Trial', 'State', 'Reich', 'Party',
        'First', 'Second', 'Third', 'One', 'Two', 'Three',
        # Avoid partial word matches from compound entity names
        'Economic', 'Administrative', 'Head', 'Office', 'Central',
        'General', 'Special', 'Main', 'Chief', 'Deputy', 'Senior',
        'Ministry', 'Department', 'Bureau', 'Commission', 'Committee',
        'Council', 'Board', 'Agency', 'Service', 'Force', 'Unit',
        'North', 'South', 'East', 'West', 'Upper', 'Lower', 'New', 'Old',
    }
    
    for entity in entities:
        if entity.type in skip_types:
            continue
        
        # Add the main name
        name = entity.name.strip()
        if name and len(name) > 2 and name not in skip_terms:
            if name not in term_to_entity or len(name) > len(term_to_entity[name].name):
                term_to_entity[name] = entity
        
        # Add English name if different
        en_name = entity.english_name.strip()
        if en_name and en_name != name and len(en_name) > 2 and en_name not in skip_terms:
            if en_name not in term_to_entity or len(en_name) > len(term_to_entity[en_name].name):
                term_to_entity[en_name] = entity
        
        # Special handling for hyphenated compound names ONLY
        # e.g., "Auschwitz-Birkenau" should also match "Auschwitz"
        # But NOT for names like "Economic-Administrative Head Office"
        if '-' in name and ' ' not in name:
            # Only for simple hyphenated names without spaces
            parts = name.split('-')
            for part in parts:
                part = part.strip()
                if part and len(part) > 4 and part not in skip_terms:
                    if part not in term_to_entity:
                        term_to_entity[part] = entity
    
    return term_to_entity


def create_regex_pattern(terms: List[str]) -> re.Pattern:
    """
    Create a regex pattern that matches any of the given terms.
    Uses word boundaries and sorts by length (longest first) for proper matching.
    """
    # Sort by length descending to match longer terms first
    sorted_terms = sorted(terms, key=len, reverse=True)
    
    # Escape special regex characters and join with OR
    escaped_terms = [re.escape(term) for term in sorted_terms]
    
    # Word boundary pattern - be careful with terms ending in punctuation
    pattern = r'\b(' + '|'.join(escaped_terms) + r')\b'
    
    return re.compile(pattern, re.IGNORECASE)


def is_inside_marker(text: str, pos: int) -> bool:
    """Check if position is already inside an entity marker [[...]]."""
    # Find the last [[ before this position
    last_open = text.rfind('[[', 0, pos)
    if last_open == -1:
        return False
    
    # Find the first ]] after the last [[
    next_close = text.find(']]', last_open)
    
    # If the close is after our position, we're inside a marker
    return next_close != -1 and next_close > pos


def is_inside_markdown_syntax(text: str, pos: int) -> bool:
    """Check if position is inside markdown syntax like ** or ## etc."""
    # Check for bold markers
    before = text[max(0, pos-2):pos]
    after = text[pos:pos+2]
    
    if '**' in before or '**' in after:
        return True
    
    # Check if at start of line with markdown header
    line_start = text.rfind('\n', 0, pos)
    if line_start == -1:
        line_start = 0
    else:
        line_start += 1
    
    line_prefix = text[line_start:pos].lstrip()
    if line_prefix.startswith('#') or line_prefix.startswith('>'):
        # Only skip if we're very close to the marker
        if len(line_prefix) < 4:
            return True
    
    return False


def add_markers_to_text(text: str, term_to_entity: Dict[str, Entity], pattern: re.Pattern) -> Tuple[str, int]:
    """
    Add entity markers to text content.
    Returns the modified text and count of markers added.
    """
    markers_added = 0
    result_parts = []
    last_end = 0
    
    # Track which positions have been marked to avoid overlapping
    marked_positions: Set[int] = set()
    
    # Find all matches
    matches = list(pattern.finditer(text))
    
    for match in matches:
        start, end = match.span()
        matched_text = match.group(0)
        
        # Check if this position overlaps with already marked text
        if any(pos in marked_positions for pos in range(start, end)):
            continue
        
        # Check if already inside a marker
        if is_inside_marker(text, start):
            continue
        
        # Check if inside markdown syntax
        if is_inside_markdown_syntax(text, start):
            continue
        
        # Find the entity (case-insensitive lookup)
        entity = None
        for term, ent in term_to_entity.items():
            if term.lower() == matched_text.lower():
                entity = ent
                break
        
        if not entity:
            continue
        
        # Add text before this match
        result_parts.append(text[last_end:start])
        
        # Add the marker - preserve original case of matched text
        marker = f'[[{entity.type}:{entity.id}|{matched_text}]]'
        result_parts.append(marker)
        
        # Mark these positions as used
        for pos in range(start, end):
            marked_positions.add(pos)
        
        last_end = end
        markers_added += 1
    
    # Add remaining text
    result_parts.append(text[last_end:])
    
    return ''.join(result_parts), markers_added


def process_markdown_file(file_path: str, term_to_entity: Dict[str, Entity], pattern: re.Pattern) -> int:
    """Process a single markdown file and add entity markers."""
    print(f"Processing: {file_path}")
    
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Add markers
    new_content, markers_added = add_markers_to_text(content, term_to_entity, pattern)
    
    if markers_added > 0:
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"  Added {markers_added} entity markers")
    else:
        print(f"  No markers added")
    
    return markers_added


def main():
    # Paths
    base_dir = Path(__file__).parent.parent
    entities_path = base_dir / 'app' / 'public' / 'data' / 'entities-consolidated.json'
    testimonies_en_dir = base_dir / 'app' / 'public' / 'data' / 'testimonies' / 'en'
    
    # Files to process - start with opening statement and verdict
    files_to_process = [
        base_dir / 'app' / 'public' / 'data' / 'opening-statement-en.md',
        base_dir / 'app' / 'public' / 'data' / 'verdict.md',
    ]
    
    # Add all English testimonies
    if testimonies_en_dir.exists():
        for md_file in testimonies_en_dir.glob('*.md'):
            files_to_process.append(md_file)
    
    print("Loading entities...")
    entities = load_entities(str(entities_path))
    print(f"Loaded {len(entities)} entities")
    
    print("\nBuilding search terms...")
    term_to_entity = build_search_terms(entities)
    print(f"Built {len(term_to_entity)} search terms")
    
    # Show some sample terms
    sample_terms = list(term_to_entity.keys())[:20]
    print(f"Sample terms: {sample_terms}")
    
    print("\nCreating regex pattern...")
    pattern = create_regex_pattern(list(term_to_entity.keys()))
    
    print(f"\nProcessing {len(files_to_process)} files...")
    total_markers = 0
    for file_path in files_to_process:
        if file_path.exists():
            total_markers += process_markdown_file(str(file_path), term_to_entity, pattern)
        else:
            print(f"File not found: {file_path}")
    
    print(f"\n✅ Done! Added {total_markers} entity markers total.")


if __name__ == '__main__':
    main()
