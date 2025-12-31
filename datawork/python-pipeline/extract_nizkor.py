#!/usr/bin/env python3
"""
Extract entities from Nizkor English transcripts using spaCy NER.
Creates entity graph with proper linkage and English testimonies.
"""

import json
import re
from pathlib import Path
from datetime import datetime
from collections import defaultdict

try:
    import spacy
    from spacy.lang.en import English
except ImportError:
    print("Installing spacy...")
    import subprocess
    subprocess.run(["pip", "install", "spacy"], check=True)
    subprocess.run(["python", "-m", "spacy", "download", "en_core_web_lg"], check=True)
    import spacy

# ============================================================
# ENTITY NORMALIZATION AND DEDUPLICATION
# ============================================================

# Words to strip from entity names
STRIP_PREFIXES = ["the ", "a ", "an ", "this ", "that ", "these ", "those "]
STRIP_SUFFIXES = [" camp", " concentration camp", " ghetto", " extermination camp"]

# Known bad entity extractions to filter out
BAD_ENTITIES = {
    "q", "a", "q.", "a.", ":**", "yes", "no", "court", "the court", 
    "defence counsel", ":** defence counsel", ":** the court",
    "presiding judge", "attorney general", "witness", "dr.", "mr.", "mrs.",
    "honour", "your honour", "honours", "your honours", "prosecution",
    "defense", "defence", "accused", "the accused", "gentlemen",
    "document", "exhibit", "translation", "page", "pages", "volume",
    "session", "sessions", "paragraph", "section", "appendix", "annex",
    "chapter", "part", "item", "number", "date", "time", "year", "month",
    "order", "orders", "law", "laws", "decree", "decrees", "regulation",
    "army", "armies", "authority", "authorities", "bureau", "office",
    "centre", "center", "commission", "committee", "council", "department",
    "government", "ministry", "police", "service", "services", "unit", "units",
    "appell", "aus", "ark", "axis", "allied", "allies", "aliyah",
    "commandant", "commandants", "convention", "community", "church",
    "caesars", "campagnano", "blackstone", "brookhart", "borki", "buczacz",
    "cholm", "commissariat", "burger", "bauchwitz", "bauschewitz",
    # Metadata artifacts from scraping
    "wayback machine", "wayback machine archive", "nizkor", "nizkor project",
    "the nizkor project", "new?·search nizkor", "search nizkor",
    "source", "scraped", "parts", "part 1", "part 2", "part 3", "part 4",
    "previous", "next", "index", "file archived", "eichmann trial",
    "the district court sessions", "district court", "trial of adolf eichmann",
    "the district court sessions **volume", "district court sessions",
}

# Known persons that spaCy might misclassify as ORG
KNOWN_PERSONS = {
    "eichmann", "himmler", "heydrich", "hitler", "goering", "goebbels",
    "kaltenbrunner", "mueller", "ribbentrop", "rosenberg", "frank", "streicher",
    "bormann", "speer", "keitel", "jodl", "raeder", "doenitz", "schirach",
    "sauckel", "frick", "neurath", "papen", "seyss-inquart", "fritzsche",
    "schacht", "funk", "ley", "krupp", "mengele", "hoess", "stangl", "wirth",
    "globocnik", "odilo", "brunner", "alois", "dannecker", "theodor", "novak",
    "franz", "blobel", "paul", "ohlendorf", "otto", "krumey", "hermann",
    "wisliceny", "dieter", "guenther", "rolf", "hunsche", "hoettl", "wilhelm",
    "becher", "kurt", "clages", "gerhard", "mildner", "rudolf", "kastner",
    "rezso", "brand", "joel", "hansi", "grosz", "bandi", "freudiger", "fulop",
    "stern", "samu", "komoly", "otto", "hausner", "gideon", "servatius", "robert",
    "landau", "moshe", "halevi", "benjamin", "raveh", "yitzhak", "less", "avner",
    "antonescu", "abetz", "veesenmayer", "winkelmann", "endre", "baky", "jaross",
    "szalasi", "horthy", "tiso", "quisling", "pavelic", "mussert", "degrelle",
    # More persons often misclassified
    "abromeit", "asche", "boehm", "belev", "baeck", "advocate moissis",
    "bandi grosz", "auswanderung", "central office", "b2b",
}

# Known locations that spaCy might misclassify
KNOWN_LOCATIONS = {
    "auschwitz", "birkenau", "auschwitz-birkenau", "treblinka", "sobibor", 
    "belzec", "chelmno", "majdanek", "dachau", "buchenwald", "bergen-belsen",
    "ravensbrueck", "mauthausen", "sachsenhausen", "theresienstadt", "terezin",
    "warsaw", "lodz", "krakow", "cracow", "lublin", "vilna", "vilnius", "kovno",
    "kaunas", "riga", "minsk", "lvov", "lwow", "lemberg", "budapest", "vienna",
    "prague", "berlin", "munich", "nuremberg", "amsterdam", "paris", "rome",
    "zagreb", "belgrade", "bucharest", "sofia", "athens", "salonika", "thessaloniki",
    "rhodes", "corfu", "tunis", "tripoli", "jerusalem", "tel aviv", "haifa",
    "germany", "poland", "hungary", "czechoslovakia", "austria", "france",
    "netherlands", "holland", "belgium", "italy", "greece", "yugoslavia",
    "romania", "bulgaria", "slovakia", "croatia", "serbia", "denmark", "norway",
    "finland", "estonia", "latvia", "lithuania", "ukraine", "belorussia", "russia",
    "generalgouvernement", "warthegau", "reich", "altreich", "ostmark",
}

# Known organizations
KNOWN_ORGS = {
    "ss", "sa", "gestapo", "sd", "rsha", "kripo", "sipo", "orpo", "waffen-ss",
    "einsatzgruppen", "einsatzkommando", "sonderkommando", "totenkopf",
    "nsdap", "nazi", "reich", "wehrmacht", "luftwaffe", "kriegsmarine",
    "foreign office", "auswärtiges amt", "interior ministry", "justice ministry",
    "judenrat", "jewish council", "kehilla", "kahal", "joint", "jdc",
    "jewish agency", "histadrut", "irgun", "haganah", "lehi", "stern gang",
    "red cross", "icrc", "unrra", "war refugee board", "vaad hatzala",
}


def normalize_entity_name(name):
    """Normalize an entity name for deduplication."""
    if not name:
        return ""
    
    # Basic cleanup
    name = name.strip()
    
    # Remove markdown artifacts
    name = re.sub(r'^\*+', '', name)
    name = re.sub(r'\*+$', '', name)
    name = re.sub(r'^:+', '', name)
    name = re.sub(r'^#+', '', name)
    
    # Remove leading/trailing punctuation
    name = name.strip('.,;:!?()[]{}"\'-')
    
    # Normalize whitespace
    name = re.sub(r'\s+', ' ', name).strip()
    
    return name


