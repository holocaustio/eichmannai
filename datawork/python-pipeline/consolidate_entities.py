#!/usr/bin/env python3
"""
Consolidate and deduplicate entities using OpenAI.
Reads entities from spaCy extraction, consolidates with LLM, and outputs clean graph.
"""

import json
import os
from pathlib import Path
from datetime import datetime
from collections import defaultdict
import time

try:
    from openai import OpenAI
except ImportError:
    import subprocess
    subprocess.run(["pip", "install", "openai"], check=True)
    from openai import OpenAI

try:
    from dotenv import load_dotenv
except ImportError:
    import subprocess
    subprocess.run(["pip", "install", "python-dotenv"], check=True)
    from dotenv import load_dotenv

# Paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
INPUT_FILE = PROJECT_ROOT / "app" / "public" / "data" / "entities-consolidated.json"
OUTPUT_FILE = PROJECT_ROOT / "app" / "public" / "data" / "entities-consolidated.json"

# Load environment variables
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / "app" / ".env.local")

# Initialize OpenAI client
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def batch_entities(entities, batch_size=50):
    """Split entities into batches for processing."""
    items = list(entities.items())
    for i in range(0, len(items), batch_size):
        yield dict(items[i:i + batch_size])


def consolidate_with_openai(entities, entity_type):
    """Use OpenAI to consolidate and deduplicate entities."""
    
    if not entities:
        return {}
    
    # Prepare entity list for the prompt
    entity_names = list(entities.keys())
    
    prompt = f"""You are an expert on the Holocaust and the Eichmann Trial (1961).

I have a list of {entity_type} extracted from the Eichmann Trial transcripts using NER.
Many are duplicates, misspellings, partial extractions, or misclassified entities.

Your task:
1. Identify groups of entities that refer to the same thing
2. Choose the best canonical name for each group
3. Filter out entities that are NOT actually {entity_type} (e.g., person names in locations)
4. Filter out generic terms, partial words, or extraction errors

For {entity_type}:
{"- Keep: Cities, countries, camps, ghettos, streets, buildings" if entity_type == "LOCATIONS" else ""}
{"- Remove: Person names, organization names, generic words" if entity_type == "LOCATIONS" else ""}
{"- Keep: Nazi organizations (SS, Gestapo, RSHA), Jewish organizations, governments, companies" if entity_type == "ORGANIZATIONS" else ""}
{"- Remove: Person names, location names, generic words like 'Army', 'Police', 'Office'" if entity_type == "ORGANIZATIONS" else ""}
{"- Keep: Nazi leaders (Hitler, Himmler, Heydrich, etc.), SS officers, trial participants, historical figures" if entity_type == "PERSONS" else ""}
{"- Merge: Variants like 'Hitler'/'Adolf Hitler', 'Eichmann'/'Adolf Eichmann', titles with names" if entity_type == "PERSONS" else ""}
{"- Remove: Location names, organization names, generic terms (Judge, Witness, etc.)" if entity_type == "PERSONS" else ""}

Return a JSON object where:
- Keys are the canonical entity names to keep
- Values are arrays of all variant names that should be merged into that canonical name

Example output format:
{{
  "Auschwitz-Birkenau": ["Auschwitz", "Auschwitz-Birkenau", "Birkenau", "Auschwitz camp"],
  "Warsaw": ["Warsaw", "Warszawa", "Warsaw Ghetto"],
  "SS": ["SS", "the SS", "Schutzstaffel"]
}}

Only include entities that are genuinely {entity_type}. Exclude all others.

Here are the entities to consolidate:
{json.dumps(entity_names, indent=2)}

Return ONLY valid JSON, no explanation."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a data cleaning expert specializing in Holocaust history. Return only valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.1,
            max_tokens=4000,
        )
        
        result_text = response.choices[0].message.content.strip()
        
        # Clean up the response
        if result_text.startswith("```json"):
            result_text = result_text[7:]
        if result_text.startswith("```"):
            result_text = result_text[3:]
        if result_text.endswith("```"):
            result_text = result_text[:-3]
        
        consolidation_map = json.loads(result_text)
        return consolidation_map
        
    except Exception as e:
        print(f"   ⚠️ OpenAI error: {e}")
        return {}


def apply_consolidation(entities, consolidation_map):
    """Apply consolidation map to merge entities."""
    consolidated = {}
    
    # Create reverse lookup: variant -> canonical
    variant_to_canonical = {}
    for canonical, variants in consolidation_map.items():
        for variant in variants:
            variant_to_canonical[variant.lower()] = canonical
    
    # Merge entities
    for name, data in entities.items():
        canonical = variant_to_canonical.get(name.lower(), None)
        
        if canonical is None:
            # Not in consolidation map - check if name itself is a canonical
            if name in consolidation_map:
                canonical = name
            else:
                continue  # Skip entities not in the map
        
        if canonical not in consolidated:
            consolidated[canonical] = {
                "sessions": set(),
                "mentions": 0,
            }
        
        consolidated[canonical]["mentions"] += data.get("mentions", 0)
        sessions = data.get("sessions", [])
        if isinstance(sessions, list):
            consolidated[canonical]["sessions"].update(sessions)
        elif isinstance(sessions, set):
            consolidated[canonical]["sessions"].update(sessions)
    
    return consolidated


def main():
    print("=" * 60)
    print("Entity Consolidation with OpenAI")
    print("=" * 60)
    
    # Load current entities
    print("\n📚 Loading entities...")
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    nodes = data["nodes"]
    edges = data["edges"]
    
    # Separate entity types
    locations = {}
    organizations = {}
    persons = {}
    witnesses = []
    sessions = []
    testimonies = []
    events = {}
    other = []
    
    for node in nodes:
        node_type = node.get("type")
        if node_type == "LOCATION":
            locations[node["name"]] = {
                "sessions": node.get("sessions", []),
                "mentions": node.get("mentions", 0),
                "original": node,
            }
        elif node_type == "ORGANIZATION":
            organizations[node["name"]] = {
                "sessions": node.get("sessions", []),
                "mentions": node.get("mentions", 0),
                "original": node,
            }
        elif node_type == "PERSON":
            if node.get("isWitness"):
                witnesses.append(node)
            else:
                persons[node["name"]] = {
                    "sessions": node.get("sessions", []),
                    "mentions": node.get("mentions", 0),
                    "original": node,
                }
        elif node_type == "SESSION":
            sessions.append(node)
        elif node_type == "TESTIMONY":
            testimonies.append(node)
        elif node_type == "EVENT":
            events[node["name"]] = {
                "sessions": node.get("sessions", []),
                "mentions": node.get("mentions", 0),
                "original": node,
            }
        else:
            other.append(node)
    
    print(f"   Locations: {len(locations)}")
    print(f"   Organizations: {len(organizations)}")
    print(f"   Persons (non-witness): {len(persons)}")
    print(f"   Events: {len(events)}")
    print(f"   Witnesses: {len(witnesses)}")
    print(f"   Sessions: {len(sessions)}")
    print(f"   Testimonies: {len(testimonies)}")
    
    # Consolidate locations
    print("\n🔄 Consolidating LOCATIONS with OpenAI...")
    all_location_consolidations = {}
    for i, batch in enumerate(batch_entities(locations, 100)):
        print(f"   Batch {i+1} ({len(batch)} entities)...", end=" ", flush=True)
        consolidation = consolidate_with_openai(batch, "LOCATIONS")
        all_location_consolidations.update(consolidation)
        print(f"→ {len(consolidation)} canonical")
        time.sleep(0.5)  # Rate limiting
    
    consolidated_locations = apply_consolidation(locations, all_location_consolidations)
    print(f"   Result: {len(locations)} → {len(consolidated_locations)} locations")
    
    # Consolidate organizations
    print("\n🔄 Consolidating ORGANIZATIONS with OpenAI...")
    all_org_consolidations = {}
    for i, batch in enumerate(batch_entities(organizations, 100)):
        print(f"   Batch {i+1} ({len(batch)} entities)...", end=" ", flush=True)
        consolidation = consolidate_with_openai(batch, "ORGANIZATIONS")
        all_org_consolidations.update(consolidation)
        print(f"→ {len(consolidation)} canonical")
        time.sleep(0.5)
    
    consolidated_orgs = apply_consolidation(organizations, all_org_consolidations)
    print(f"   Result: {len(organizations)} → {len(consolidated_orgs)} organizations")
    
    # Consolidate events
    print("\n🔄 Consolidating EVENTS with OpenAI...")
    if events:
        event_consolidation = consolidate_with_openai(events, "EVENTS")
        consolidated_events = apply_consolidation(events, event_consolidation)
        print(f"   Result: {len(events)} → {len(consolidated_events)} events")
    else:
        consolidated_events = {}
    
    # Build new nodes list
    print("\n🏗️ Building consolidated graph...")
    new_nodes = []
    node_id = 1
    
    # Add witnesses (unchanged)
    for w in witnesses:
        new_nodes.append(w)
    
    # Add consolidated locations
    for name, data in consolidated_locations.items():
        new_nodes.append({
            "id": f"location_{node_id}",
            "type": "LOCATION",
            "name": name,
            "sessions": sorted(data["sessions"]),
            "mentions": data["mentions"],
        })
        node_id += 1
    
    # Add consolidated organizations
    for name, data in consolidated_orgs.items():
        new_nodes.append({
            "id": f"org_{node_id}",
            "type": "ORGANIZATION",
            "name": name,
            "sessions": sorted(data["sessions"]),
            "mentions": data["mentions"],
        })
        node_id += 1
    
    # Add consolidated events
    for name, data in consolidated_events.items():
        new_nodes.append({
            "id": f"event_{node_id}",
            "type": "EVENT",
            "name": name,
            "sessions": sorted(data["sessions"]),
            "mentions": data["mentions"],
        })
        node_id += 1
    
    # Add sessions (unchanged)
    for s in sessions:
        new_nodes.append(s)
    
    # Add testimonies (unchanged)
    for t in testimonies:
        new_nodes.append(t)
    
    # Add other nodes
    for o in other:
        new_nodes.append(o)
    
    # Consolidate PERSONS with OpenAI
    print("\n🔄 Consolidating PERSONS with OpenAI...")
    person_consolidation = {}
    
    # Process persons in batches
    person_list = list(persons.items())
    for i in range(0, len(person_list), 100):
        batch = dict(person_list[i:i + 100])
        batch_num = i // 100 + 1
        print(f"   Batch {batch_num} ({len(batch)} entities)...", end=" ")
        
        result = consolidate_with_openai(batch, "PERSONS")
        if result:
            person_consolidation.update(result)
            print(f"→ {len(result)} canonical")
        else:
            print("→ skipped (error)")
    
    # Apply consolidation
    consolidated_persons = apply_consolidation(persons, person_consolidation)
    print(f"   Result: {len(persons)} → {len(consolidated_persons)} persons")
    
    # Add consolidated persons
    for name, data in consolidated_persons.items():
        sessions_list = sorted(data["sessions"]) if isinstance(data["sessions"], set) else data["sessions"]
        new_nodes.append({
            "id": f"person_{node_id}",
            "type": "PERSON",
            "name": name,
            "isWitness": False,
            "role": "Historical Figure",
            "sessions": sessions_list,
            "mentions": data["mentions"],
        })
        node_id += 1
    
    # Rebuild edges
    print("\n🔗 Building edges...")
    new_edges = []
    edge_id = 1
    
    for node in new_nodes:
        node_type = node.get("type")
        if node_type in ("SESSION", "DATE"):
            continue
        
        sessions_list = node.get("sessions", [])
        if node_type == "TESTIMONY":
            sessions_list = [node.get("session")] if node.get("session") else []
        
        if not sessions_list:
            continue
        
        # Determine edge type
        if node.get("isWitness"):
            edge_type = "TESTIFIED_IN"
        elif node_type == "TESTIMONY":
            edge_type = "RECORDED_IN"
        else:
            edge_type = "MENTIONED_IN"
        
        for session_num in sessions_list:
            if session_num:
                new_edges.append({
                    "id": f"edge_{edge_id}",
                    "source": node["id"],
                    "target": f"session-{session_num}",
                    "type": edge_type,
                })
                edge_id += 1
        
        # Link testimony to witness
        if node_type == "TESTIMONY" and node.get("witnessId"):
            new_edges.append({
                "id": f"edge_{edge_id}",
                "source": node["id"],
                "target": node["witnessId"],
                "type": "TESTIMONY_OF",
            })
            edge_id += 1
    
    # Link sessions to dates (OCCURRED_ON edges)
    session_nodes = [n for n in new_nodes if n.get("type") == "SESSION"]
    date_nodes = {n["id"]: n for n in new_nodes if n.get("type") == "DATE"}
    
    for session in session_nodes:
        session_date = session.get("date")  # e.g., "1961-04-11"
        if session_date:
            date_id = f"date-{session_date}"
            if date_id in date_nodes:
                new_edges.append({
                    "id": f"edge_{edge_id}",
                    "source": session["id"],
                    "target": date_id,
                    "type": "OCCURRED_ON",
                })
                edge_id += 1
    
    # Count stats
    type_counts = defaultdict(int)
    for node in new_nodes:
        type_counts[node.get("type", "?")] += 1
    
    # Build output
    output = {
        "metadata": {
            "generatedAt": datetime.now().isoformat(),
            "totalNodes": len(new_nodes),
            "totalEdges": len(new_edges),
            "typeCounts": dict(type_counts),
            "source": "consolidate_entities.py (OpenAI)",
        },
        "nodes": new_nodes,
        "edges": new_edges,
    }
    
    # Save
    print("\n💾 Saving...")
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False, default=list)
    
    print("\n" + "=" * 60)
    print("COMPLETE")
    print("=" * 60)
    print(f"Output: {OUTPUT_FILE}")
    print(f"Nodes: {len(new_nodes)}")
    print(f"Edges: {len(new_edges)}")
    for t, c in sorted(type_counts.items()):
        print(f"  {t}: {c}")


if __name__ == "__main__":
    main()
