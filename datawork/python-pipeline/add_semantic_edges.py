#!/usr/bin/env python3
"""
Add semantic relationship edges between entities using OpenAI.
This script reads existing entities and uses LLM to identify meaningful
relationships based on Holocaust/Eichmann trial knowledge.
Does NOT re-extract entities - only adds new edges.
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

# Relationship types we want to extract
RELATIONSHIP_TYPES = [
    "COMMANDED",        # Person commanded organization/unit
    "MEMBER_OF",        # Person was member of organization
    "OPERATED_IN",      # Person/Organization operated in location
    "LOCATED_IN",       # Location is in another location (Auschwitz in Poland)
    "SUBORDINATE_TO",   # Person reported to another person
    "PARTICIPATED_IN",  # Person participated in event
    "PERPETRATED_AT",   # Person committed crimes at location
    "IMPRISONED_AT",    # Person was imprisoned at location
    "DEPORTED_TO",      # Related to deportation to location
    "ADMINISTERED",     # Organization administered location/camp
    "WITNESSED",        # Witness saw/experienced event/location
    "COLLABORATED_WITH", # Person/org worked with another
    "FOUNDED",          # Person founded organization
    "LED",              # Person led organization/operation
]


def extract_relationships_batch(entities_batch, all_entity_names):
    """Use OpenAI to extract relationships between entities."""
    
    prompt = f"""You are an expert historian specializing in the Holocaust and the Eichmann Trial (1961).

Given these entities from the Eichmann Trial transcripts, identify FACTUAL relationships between them.
Only include relationships you are CERTAIN about based on historical facts.

ENTITIES TO ANALYZE:
{json.dumps(entities_batch, indent=2)}

ALL AVAILABLE ENTITIES (for reference - relationships must connect to these):
{json.dumps(all_entity_names[:200], indent=2)}
{"..." if len(all_entity_names) > 200 else ""}

RELATIONSHIP TYPES TO USE:
- COMMANDED: Person commanded organization/unit (e.g., Himmler COMMANDED SS)
- MEMBER_OF: Person was member of organization (e.g., Eichmann MEMBER_OF SS)
- OPERATED_IN: Person/Org operated in location (e.g., Eichmann OPERATED_IN Vienna)
- LOCATED_IN: Location is within another (e.g., Auschwitz LOCATED_IN Poland)
- SUBORDINATE_TO: Person reported to another (e.g., Eichmann SUBORDINATE_TO Heydrich)
- PARTICIPATED_IN: Person participated in event (e.g., Eichmann PARTICIPATED_IN Wannsee Conference)
- PERPETRATED_AT: Crimes committed at location
- ADMINISTERED: Organization ran location (e.g., SS ADMINISTERED Auschwitz)
- COLLABORATED_WITH: Entities worked together
- LED: Person led organization/operation

Return a JSON array of relationships:
[
  {{"source": "Adolf Eichmann", "target": "SS", "type": "MEMBER_OF"}},
  {{"source": "SS", "target": "Auschwitz", "type": "ADMINISTERED"}},
  ...
]

RULES:
1. Only use entity names EXACTLY as they appear in the lists above
2. Only include relationships you are historically certain about
3. Prefer specific relationships over vague ones
4. Each relationship should be meaningful for understanding the trial
5. Return ONLY valid JSON array, no explanation

Return at least 5-20 relationships if possible."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a Holocaust historian. Return only valid JSON arrays."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            max_tokens=4000,
        )
        
        result_text = response.choices[0].message.content.strip()
        
        # Clean up response
        if result_text.startswith("```json"):
            result_text = result_text[7:]
        if result_text.startswith("```"):
            result_text = result_text[3:]
        if result_text.endswith("```"):
            result_text = result_text[:-3]
        
        relationships = json.loads(result_text)
        return relationships if isinstance(relationships, list) else []
        
    except Exception as e:
        print(f"   ⚠️ OpenAI error: {e}")
        return []