def get_canonical_name(name):
    """Get canonical form of entity name for matching."""
    canonical = name.lower().strip()
    
    # Strip common prefixes
    for prefix in STRIP_PREFIXES:
        if canonical.startswith(prefix):
            canonical = canonical[len(prefix):]
    
    return canonical


def is_bad_entity(name):
    """Check if entity should be filtered out."""
    if not name or len(name) < 2:
        return True
    
    canonical = get_canonical_name(name)
    
    # Check bad list
    if canonical in BAD_ENTITIES:
        return True
    
    # Filter out single letters/numbers
    if len(canonical) <= 2 and not canonical.isalpha():
        return True
    
    # Filter out entries that are just punctuation
    if not any(c.isalpha() for c in canonical):
        return True
    
    # Filter out markdown artifacts
    if canonical.startswith(':') or canonical.startswith('*'):
        return True
    
    return False


def consolidate_entities(entities_dict, entity_type):
    """Consolidate and deduplicate entities."""
    consolidated = {}
    canonical_map = {}  # Maps canonical name to best display name
    
    for name, data in entities_dict.items():
        # Clean the name
        clean_name = normalize_entity_name(name)
        
        if is_bad_entity(clean_name):
            continue
        
        canonical = get_canonical_name(clean_name)
        
        # Skip very short names (likely partial extractions)
        if len(canonical) < 4:
            continue
        
        # Check if this is a person misclassified as org
        if entity_type == "organizations":
            if canonical in KNOWN_PERSONS:
                continue
            if canonical in KNOWN_LOCATIONS:
                continue
            # Skip if looks like a person name (single word, capitalized)
            if ' ' not in clean_name and clean_name[0].isupper() and len(clean_name) < 15:
                if canonical not in KNOWN_ORGS:
                    continue
        
        # For locations, filter out person names
        if entity_type == "locations":
            if canonical in KNOWN_PERSONS:
                continue
            # Skip if in bad entities
            if canonical in BAD_ENTITIES:
                continue
        
        # Merge with existing canonical entry
        if canonical in consolidated:
            consolidated[canonical]["mentions"] += data["mentions"]
            consolidated[canonical]["sessions"].update(data["sessions"])
            # Keep the longer/better name
            if len(clean_name) > len(canonical_map[canonical]):
                canonical_map[canonical] = clean_name
        else:
            consolidated[canonical] = {
                "mentions": data["mentions"],
                "sessions": set(data["sessions"]) if isinstance(data["sessions"], (list, set)) else {data["sessions"]},
            }
            canonical_map[canonical] = clean_name
    
    # Convert back to display names
    result = {}
    for canonical, data in consolidated.items():
        display_name = canonical_map[canonical]
        # Capitalize properly
        if display_name.islower():
            display_name = display_name.title()
        result[display_name] = data
    
    return result


def merge_cross_type_duplicates(all_entities):
    """Remove entities that appear in multiple types (keep in correct type)."""
    # Build sets of canonical names by type priority
    location_canonicals = {get_canonical_name(n) for n in all_entities["locations"].keys()}
    
    # Remove locations from orgs
    orgs_to_remove = []
    for name in all_entities["organizations"].keys():
        canonical = get_canonical_name(name)
        if canonical in location_canonicals or canonical in KNOWN_LOCATIONS:
            orgs_to_remove.append(name)
    
    for name in orgs_to_remove:
        # Merge data into location
        canonical = get_canonical_name(name)
        for loc_name, loc_data in all_entities["locations"].items():
            if get_canonical_name(loc_name) == canonical:
                loc_data["mentions"] += all_entities["organizations"][name]["mentions"]
                loc_data["sessions"].update(all_entities["organizations"][name]["sessions"])
                break
        del all_entities["organizations"][name]
    
    # Remove known persons from orgs
    orgs_to_remove = []
    for name in all_entities["organizations"].keys():
        canonical = get_canonical_name(name)
        if canonical in KNOWN_PERSONS:
            orgs_to_remove.append(name)
    
    for name in orgs_to_remove:
        del all_entities["organizations"][name]
    
    return all_entities

# Paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
NIZKOR_DIR = PROJECT_ROOT / "downloads" / "nizkor-transcripts"
WITNESS_INDEX = PROJECT_ROOT / "eichmann-entities" / "witness-index.json"
OUTPUT_DIR = PROJECT_ROOT / "app" / "public" / "data"
TESTIMONIES_EN_DIR = OUTPUT_DIR / "testimonies" / "en"

# Session dates (from previous extraction)
SESSION_DATES = {
    1: "1961-04-11", 2: "1961-04-17", 3: "1961-04-18", 4: "1961-04-19", 5: "1961-04-20",
    6: "1961-04-24", 7: "1961-04-25", 8: "1961-04-25", 9: "1961-04-26", 10: "1961-04-27",
    11: "1961-04-28", 12: "1961-05-01", 13: "1961-05-01", 14: "1961-05-02", 15: "1961-05-02",
    16: "1961-05-03", 17: "1961-05-03", 18: "1961-05-04", 19: "1961-05-04", 20: "1961-05-08",
    21: "1961-05-09", 22: "1961-05-09", 23: "1961-05-10", 24: "1961-05-02", 25: "1961-05-03",
    26: "1961-05-03", 27: "1961-05-04", 28: "1961-05-04", 29: "1961-05-08", 30: "1961-05-09",
    31: "1961-05-10", 32: "1961-05-11", 33: "1961-05-15", 34: "1961-05-16", 35: "1961-05-17",
    36: "1961-05-18", 37: "1961-05-22", 38: "1961-05-23", 39: "1961-05-24", 40: "1961-05-25",
    41: "1961-05-29", 42: "1961-05-30", 43: "1961-05-31", 44: "1961-06-01", 45: "1961-06-05",
    46: "1961-06-06", 47: "1961-06-07", 48: "1961-06-08", 49: "1961-06-12", 50: "1961-06-13",
    51: "1961-06-14", 52: "1961-06-15", 53: "1961-06-19", 54: "1961-06-20", 55: "1961-06-21",
    56: "1961-06-22", 57: "1961-06-26", 58: "1961-06-27", 59: "1961-06-28", 60: "1961-06-29",
    61: "1961-07-03", 62: "1961-07-04", 63: "1961-07-05", 64: "1961-07-06", 65: "1961-07-10",
    66: "1961-07-11", 67: "1961-07-12", 68: "1961-07-13", 69: "1961-07-17", 70: "1961-07-18",
    71: "1961-07-19", 72: "1961-07-20", 73: "1961-07-24", 74: "1961-07-24", 75: "1961-07-25",
    76: "1961-07-26", 77: "1961-07-27", 78: "1961-07-31", 79: "1961-08-01", 80: "1961-08-02",
    81: "1961-08-03", 82: "1961-08-07", 83: "1961-08-08", 84: "1961-08-09", 85: "1961-08-10",
    86: "1961-08-11", 87: "1961-08-14", 88: "1961-08-14", 89: "1961-08-14", 90: "1961-12-11",
    91: "1961-12-11", 92: "1961-12-11", 93: "1961-12-11", 94: "1961-12-11", 95: "1961-12-11",
    96: "1961-12-11", 97: "1961-12-11", 98: "1961-12-12", 99: "1961-12-12", 100: "1961-12-12",
    101: "1961-12-12", 102: "1961-12-12", 103: "1961-12-12", 104: "1961-12-12", 105: "1961-12-12",
    106: "1961-12-13", 107: "1961-12-13", 108: "1961-12-13", 109: "1961-12-13", 110: "1961-12-13",
    111: "1961-12-13", 112: "1961-12-14", 113: "1961-12-14", 114: "1961-12-14", 115: "1961-12-14",
    116: "1961-12-14", 117: "1961-12-14", 118: "1961-12-14", 119: "1961-12-15", 120: "1961-12-15",
    121: "1961-12-15",
}

# Artifacts to remove
ARTIFACT_PATTERNS = [
    r'\[Previous\|Index\|Next\].*',
    r'\[Previous\|Index\].*',
    r'FILE ARCHIVED ON.*',
    r'ALL OTHER CONTENT MAY ALSO BE PROTECTED.*',
    r'playback timings \(ms\):.*',
    r'<!-- Part \d+ -->',
    r'The Trial of Adolf Eichmann Session \d+ \(Part \d+ of \d+\)',
    r'an error occurred while processing this directive',
    # Nizkor metadata
    r'\*\*Source:\*\*\s*Nizkor Project.*',
    r'\*\*Scraped:\*\*.*',
    r'Wayback Machine Archive',
    r'The Nizkor Project',
    r'New\?·Search Nizkor',
    r'Search Nizkor',
    r'The District Court Sessions',
    r'# Eichmann trial - The District Court Sessions',
    # Nizkor website artifacts
    r'INFOLINKS_OFF.*',
    r'Home·Site Map·What\'s.*',
    r'©.*\d{4}.*',
    r'This site is intended for educational purposes.*',
    r'As part of these educational purposes.*',
    r'Far from approving these writings.*',
    r'Nizkor may include on this website.*',
    r'Nizkor condemns them and provides them.*',
    r'Nizkor urges the readers.*',
]

# Known court figures (not witnesses)
COURT_FIGURES = {
    "Hausner", "Gideon Hausner", "Attorney General",
    "Servatius", "Dr. Servatius", "Robert Servatius",
    "Landau", "Moshe Landau", "Presiding Judge",
    "Raveh", "Judge Raveh", "Yitzhak Raveh",
    "Halevi", "Judge Halevi", "Benjamin Halevi",
    "Eichmann", "Adolf Eichmann", "the Accused",
}


def load_spacy_model():
    """Load spaCy model, downloading if needed."""
    try:
        nlp = spacy.load("en_core_web_lg")
    except OSError:
        print("Downloading spaCy model...")
        import subprocess
        subprocess.run(["python", "-m", "spacy", "download", "en_core_web_lg"], check=True)
        nlp = spacy.load("en_core_web_lg")
    
    # Increase max length for long documents
    nlp.max_length = 2000000
    return nlp