def main():
    print("=" * 60)
    print("Adding Semantic Relationship Edges with OpenAI")
    print("=" * 60)
    
    # Load current entities
    print("\n📚 Loading entities...")
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    nodes = data["nodes"]
    existing_edges = data["edges"]
    
    print(f"   Nodes: {len(nodes)}")
    print(f"   Existing edges: {len(existing_edges)}")
    
    # Build name -> node lookup
    name_to_node = {}
    for node in nodes:
        name = node.get("name")
        if name:
            name_to_node[name] = node
            # Also index by lowercase for fuzzy matching
            name_to_node[name.lower()] = node
    
    # Get all entity names for reference
    all_names = [n.get("name") for n in nodes if n.get("name")]
    
    # Group entities by type for focused extraction
    entities_by_type = defaultdict(list)
    for node in nodes:
        node_type = node.get("type")
        if node_type not in ("SESSION", "DATE", "TESTIMONY"):
            entities_by_type[node_type].append({
                "name": node.get("name"),
                "type": node_type,
                "isWitness": node.get("isWitness", False),
            })
    
    print("\n📊 Entity counts by type:")
    for t, ents in entities_by_type.items():
        print(f"   {t}: {len(ents)}")
    
    # Extract relationships
    print("\n🔗 Extracting semantic relationships...")
    all_relationships = []
    
    # Process key entity types
    key_types = ["PERSON", "ORGANIZATION", "LOCATION", "EVENT"]
    
    for entity_type in key_types:
        entities = entities_by_type.get(entity_type, [])
        if not entities:
            continue
            
        print(f"\n   Processing {entity_type} ({len(entities)} entities)...")
        
        # Process in batches
        batch_size = 30
        for i in range(0, len(entities), batch_size):
            batch = entities[i:i + batch_size]
            batch_num = i // batch_size + 1
            total_batches = (len(entities) + batch_size - 1) // batch_size
            
            print(f"      Batch {batch_num}/{total_batches}...", end=" ", flush=True)
            
            relationships = extract_relationships_batch(batch, all_names)
            
            if relationships:
                all_relationships.extend(relationships)
                print(f"→ {len(relationships)} relationships")
            else:
                print("→ 0 relationships")
            
            time.sleep(0.5)  # Rate limiting
    
    print(f"\n   Total relationships extracted: {len(all_relationships)}")
    
    # Validate and deduplicate relationships
    print("\n✅ Validating relationships...")
    valid_relationships = []
    seen = set()
    
    for rel in all_relationships:
        source = rel.get("source")
        target = rel.get("target")
        rel_type = rel.get("type")
        
        if not all([source, target, rel_type]):
            continue
        
        # Find nodes (case-insensitive)
        source_node = name_to_node.get(source) or name_to_node.get(source.lower())
        target_node = name_to_node.get(target) or name_to_node.get(target.lower())
        
        if not source_node or not target_node:
            continue
        
        # Create unique key
        key = (source_node["id"], target_node["id"], rel_type)
        if key in seen:
            continue
        seen.add(key)
        
        valid_relationships.append({
            "source_id": source_node["id"],
            "target_id": target_node["id"],
            "source_name": source_node.get("name"),
            "target_name": target_node.get("name"),
            "type": rel_type,
        })
    
    print(f"   Valid relationships: {len(valid_relationships)}")
    
    # Create new edges
    print("\n🔗 Creating new edges...")
    
    # Find max edge ID
    max_edge_id = 0
    for edge in existing_edges:
        edge_id = edge.get("id", "")
        if edge_id.startswith("edge_"):
            try:
                num = int(edge_id.replace("edge_", ""))
                max_edge_id = max(max_edge_id, num)
            except:
                pass
    
    new_edges = []
    edge_id = max_edge_id + 1
    
    for rel in valid_relationships:
        new_edges.append({
            "id": f"edge_{edge_id}",
            "source": rel["source_id"],
            "target": rel["target_id"],
            "type": rel["type"],
            "semantic": True,  # Mark as semantically extracted
        })
        edge_id += 1
    
    print(f"   New semantic edges: {len(new_edges)}")
    
    # Combine edges
    all_edges = existing_edges + new_edges
    
    # Count edge types
    edge_type_counts = defaultdict(int)
    for edge in all_edges:
        edge_type_counts[edge.get("type", "?")] += 1
    
    print("\n📊 Edge type counts:")
    for t, c in sorted(edge_type_counts.items(), key=lambda x: -x[1]):
        print(f"   {t}: {c}")
    
    # Update metadata
    data["metadata"]["totalEdges"] = len(all_edges)
    data["metadata"]["semanticEdgesAdded"] = len(new_edges)
    data["metadata"]["lastUpdated"] = datetime.now().isoformat()
    
    # Save
    data["edges"] = all_edges
    
    print("\n💾 Saving...")
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    print("\n" + "=" * 60)
    print("COMPLETE")
    print("=" * 60)
    print(f"Output: {OUTPUT_FILE}")
    print(f"Total edges: {len(all_edges)} (+{len(new_edges)} new)")
    
    # Show sample relationships
    if valid_relationships:
        print("\n📋 Sample relationships added:")
        for rel in valid_relationships[:15]:
            print(f"   {rel['source_name']} --[{rel['type']}]--> {rel['target_name']}")


if __name__ == "__main__":
    main()