def load_witness_index():
    """Load witness index for matching."""
    with open(WITNESS_INDEX, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    witnesses = {}
    for w in data.get("witnesses", []):
        english = w.get("english", "")
        hebrew = w.get("hebrew", "")
        
        # Create search terms - include full names and variants
        search_terms = [english.lower()]
        
        # Add last name
        parts = english.split()
        if len(parts) > 1:
            search_terms.append(parts[-1].lower())  # Last name
        
        # Add ALL variants (these now include English spelling variations)
        for v in w.get("variants", []):
            v_lower = v.lower()
            search_terms.append(v_lower)
            # Also add last word of variant as a search term
            v_parts = v_lower.split()
            if v_parts:
                search_terms.append(v_parts[-1])
        
        # Remove duplicates but keep as list
        search_terms = list(set(search_terms))
        
        witnesses[english] = {
            "hebrew": hebrew,
            "english": english,
            "image": w.get("image", ""),
            "searchTerms": search_terms,
            "sessions": set(),
            "testimony_en": None,
        }
    
    return witnesses


def clean_text(text):
    """Remove artifacts from transcript text."""
    for pattern in ARTIFACT_PATTERNS:
        text = re.sub(pattern, '', text, flags=re.IGNORECASE)
    
    # Remove multiple blank lines
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def parse_session_file(filepath):
    """Parse a session transcript file."""
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Extract metadata from header
    session_match = re.search(r'\*\*Session:\*\*\s*(\d+)', content)
    volume_match = re.search(r'\*\*Volume:\*\*\s*(\d+)', content)
    
    session_num = int(session_match.group(1)) if session_match else None
    volume_num = int(volume_match.group(1)) if volume_match else None
    
    # Extract date - look for pattern like "16 Iyar, 5721 (2 May 1961)"
    date_match = re.search(r'\((\d{1,2}\s+\w+\s+\d{4})\)', content)
    date_str = date_match.group(1) if date_match else ""
    
    # Clean content
    content = clean_text(content)
    
    return {
        "session": session_num,
        "volume": volume_num,
        "date": date_str,
        "content": content,
        "filepath": str(filepath),
    }


def extract_witness_testimonies(content, session_num):
    """Extract individual witness testimonies from session content."""
    testimonies = []
    
    # Multiple patterns for witness sworn in / affirmation
    sworn_patterns = [
        r'\[\s*[Tt]he witness is sworn[^\]]*\]',
        r'\[\s*[Tt]he witness was sworn[^\]]*\]',
        r'\[\s*[Tt]he witness makes (?:an |his )?affirmation[^\]]*\]',
        r'\[\s*[Ww]itness is sworn[^\]]*\]',
        r'\[\s*[Ww]itness was sworn[^\]]*\]',
        r'\[\s*[Ww]itness makes (?:an |his )?affirmation[^\]]*\]',
        # Pattern with witness name: [Witness X is sworn]
        r'\[\s*[Ww]itness\s+[A-Z][a-zA-Z\-]+\s+is sworn[^\]]*\]',
        r'\[\s*[Ww]itness\s+[A-Z][a-zA-Z\-]+\s+was sworn[^\]]*\]',
        # Pattern with Mr./Mrs./Dr.: [Mr. X is sworn]
        r'\[\s*(?:Mr\.|Mrs\.|Dr\.)\s*[A-Z][a-zA-Z\-]+\s+is sworn[^\]]*\]',
        r'\[\s*(?:Mr\.|Mrs\.|Dr\.)\s*[A-Z][a-zA-Z\-]+\s+was sworn[^\]]*\]',
        # Affirmation patterns (alternative to oath)
        r'\[\s*[Tt]he witness affirms[^\]]*\]',
        r'\[\s*[Ww]itness affirms[^\]]*\]',
        # Without brackets - less common but exists
        r'(?:^|\n)The witness is sworn\.(?:\s*\n)',
        r'(?:^|\n)The witness was sworn\.(?:\s*\n)',
        r'(?:^|\n)The witness affirms\.(?:\s*\n)',
        r'(?:^|\n)Witness affirms\.(?:\s*\n)',
        r'(?:^|\n)Witness is sworn\.(?:\s*\n)',
    ]
    
    # Combined pattern
    combined_pattern = '|'.join(f'({p})' for p in sworn_patterns)
    
    # Find all sworn-in positions
    sworn_matches = list(re.finditer(combined_pattern, content, re.IGNORECASE))
    
    for i, match in enumerate(sworn_matches):
        # Get text after sworn-in until next sworn-in or end
        start_pos = match.end()
        if i + 1 < len(sworn_matches):
            end_pos = sworn_matches[i + 1].start()
        else:
            end_pos = len(content)
        
        testimony_text = content[start_pos:end_pos]
        
        # Look for testimony end markers and truncate there
        end_patterns = [
            r'\*\*Presiding Judge:\*\*.*?(?:you have concluded your testimony|Thank you.*?you have concluded)',
            r'\*\*Presiding Judge:\*\*.*?Thank you,? (?:Mr\.|Mrs\.|Dr\.|Miss).*?\.(?:\s*\n)',
        ]
        for end_pattern in end_patterns:
            end_match = re.search(end_pattern, testimony_text, re.IGNORECASE | re.DOTALL)
            if end_match:
                # Include the end marker but nothing after
                testimony_text = testimony_text[:end_match.end()]
                break
        
        # Extract witness name - multiple patterns
        witness_name = None
        
        # Pattern 1: **Witness:** [My name is] X. - handle Dr./Prof. prefixes
        name_match = re.search(r'\*\*Witness:\*\*\s*(?:My name is\s+)?(?:Dr\.\s+|Prof\.\s+|Mr\.\s+|Mrs\.\s+)?([A-Z][a-zA-Z\s\-\']+(?:\s+[A-Z][a-zA-Z\-\']+)+)[\.\s]', testimony_text[:1500])
        if name_match:
            witness_name = name_match.group(1).strip()
        
        # Pattern 1b: Handle "Dr. FirstName LastName" format
        if not witness_name:
            name_match = re.search(r'\*\*Witness:\*\*\s*(?:My name is\s+)?(Dr\.\s+[A-Z][a-zA-Z]+\s+[A-Z][a-zA-Z\s\-\']+)', testimony_text[:1500])
            if name_match:
                witness_name = name_match.group(1).strip()
        
        # Pattern 2: **Presiding Judge:** Your name? **Witness/A:** X
        if not witness_name:
            name_match = re.search(r'(?:Your (?:full |first )?name\?|What is (?:your|his|her) (?:full |first )?name\?)[^\*]*\*\*(?:Witness[^\*]*|A)\.?\*\*:?\s*(?:My name is\s+)?(?:Dr\.\s+|Prof\.\s+)?([A-Z][a-zA-Z\s\-\']+(?:\s+[A-Z][a-zA-Z\-\']+)+)', testimony_text[:2000])
            if name_match:
                witness_name = name_match.group(1).strip()
        
        # Pattern 2b: Handle Dr. prefix in answer
        if not witness_name:
            name_match = re.search(r'(?:Your (?:full |first )?name\?|What is (?:your|his|her) (?:full |first )?name\?)[^\*]*\*\*(?:Witness[^\*]*|A)\.?\*\*:?\s*(Dr\.\s+[A-Z][a-zA-Z]+\s+[A-Z][a-zA-Z\s\-\']+)', testimony_text[:2000])
            if name_match:
                witness_name = name_match.group(1).strip()
        
        # Pattern 3: **Witness X:** (first occurrence after sworn in)
        if not witness_name:
            name_match = re.search(r'\*\*Witness\s+([A-Z][a-zA-Z\.\s\-\']+?):\*\*', testimony_text[:2000])
            if name_match:
                witness_name = name_match.group(1).strip()
        
        # Pattern 4: Look before sworn-in for "I call [witness] X"
        if not witness_name and match.start() > 0:
            pre_text = content[max(0, match.start()-500):match.start()]
            call_match = re.search(r'I (?:now )?call(?:\s+(?:the\s+)?witness)?\s+(?:Mr\.\s+|Mrs\.\s+|Dr\.\s+|Prof\.\s+)?([A-Z][a-zA-Z\.\s\-\']+?)(?:\.|,|\n)', pre_text)
            if call_match:
                witness_name = call_match.group(1).strip()
        
        if witness_name:
            # Clean up name
            witness_name = re.sub(r'\s+', ' ', witness_name)
            # Remove trailing periods or titles
            witness_name = witness_name.rstrip('.')
            # Remove trailing parts like "- my name was...", "- originally...", etc.
            witness_name = re.sub(r'\s*[-–]\s*(?:my name|originally|née|nee|now|formerly|previously).*', '', witness_name, flags=re.IGNORECASE)
            # Remove "nee/née X" suffix (maiden name)
            witness_name = re.sub(r'\s+(?:née|nee)\s+\w+$', '', witness_name, flags=re.IGNORECASE)
            # Also remove any text after dashes followed by lowercase (likely explanations)
            witness_name = re.sub(r'\s*[-–]\s+[a-z].*', '', witness_name)
            witness_name = witness_name.strip()
            # Skip if it's just "Yes" or "No" or other non-names
            if witness_name.lower() not in ('yes', 'no', 'i do', 'i will', 'that is correct'):
                testimonies.append({
                    "name": witness_name,
                    "session": session_num,
                    "text": testimony_text.strip(),
                })
    
    return testimonies


def extract_entities_spacy(nlp, text, session_num):
    """Extract entities using spaCy NER."""
    # Process in chunks if text is very long
    max_chunk = 100000
    entities = {
        "persons": defaultdict(lambda: {"mentions": 0, "sessions": set()}),
        "locations": defaultdict(lambda: {"mentions": 0, "sessions": set()}),
        "organizations": defaultdict(lambda: {"mentions": 0, "sessions": set()}),
        "events": defaultdict(lambda: {"mentions": 0, "sessions": set()}),
        "dates": defaultdict(lambda: {"mentions": 0, "sessions": set()}),
    }
    
    # Process text in chunks
    for i in range(0, len(text), max_chunk):
        chunk = text[i:i+max_chunk]
        doc = nlp(chunk)
        
        for ent in doc.ents:
            name = ent.text.strip()
            
            # Skip very short or very long entities
            if len(name) < 2 or len(name) > 100:
                continue
            
            # Skip entities that are just numbers or punctuation
            if not any(c.isalpha() for c in name):
                continue
            
            if ent.label_ == "PERSON":
                entities["persons"][name]["mentions"] += 1
                entities["persons"][name]["sessions"].add(session_num)
            
            elif ent.label_ in ("GPE", "LOC", "FAC"):
                entities["locations"][name]["mentions"] += 1
                entities["locations"][name]["sessions"].add(session_num)
            
            elif ent.label_ == "ORG":
                entities["organizations"][name]["mentions"] += 1
                entities["organizations"][name]["sessions"].add(session_num)
            
            elif ent.label_ == "EVENT":
                entities["events"][name]["mentions"] += 1
                entities["events"][name]["sessions"].add(session_num)
            
            elif ent.label_ == "DATE":
                entities["dates"][name]["mentions"] += 1
                entities["dates"][name]["sessions"].add(session_num)
    
    return entities


def match_witness_to_index(name, witness_index):
    """Try to match extracted witness name to witness index - STRICT matching only."""
    if not name:
        return None
    
    name_lower = name.lower().strip()
    name_parts = name_lower.split()
    
    # Get last name for matching
    last_name = name_parts[-1] if name_parts else ""
    
    # 1. Try exact full name match first
    for english, data in witness_index.items():
        if english.lower() == name_lower:
            return english
    
    # 2. Try matching full name in search terms (includes variants)
    for english, data in witness_index.items():
        if name_lower in data["searchTerms"]:
            return english
    
    # 3. Try matching any variant exactly
    for english, data in witness_index.items():
        for term in data["searchTerms"]:
            if term == name_lower:
                return english
    
    # 4. Check if last name matches a variant exactly (stricter)
    if last_name and len(last_name) >= 4:  # Require at least 4 chars
        matches = []
        for english, data in witness_index.items():
            for term in data["searchTerms"]:
                # Only match if variant is exactly the last name
                if term == last_name:
                    matches.append(english)
                    break
        if len(matches) == 1:
            return matches[0]
    
    # 5. If we have first and last name, match both strictly
    if len(name_parts) >= 2:
        first_name = name_parts[0]
        
        for english, data in witness_index.items():
            english_lower = english.lower()
            english_parts = english_lower.split()
            
            if len(english_parts) >= 2:
                eng_first = english_parts[0]
                eng_last = english_parts[-1]
                
                # Both first AND last must match (at least partially)
                first_match = (first_name == eng_first or 
                              first_name.startswith(eng_first) or 
                              eng_first.startswith(first_name))
                last_match = (last_name == eng_last)
                
                if first_match and last_match:
                    return english
            
            # Also check variants with both names
            for term in data["searchTerms"]:
                term_parts = term.split()
                if len(term_parts) >= 2:
                    if first_name == term_parts[0] and last_name == term_parts[-1]:
                        return english
    
    # 6. Last resort: exact last name match in English name (unique only)
    if last_name and len(last_name) >= 5:  # Require longer names
        matches = []
        for english, data in witness_index.items():
            english_parts = english.lower().split()
            if english_parts and english_parts[-1] == last_name:
                matches.append(english)
        if len(matches) == 1:
            return matches[0]
    
    # No match found - return None instead of false positive
    return None


def get_phase(session_num):
    """Get trial phase for a session number."""
    if session_num <= 6:
        return "Opening"
    elif session_num <= 89:
        return "Prosecution Evidence"
    elif session_num <= 105:
        return "Defense"
    elif session_num <= 111:
        return "Prosecution Rebuttal"
    elif session_num <= 114:
        return "Closing Arguments"
    elif session_num <= 120:
        return "Judgment"
    else:
        return "Sentence"


def save_testimony(witness_name, testimony_text, session_num):
    """Save English testimony to file."""
    TESTIMONIES_EN_DIR.mkdir(parents=True, exist_ok=True)
    
    # Create safe filename
    safe_name = re.sub(r'[^\w\s\-]', '', witness_name)
    safe_name = safe_name.replace(' ', '_')
    filename = f"{safe_name}.md"
    filepath = TESTIMONIES_EN_DIR / filename
    
    # Clean testimony text - only remove artifacts, keep full testimony
    cleaned_text = testimony_text
    
    # Remove Nizkor website artifacts
    cleaned_text = re.sub(r'INFOLINKS_OFF.*?\n', '', cleaned_text, flags=re.IGNORECASE)
    cleaned_text = re.sub(r'Home·Site Map.*?\n', '', cleaned_text, flags=re.IGNORECASE)
    cleaned_text = re.sub(r'©.*?\d{4}.*?\n', '', cleaned_text)
    cleaned_text = re.sub(r'This site is intended for educational purposes.*?\n', '', cleaned_text, flags=re.IGNORECASE)
    cleaned_text = re.sub(r'As part of these educational purposes.*?antisemitic discourse\.', '', cleaned_text, flags=re.IGNORECASE | re.DOTALL)
    cleaned_text = re.sub(r'Nizkor urges the readers.*?manifestations\.', '', cleaned_text, flags=re.IGNORECASE | re.DOTALL)
    cleaned_text = re.sub(r'Far from approving these writings.*?hatred\.', '', cleaned_text, flags=re.IGNORECASE | re.DOTALL)
    
    # Remove multiple separators
    cleaned_text = re.sub(r'(\s*---\s*\n){2,}', '\n---\n\n', cleaned_text)
    
    # Remove multiple blank lines
    cleaned_text = re.sub(r'\n{3,}', '\n\n', cleaned_text)
    cleaned_text = cleaned_text.strip()
    
    # Format testimony
    content = f"""# Testimony of {witness_name}

**Session:** {session_num}

---

{cleaned_text}
"""
    
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)
    
    return f"/data/testimonies/en/{filename}"


def build_graph(all_sessions, all_entities, witness_index, all_testimonies):
    """Build the entity graph with all nodes and edges."""
    nodes = []
    edges = []
    node_id = 1
    
    # Track entity IDs for edge creation
    entity_id_map = {}
    
    # === WITNESS NODES ===
    print(f"\n📋 Processing {len(witness_index)} witnesses from index...")
    
    for english, data in witness_index.items():
        sessions = sorted(data.get("sessions", set()))
        
        node = {
            "id": f"witness_{node_id}",
            "type": "PERSON",
            "name": english,
            "hebrewName": data.get("hebrew", ""),
            "englishName": english,
            "isWitness": True,
            "role": "Witness",
            "sessions": sessions,
            "mentions": len(sessions),
            "image": data.get("image", ""),
            "testimony": {
                "he": f"/data/testimonies/{english.replace(' ', '_')}.md",
                "en": data.get("testimony_en", ""),
            }
        }
        
        nodes.append(node)
        entity_id_map[f"witness:{english.lower()}"] = f"witness_{node_id}"
        node_id += 1
    
    # === PERSON NODES (non-witnesses) ===
    print(f"📋 Processing {len(all_entities['persons'])} persons...")
    
    for name, data in all_entities["persons"].items():
        # Skip if already a witness
        if any(name.lower() in w.lower() or w.lower() in name.lower() for w in witness_index.keys()):
            continue
        
        # Skip court figures as separate handling
        if any(cf.lower() in name.lower() for cf in COURT_FIGURES):
            continue
        
        # Skip low-mention entities
        if data["mentions"] < 2:
            continue
        
        sessions = sorted(data["sessions"])
        
        node = {
            "id": f"person_{node_id}",
            "type": "PERSON",
            "name": name,
            "isWitness": False,
            "role": "Mentioned Person",
            "sessions": sessions,
            "mentions": data["mentions"],
        }
        
        nodes.append(node)
        entity_id_map[f"person:{name.lower()}"] = f"person_{node_id}"
        node_id += 1
    
    # === KEY FIGURES (court participants) ===
    key_figures = {
        "Adolf Eichmann": {"role": "Defendant", "sessions": set()},
        "Gideon Hausner": {"role": "Attorney General", "sessions": set()},
        "Robert Servatius": {"role": "Defense Counsel", "sessions": set()},
        "Moshe Landau": {"role": "Presiding Judge", "sessions": set()},
        "Benjamin Halevi": {"role": "Judge", "sessions": set()},
        "Yitzhak Raveh": {"role": "Judge", "sessions": set()},
    }
    
    # Collect sessions for key figures
    for name, data in all_entities["persons"].items():
        for kf_name in key_figures.keys():
            if kf_name.lower() in name.lower() or name.lower() in kf_name.lower():
                key_figures[kf_name]["sessions"].update(data["sessions"])
    
    for name, data in key_figures.items():
        sessions = sorted(data["sessions"]) if data["sessions"] else list(range(1, 122))
        
        node = {
            "id": f"figure_{node_id}",
            "type": "PERSON",
            "name": name,
            "isWitness": False,
            "role": data["role"],
            "sessions": sessions,
            "mentions": len(sessions),
        }
        
        nodes.append(node)
        entity_id_map[f"figure:{name.lower()}"] = f"figure_{node_id}"
        node_id += 1
    
    # === LOCATION NODES ===
    print(f"📍 Processing {len(all_entities['locations'])} locations...")
    
    for name, data in all_entities["locations"].items():
        # Skip very low mentions
        if data["mentions"] < 3:
            continue
        
        sessions = sorted(data["sessions"])
        
        node = {
            "id": f"location_{node_id}",
            "type": "LOCATION",
            "name": name,
            "sessions": sessions,
            "mentions": data["mentions"],
        }
        
        nodes.append(node)
        entity_id_map[f"location:{name.lower()}"] = f"location_{node_id}"
        node_id += 1
    
    # === ORGANIZATION NODES ===
    print(f"🏛️ Processing {len(all_entities['organizations'])} organizations...")
    
    for name, data in all_entities["organizations"].items():
        if data["mentions"] < 3:
            continue
        
        sessions = sorted(data["sessions"])
        
        node = {
            "id": f"org_{node_id}",
            "type": "ORGANIZATION",
            "name": name,
            "sessions": sessions,
            "mentions": data["mentions"],
        }
        
        nodes.append(node)
        entity_id_map[f"org:{name.lower()}"] = f"org_{node_id}"
        node_id += 1
    
    # === EVENT NODES ===
    print(f"📅 Processing {len(all_entities['events'])} events...")
    
    for name, data in all_entities["events"].items():
        if data["mentions"] < 2:
            continue
        
        sessions = sorted(data["sessions"])
        
        node = {
            "id": f"event_{node_id}",
            "type": "EVENT",
            "name": name,
            "sessions": sessions,
            "mentions": data["mentions"],
        }
        
        nodes.append(node)
        entity_id_map[f"event:{name.lower()}"] = f"event_{node_id}"
        node_id += 1
    
    # === TESTIMONY NODES ===
    print(f"📜 Processing {len(all_testimonies)} testimonies...")
    
    for testimony in all_testimonies:
        witness_name = testimony["witness"]
        witness_key = f"witness:{witness_name.lower()}"
        witness_id = entity_id_map.get(witness_key)
        
        node = {
            "id": f"testimony_{node_id}",
            "type": "TESTIMONY",
            "name": f"Testimony of {witness_name}",
            "witnessId": witness_id,
            "witnessName": witness_name,
            "session": testimony["session"],
            "filePath": testimony["file_path"],
            "language": "en",
        }
        
        nodes.append(node)
        entity_id_map[f"testimony:{witness_name.lower()}"] = f"testimony_{node_id}"
        node_id += 1
    
    # === SESSION NODES ===
    print(f"⚖️ Creating 121 session nodes...")
    
    # Build session entity maps
    session_entity_map = defaultdict(lambda: {"witnesses": [], "persons": [], "locations": [], "orgs": [], "events": [], "testimonies": []})
    
    for node in nodes:
        for s in node.get("sessions", []):
            if node.get("isWitness"):
                session_entity_map[s]["witnesses"].append(node["id"])
            elif node.get("type") == "PERSON":
                session_entity_map[s]["persons"].append(node["id"])
            elif node.get("type") == "LOCATION":
                session_entity_map[s]["locations"].append(node["id"])
            elif node.get("type") == "ORGANIZATION":
                session_entity_map[s]["orgs"].append(node["id"])
            elif node.get("type") == "EVENT":
                session_entity_map[s]["events"].append(node["id"])
        
        if node.get("type") == "TESTIMONY":
            session_entity_map[node.get("session", 0)]["testimonies"].append(node["id"])
    
    for session_num in range(1, 122):
        date_str = SESSION_DATES.get(session_num, "")
        day = ""
        if date_str:
            try:
                date_obj = datetime.strptime(date_str, "%Y-%m-%d")
                day = date_obj.strftime("%A")
            except:
                pass
        
        entity_data = session_entity_map.get(session_num, {})
        
        node = {
            "id": f"session-{session_num}",
            "type": "SESSION",
            "name": f"Session {session_num}",
            "number": session_num,
            "date": date_str,
            "day": day,
            "phase": get_phase(session_num),
            "witnessIds": entity_data.get("witnesses", []),
            "personIds": entity_data.get("persons", []),
            "locationIds": entity_data.get("locations", []),
            "orgIds": entity_data.get("orgs", []),
            "eventIds": entity_data.get("events", []),
            "testimonyIds": entity_data.get("testimonies", []),
        }
        
        nodes.append(node)
    
    # === DATE NODES ===
    # Create a DATE node for each unique session date
    unique_dates = set()
    session_date_map = {}  # session_num -> date_id
    
    for session_num in range(1, 122):
        date_str = SESSION_DATES.get(session_num, "")
        if date_str:
            unique_dates.add(date_str)
            session_date_map[session_num] = f"date-{date_str}"
    
    for date_str in sorted(unique_dates):
        try:
            date_obj = datetime.strptime(date_str, "%Y-%m-%d")
            formatted = date_obj.strftime("%B %d, %Y")
            day = date_obj.strftime("%A")
        except:
            formatted = date_str
            day = ""
        
        nodes.append({
            "id": f"date-{date_str}",
            "type": "DATE",
            "name": formatted,
            "date": date_str,
            "day": day,
            "year": date_str[:4] if date_str else "",
            "month": date_str[5:7] if date_str else "",
        })
        entity_id_map[f"date:{date_str}"] = f"date-{date_str}"
    
    # Add trial period summary node
    nodes.append({
        "id": "date-trial-period",
        "type": "DATE",
        "name": "Trial Period: April 11, 1961 - December 15, 1961",
        "startDate": "1961-04-11",
        "endDate": "1961-12-15",
        "isSummary": True,
    })
    
    # === BUILD EDGES ===
    print("\n🔗 Building edges...")
    edge_id = 1
    
    for node in nodes:
        node_type = node.get("type")
        
        if node_type == "SESSION" or node_type == "DATE":
            continue
        
        sessions = node.get("sessions", [])
        if not sessions:
            if node_type == "TESTIMONY":
                sessions = [node.get("session")]
            else:
                continue
        
        # Determine edge type
        if node.get("isWitness"):
            edge_type = "TESTIFIED_IN"
        elif node_type == "TESTIMONY":
            edge_type = "RECORDED_IN"
        else:
            edge_type = "MENTIONED_IN"
        
        for session_num in sessions:
            if session_num:
                edges.append({
                    "id": f"edge_{edge_id}",
                    "source": node["id"],
                    "target": f"session-{session_num}",
                    "type": edge_type,
                })
                edge_id += 1
        
        # Link testimony to witness
        if node_type == "TESTIMONY" and node.get("witnessId"):
            edges.append({
                "id": f"edge_{edge_id}",
                "source": node["id"],
                "target": node["witnessId"],
                "type": "TESTIMONY_OF",
            })
            edge_id += 1
    
    # === SESSION -> DATE edges ===
    for session_num in range(1, 122):
        date_id = session_date_map.get(session_num)
        if date_id:
            edges.append({
                "id": f"edge_{edge_id}",
                "source": f"session-{session_num}",
                "target": date_id,
                "type": "OCCURRED_ON",
            })
            edge_id += 1
    
    # === CO-OCCURRENCE EDGES (Inter-entity links) ===
    print("🔗 Building co-occurrence edges...")
    
    # Build session-based co-occurrence map
    session_entities = defaultdict(lambda: {"witnesses": [], "locations": [], "orgs": [], "events": [], "persons": []})
    
    for node in nodes:
        node_type = node.get("type")
        node_id = node.get("id")
        sessions = node.get("sessions", [])
        
        if not sessions:
            continue
        
        for session_num in sessions:
            if node.get("isWitness"):
                session_entities[session_num]["witnesses"].append(node_id)
            elif node_type == "LOCATION":
                session_entities[session_num]["locations"].append(node_id)
            elif node_type == "ORGANIZATION":
                session_entities[session_num]["orgs"].append(node_id)
            elif node_type == "EVENT":
                session_entities[session_num]["events"].append(node_id)
            elif node_type == "PERSON" and not node.get("isWitness"):
                session_entities[session_num]["persons"].append(node_id)
    
    # Track created edges to avoid duplicates
    created_edges = set()
    
    def add_edge_if_new(source, target, edge_type):
        nonlocal edge_id
        edge_key = (source, target, edge_type)
        reverse_key = (target, source, edge_type)
        if edge_key not in created_edges and reverse_key not in created_edges:
            created_edges.add(edge_key)
            edges.append({
                "id": f"edge_{edge_id}",
                "source": source,
                "target": target,
                "type": edge_type,
            })
            edge_id += 1
            return True
        return False
    
    # Create inter-entity edges based on co-occurrence
    for session_num, entities in session_entities.items():
        # WITNESS ↔ LOCATION (ASSOCIATED_WITH)
        for witness_id in entities["witnesses"]:
            for loc_id in entities["locations"][:10]:  # Limit to top 10 per session
                add_edge_if_new(witness_id, loc_id, "ASSOCIATED_WITH")
        
        # WITNESS ↔ ORGANIZATION (ASSOCIATED_WITH)
        for witness_id in entities["witnesses"]:
            for org_id in entities["orgs"][:5]:  # Limit to top 5
                add_edge_if_new(witness_id, org_id, "ASSOCIATED_WITH")
        
        # WITNESS ↔ EVENT (WITNESSED)
        for witness_id in entities["witnesses"]:
            for event_id in entities["events"]:
                add_edge_if_new(witness_id, event_id, "WITNESSED")
        
        # EVENT ↔ LOCATION (OCCURRED_AT)
        for event_id in entities["events"]:
            for loc_id in entities["locations"][:5]:
                add_edge_if_new(event_id, loc_id, "OCCURRED_AT")
        
        # ORGANIZATION ↔ LOCATION (OPERATED_IN)
        for org_id in entities["orgs"][:5]:
            for loc_id in entities["locations"][:5]:
                add_edge_if_new(org_id, loc_id, "OPERATED_IN")
        
        # PERSON ↔ ORGANIZATION (MEMBER_OF) - for key figures
        for person_id in entities["persons"][:5]:
            for org_id in entities["orgs"][:3]:
                add_edge_if_new(person_id, org_id, "MEMBER_OF")
    
    print(f"   Created {len(created_edges)} co-occurrence edges")
    
    # Count stats
    type_counts = defaultdict(int)
    for node in nodes:
        type_counts[node.get("type", "?")] += 1
    
    return {
        "metadata": {
            "generatedAt": datetime.now().isoformat(),
            "totalNodes": len(nodes),
            "totalEdges": len(edges),
            "typeCounts": dict(type_counts),
            "source": "extract_nizkor.py (spaCy NER)",
        },
        "nodes": nodes,
        "edges": edges,
    }


def main():
    print("=" * 60)
    print("Nizkor Transcript Entity Extraction (spaCy NER)")
    print("=" * 60)
    
    # Load spaCy model
    print("\n🔧 Loading spaCy model...")
    nlp = load_spacy_model()
    print(f"   Model loaded: {nlp.meta['name']}")
    
    # Load witness index
    print("\n📚 Loading witness index...")
    witness_index = load_witness_index()
    print(f"   {len(witness_index)} witnesses")
    
    # Find all session files
    print("\n📄 Finding session files...")
    session_files = []
    for vol_dir in sorted(NIZKOR_DIR.glob("vol*")):
        for f in sorted(vol_dir.glob("[0-9]*.md")):
            session_files.append(f)
    print(f"   {len(session_files)} files found")
    
    # Process all sessions
    all_sessions = {}
    all_entities = {
        "persons": defaultdict(lambda: {"mentions": 0, "sessions": set()}),
        "locations": defaultdict(lambda: {"mentions": 0, "sessions": set()}),
        "organizations": defaultdict(lambda: {"mentions": 0, "sessions": set()}),
        "events": defaultdict(lambda: {"mentions": 0, "sessions": set()}),
        "dates": defaultdict(lambda: {"mentions": 0, "sessions": set()}),
    }
    all_testimonies = []
    
    print("\n🔍 Extracting entities from sessions...")
    
    for filepath in session_files:
        # Parse session file
        session_data = parse_session_file(filepath)
        session_num = session_data["session"]
        
        if not session_num:
            print(f"   ⚠️ Skipping {filepath.name} - no session number")
            continue
        
        all_sessions[session_num] = session_data
        
        print(f"   Session {session_num:3d}...", end=" ", flush=True)
        
        # Extract witness testimonies
        testimonies = extract_witness_testimonies(session_data["content"], session_num)
        
        for testimony in testimonies:
            # Try to match to witness index
            matched_name = match_witness_to_index(testimony["name"], witness_index)
            
            if matched_name:
                # Update witness sessions
                witness_index[matched_name]["sessions"].add(session_num)
                
                # Only create one testimony per witness (deduplicate)
                existing_testimony = [t for t in all_testimonies if t["witness"] == matched_name]
                if not existing_testimony:
                    # Save testimony (first occurrence)
                    file_path = save_testimony(matched_name, testimony["text"], session_num)
                    witness_index[matched_name]["testimony_en"] = file_path
                    
                    all_testimonies.append({
                        "witness": matched_name,
                        "session": session_num,
                        "file_path": file_path,
                    })
        
        # Extract entities using spaCy
        entities = extract_entities_spacy(nlp, session_data["content"], session_num)
        
        # Merge entities
        for name, data in entities["persons"].items():
            all_entities["persons"][name]["mentions"] += data["mentions"]
            all_entities["persons"][name]["sessions"].update(data["sessions"])
        
        for name, data in entities["locations"].items():
            all_entities["locations"][name]["mentions"] += data["mentions"]
            all_entities["locations"][name]["sessions"].update(data["sessions"])
        
        for name, data in entities["organizations"].items():
            all_entities["organizations"][name]["mentions"] += data["mentions"]
            all_entities["organizations"][name]["sessions"].update(data["sessions"])
        
        for name, data in entities["events"].items():
            all_entities["events"][name]["mentions"] += data["mentions"]
            all_entities["events"][name]["sessions"].update(data["sessions"])
        
        print(f"👤 {len(testimonies)} witnesses, 📍 {len(entities['locations'])} locs, 🏛️ {len(entities['organizations'])} orgs")
    
    # Consolidate and deduplicate entities
    print("\n🔄 Consolidating entities...")
    print(f"   Before: {len(all_entities['locations'])} locs, {len(all_entities['organizations'])} orgs, {len(all_entities['persons'])} persons")
    
    all_entities["locations"] = consolidate_entities(all_entities["locations"], "locations")
    all_entities["organizations"] = consolidate_entities(all_entities["organizations"], "organizations")
    all_entities["persons"] = consolidate_entities(all_entities["persons"], "persons")
    all_entities["events"] = consolidate_entities(all_entities["events"], "events")
    
    # Cross-type deduplication
    all_entities = merge_cross_type_duplicates(all_entities)
    
    print(f"   After:  {len(all_entities['locations'])} locs, {len(all_entities['organizations'])} orgs, {len(all_entities['persons'])} persons")
    
    # Build graph
    print("\n🏗️ Building graph...")
    graph = build_graph(all_sessions, all_entities, witness_index, all_testimonies)
    
    # Validation
    print("\n✅ Validation:")
    witness_nodes = [n for n in graph["nodes"] if n.get("isWitness")]
    print(f"   Witnesses: {len(witness_nodes)}/108")
    print(f"   Sessions: {len([n for n in graph['nodes'] if n.get('type') == 'SESSION'])}")
    print(f"   Testimonies: {len([n for n in graph['nodes'] if n.get('type') == 'TESTIMONY'])}")
    print(f"   Locations: {len([n for n in graph['nodes'] if n.get('type') == 'LOCATION'])}")
    print(f"   Organizations: {len([n for n in graph['nodes'] if n.get('type') == 'ORGANIZATION'])}")
    
    # Save output
    print("\n💾 Saving...")
    output_file = OUTPUT_DIR / "entities-consolidated.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(graph, f, indent=2, ensure_ascii=False, default=str)
    
    print("\n" + "=" * 60)
    print("COMPLETE")
    print("=" * 60)
    print(f"Output: {output_file}")
    print(f"Nodes: {graph['metadata']['totalNodes']}")
    print(f"Edges: {graph['metadata']['totalEdges']}")
    for t, c in sorted(graph['metadata']['typeCounts'].items()):
        print(f"  {t}: {c}")


if __name__ == "__main__":
    main()
