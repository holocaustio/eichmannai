# The Eichmann Trial Digital Archive Project
## Technical Documentation & Journey

**A comprehensive technical documentation of building a digital archive of the Eichmann Trial testimonies**

*Prepared for National Holocaust Remembrance Day Presentation*

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Phase 1: Web Scraping & Data Acquisition](#phase-1-web-scraping--data-acquisition)
3. [Phase 2: PDF Processing & OCR Challenges](#phase-2-pdf-processing--ocr-challenges)
4. [Phase 3: Text Extraction Approaches](#phase-3-text-extraction-approaches)
5. [Phase 4: Entity Extraction & NER](#phase-4-entity-extraction--ner)
6. [Phase 5: Testimony Extraction Pipeline](#phase-5-testimony-extraction-pipeline)
7. [Phase 6: English Transcripts from Nizkor Project](#phase-6-english-transcripts-from-nizkor-project)
8. [Technical Challenges & Solutions](#technical-challenges--solutions)
9. [Technologies & Libraries Used](#technologies--libraries-used)
10. [Final Results & Statistics](#final-results--statistics)
11. [Lessons Learned](#lessons-learned)

---

## Project Overview

### Goal
To create a digital, searchable archive of all 108 witness testimonies from the Adolf Eichmann trial (1961) - the first trial to be fully televised, and a pivotal moment in Holocaust education and documentation.

### The Historical Significance
The Eichmann trial was groundbreaking:
- First trial broadcast globally on television
- 108 Holocaust survivors testified publicly
- Over 1,500 documents submitted as evidence
- 121 court sessions spanning April-August 1961
- Created a permanent historical record in Hebrew

### The Challenge
The trial transcripts exist primarily as scanned PDFs in Hebrew, spread across multiple volumes totaling over 100,000 pages. No structured, searchable database of individual testimonies existed.

### Our Mission
Extract, structure, and present each of the 108 witness testimonies in a modern, accessible web interface - preserving the voices of survivors for future generations.

---

## Phase 1: Web Scraping & Data Acquisition

### Initial Discovery

**Source**: Yad Vashem's digital archives and the Israel State Archives

We began by identifying where the trial materials were stored:
- PDFs hosted on government archive servers
- Multiple volumes (Vol 1-4) covering sessions 1-121
- Files ranging from 50MB to 200MB each

### Web Scraping Approach

#### Tools Used
- **Node.js** with custom scrapers
- **Puppeteer** for dynamic page rendering
- **Axios** for direct HTTP requests

#### What We Built
```javascript
// Example: PDF discovery and download script
const downloadPDFs = async () => {
  const baseUrl = 'https://www.archives.gov.il/...';
  const volumes = ['vol1', 'vol2', 'vol3', 'vol4'];
  
  for (const vol of volumes) {
    // Navigate, find PDF links, download
  }
};
```

#### Challenges Encountered
1. **Rate Limiting**: Archive servers blocked rapid requests
   - Solution: Implemented delays and retry logic
   
2. **Session-based Authentication**: Some files required session cookies
   - Solution: Used Puppeteer to simulate browser sessions
   
3. **Incomplete Listings**: Not all PDFs were linked from main pages
   - Solution: Pattern-based URL generation for missing files

### Files Acquired
| Volume | Sessions | Pages | Size |
|--------|----------|-------|------|
| Vol 1 (Part 1) | 1-14 | ~3,000 | 85MB |
| Vol 1 (Part 2) | 15-29 | ~4,500 | 120MB |
| Vol 1 (Part 3) | 30-40 | ~3,200 | 95MB |
| Vol 2 (Part 1) | 41-54 | ~3,800 | 110MB |
| Vol 2 (Part 2) | 55-64 | ~2,500 | 75MB |
| Vol 2 (Part 3) | 65-75 | ~3,000 | 90MB |
| Vol 3 | 76-100 | ~4,000 | 115MB |
| Vol 3 (Continued) | 101-121 | ~3,500 | 105MB |

---

## Phase 2: PDF Processing & OCR Challenges

### The PDF Problem

The trial transcripts presented unique challenges:

1. **Scanned Documents**: Not native digital text
2. **Hebrew Text**: Right-to-left language with complex typography
3. **Multi-Column Layouts**: Court transcripts often in 2 columns
4. **Mixed Content**: Hebrew, English, German, document numbers
5. **Varying Quality**: Some pages clear, others degraded

### OCR Attempts

#### Attempt 1: Tesseract OCR
```bash
tesseract input.pdf output -l heb
```

**Results**: 
- ❌ Poor Hebrew recognition
- ❌ Column text merged incorrectly
- ❌ Many gibberish characters

#### Attempt 2: Adobe Acrobat OCR
**Results**:
- ✅ Better Hebrew recognition
- ❌ Still struggled with columns
- ❌ Expensive for batch processing

#### Attempt 3: Google Cloud Vision API
```python
from google.cloud import vision

def ocr_pdf_page(page_image):
    client = vision.ImageAnnotatorClient()
    response = client.text_detection(image=page_image)
    return response.text_annotations[0].description
```

**Results**:
- ✅ Good Hebrew recognition
- ❌ Expensive at scale ($1.50 per 1000 pages)
- ❌ Column handling still problematic

#### Attempt 4: Google Document AI - Layout Parser
```python
from google.cloud import documentai

def process_with_layout(pdf_path):
    processor = documentai.DocumentProcessorServiceClient()
    # Use layout parser for column detection
```

**Results**:
- ✅ Column detection worked
- ✅ Good structural understanding
- ❌ Very expensive ($0.01 per page = $1000+ for all files)
- ❌ API quotas limiting

### The Breakthrough: Embedded Text Discovery

After multiple failed OCR attempts, we discovered something crucial:

```bash
pdftotext -layout vol1.pdf vol1.txt
```

**The PDFs already contained embedded text!**

The scanned documents had been OCR'd at some point and the text was embedded as a hidden layer. This changed everything.

### Testing Text Extraction Methods

#### Method 1: pdftotext with -layout flag
```bash
pdftotext -layout input.pdf output.txt
```
**Results**:
- ❌ Columns interleaved incorrectly
- ❌ Text ordering scrambled

#### Method 2: pdftotext WITHOUT -layout flag
```bash
pdftotext input.pdf output.txt
```
**Results**:
- ✅ Clean, properly ordered text!
- ✅ Hebrew text intact
- ✅ Fast processing
- ✅ Free!

### The Solution

We created a simple bash script to extract all text:

```bash
#!/bin/bash
# extract-pdf-text.sh

PDF_DIR="downloads/pdf/filestoprocess"
OUTPUT_DIR="downloads/pdf/OCR_clean"

mkdir -p "$OUTPUT_DIR"

for pdf in "$PDF_DIR"/*.pdf; do
    filename=$(basename "$pdf" .pdf)
    pdftotext "$pdf" "$OUTPUT_DIR/${filename}.txt"
    echo "Extracted: $filename"
done
```

**Processing time**: ~30 seconds for all files (vs. hours with OCR)

---

## Phase 3: Text Extraction Approaches

### Understanding the Text Structure

The extracted text revealed a consistent court transcript format:

```
ישיבה מס' 37
[Session 37]

אב בית הדין  השופט לנדאו, השופט הלוי, השופט רוה
[Judges' names]

היועץ המשפטי  מר גדעון האוזנר
[Prosecutor]

[העד הושבע]
[Witness sworn in]

ש. מה שמך המלא?
[Q. What is your full name?]

ת. שמי יוסף קליינמן
[A. My name is Josef Kleinman]
```

### Key Patterns Identified

1. **Session markers**: `ישיבה מס' XX`
2. **Sworn-in markers**: `[העד הושבע]` or `[העד הושבע]` (RTL brackets)
3. **Questions**: Lines starting with `ש.` or `שאלה:`
4. **Answers**: Lines starting with `ת.` or `תשובה:`
5. **Speaker labels**: `היועץ המשפטי`, `אב בית הדין`, `ד"ר סרבציוס`
6. **Dismissal**: `סיימת את עדותך` (You have completed your testimony)

### RTL Text Challenges

Hebrew is right-to-left, which caused encoding issues:

```python
# Original text might appear as:
[העד הושבע]  # Brackets visually reversed

# We needed to search for both:
patterns = [
    r'\[העד הושבע\]',   # LTR bracket encoding
    r'\]העד הושבע\[',   # RTL bracket encoding
]
```

### Unicode Control Characters

The text contained invisible Unicode directional markers:

```python
# Remove RTL/LTR control characters
import re
clean_text = re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069]', '', text)
```

---

## Phase 4: Entity Extraction & NER

### Goal
Extract and classify all entities mentioned in the trial:
- **Witnesses** (108 official)
- **Persons** (Nazi officials, victims, relatives)
- **Locations** (camps, ghettos, cities, countries)
- **Organizations** (SS, Gestapo, Jewish councils)
- **Documents** (exhibits, evidence numbers)

### Approach 1: OpenAI GPT-4 for NER

```python
async def extract_entities_openai(text_chunk):
    response = await openai.ChatCompletion.create(
        model="gpt-4",
        messages=[{
            "role": "system",
            "content": "Extract entities from this Holocaust trial transcript..."
        }, {
            "role": "user", 
            "content": text_chunk
        }],
        response_format={"type": "json_object"}
    )
    return json.loads(response.choices[0].message.content)
```

**Results**:
- ✅ Excellent entity recognition
- ✅ Context-aware classification
- ❌ Expensive at scale
- ❌ Slow for large documents

### Approach 2: DictaBERT - Hebrew BERT NER

```python
from transformers import pipeline

ner_pipeline = pipeline(
    "ner",
    model="dicta-il/dictabert-ner",
    tokenizer="dicta-il/dictabert-ner"
)

def extract_local_entities(text):
    return ner_pipeline(text)
```

**Results**:
- ✅ Fast local processing
- ✅ Free
- ❌ Less accurate for Holocaust-specific terms
- ❌ Missed context-dependent entities

### Hybrid Approach

We combined both methods:

1. **First pass**: DictaBERT for initial entity detection
2. **Second pass**: OpenAI for consolidation and relationship mapping
3. **Validation**: Cross-reference against official Yad Vashem witness list

```python
async def hybrid_extraction(text):
    # Step 1: Local NER
    local_entities = extract_local_entities(text)
    
    # Step 2: Filter and group
    candidates = filter_candidates(local_entities)
    
    # Step 3: OpenAI for consolidation
    consolidated = await consolidate_with_openai(candidates)
    
    return consolidated
```

### Entity Consolidation Challenge

The same person might appear with different names:

```
אייכמן, אדולף אייכמן, הנאשם, Eichmann, Adolf Eichmann
```

We built consolidation logic:

```python
def consolidate_entities(entities):
    """Merge duplicate entities with different name variants"""
    consolidated = {}
    
    for entity in entities:
        # Find canonical name
        canonical = find_canonical_name(entity)
        
        if canonical in consolidated:
            # Merge mentions and contexts
            consolidated[canonical]['mentions'] += entity['mentions']
            consolidated[canonical]['variants'].add(entity['name'])
        else:
            consolidated[canonical] = entity
    
    return consolidated
```

---

## Phase 5: Testimony Extraction Pipeline

### The Core Challenge

Extract exactly one witness's testimony:
- **Start**: When they are sworn in
- **End**: When dismissed by the judge
- **Avoid**: Including next witness or session content

### Witness Index

We created a comprehensive witness index from Yad Vashem's official list:

```json
{
  "witnesses": [
    {
      "hebrew": "אבא קובנר",
      "english": "Abba Kowner",
      "variants": ["קובנר", "Kovner", "Kowner"],
      "sessions": [27]
    },
    // ... 107 more witnesses
  ]
}
```

### Boundary Detection Algorithm

```python
def find_testimony_boundaries(text, witness_name, variants):
    """Find start and end of a witness testimony"""
    
    # Build regex for all name variants
    name_pattern = '|'.join(re.escape(v) for v in variants)
    
    # START patterns
    start_patterns = [
        rf'\[העד הושבע\]',           # [Witness sworn in]
        rf'\]העד הושבע\[',           # RTL version
        rf'אני קורא ל.*{name_pattern}',  # "I call upon [name]"
        rf'מה שמך.*{name_pattern}',   # "What is your name... [name]"
    ]
    
    # END patterns
    end_patterns = [
        rf'תודה.*{name_pattern}.*סיימת את עדותך',  # "Thank you, [name], you've completed"
        rf'סיימת את עדותך',  # "You've completed your testimony"
        rf'\[העד הבא\]',     # [Next witness]
    ]
    
    # Find boundaries
    start_match = search_near_name(text, start_patterns, witness_name)
    end_match = search_after_start(text, end_patterns, start_match)
    
    return start_match, end_match
```

### Handling Edge Cases

#### 1. Multi-Session Testimonies
Some witnesses testified across multiple sessions:

```python
def handle_multi_session(witness, sessions):
    """Combine testimony fragments across sessions"""
    fragments = []
    for session in sessions:
        fragment = extract_from_session(witness, session)
        if fragment:
            fragments.append(fragment)
    return combine_fragments(fragments)
```

#### 2. Overlapping Content
Preventing inclusion of the next witness:

```python
def truncate_at_next_witness(text, current_witness):
    """Cut off content when next witness is introduced"""
    
    # Find "I call upon" for any witness
    next_intro = re.search(r'אני קורא ל\w+', text)
    
    # Find next sworn-in marker
    next_sworn = re.search(r'\[העד הושבע\]', text)
    
    # Truncate at earliest marker
    if next_intro or next_sworn:
        cut_point = min(
            next_intro.start() if next_intro else len(text),
            next_sworn.start() if next_sworn else len(text)
        )
        return text[:cut_point]
    
    return text
```

#### 3. Missing Session Files
We discovered sessions 30-40 were in a differently-named file:

```python
# Original pattern only found Vol*.txt
for f in OCR_DIR.glob("Vol*.txt"):  # ❌ Missed vol1_part3.txt

# Fixed to include lowercase
for f in list(OCR_DIR.glob("Vol*.txt")) + list(OCR_DIR.glob("vol*.txt")):  # ✅
```

### Output Format

Each testimony extracted as clean Markdown:

```markdown
# יעקב גורפיין
## Yacov Gurfein

---

**[העד הושבע]**

**היועץ המשפטי:** מה שמך המלא?

**העד:** יעקב גורפיין.

**שאלה:** היכן נולדת?

**תשובה:** נולדתי בפולין, בעיר קראקוב...

[... testimony content ...]

**אב בית הדין:** תודה רבה, מר גורפיין, סיימת את עדותך.

---

*Extracted from Vol1_p15291.txt, lines 9788-10141*
```

---

## Phase 6: English Transcripts from Nizkor Project

### Discovery of English Source

While the Hebrew transcripts from Yad Vashem provided the original source, we discovered that the **Nizkor Project** had already transcribed the trial proceedings into English, hosted via the Wayback Machine archive.

**Source**: `https://web.archive.org/web/*/www.nizkor.org/hweb/people/e/eichmann-adolf/transcripts/Sessions/*`

This gave us access to clean, structured English text covering most trial sessions.

### Web Scraping the Nizkor Transcripts

We built a scraper to download all available English session transcripts:

```python
# scrape_nizkor_transcripts.py
import asyncio
from pathlib import Path

NIZKOR_BASE = "https://web.archive.org/web/..."
OUTPUT_DIR = Path("downloads/nizkor-transcripts")

async def scrape_session(session_num, part_num):
    """Download a single session part from Nizkor/Wayback"""
    url = f"{NIZKOR_BASE}/Session-{session_num:03d}-{part_num:02d}.html"
    # Fetch, parse HTML, extract transcript text
    # Save as Markdown
```

**Results**:
- 121 session files downloaded
- Organized by volume (vol1-vol5)
- Sessions 1-114, 119-121 available
- Sessions 115-118 (Judgment reading) not transcribed

### Entity Extraction with spaCy NER

For the English transcripts, we used **spaCy's `en_core_web_lg`** model for Named Entity Recognition:

```python
import spacy

nlp = spacy.load("en_core_web_lg")

def extract_entities_spacy(text, session_num):
    """Extract entities using spaCy NER"""
    doc = nlp(text)
    
    entities = {
        "persons": {},
        "locations": {},
        "organizations": {},
        "events": {},
    }
    
    for ent in doc.ents:
        if ent.label_ == "PERSON":
            add_entity(entities["persons"], ent.text, session_num)
        elif ent.label_ in ("GPE", "LOC", "FAC"):
            add_entity(entities["locations"], ent.text, session_num)
        elif ent.label_ == "ORG":
            add_entity(entities["organizations"], ent.text, session_num)
        elif ent.label_ == "EVENT":
            add_entity(entities["events"], ent.text, session_num)
    
    return entities
```

### Witness Testimony Extraction

We developed sophisticated patterns to extract individual testimonies:

```python
# Sworn-in patterns to detect testimony start
sworn_patterns = [
    r'\[\s*[Tt]he witness is sworn[^\]]*\]',
    r'\[\s*[Ww]itness\s+[A-Z][a-zA-Z\-]+\s+is sworn[^\]]*\]',
    r'\[\s*(?:Mr\.|Mrs\.|Dr\.)\s*[A-Z][a-zA-Z\-]+\s+is sworn[^\]]*\]',
    # ... more patterns
]

# End patterns to detect testimony conclusion
end_patterns = [
    r'\*\*Presiding Judge:\*\*.*?you have concluded your testimony',
    r'\*\*Presiding Judge:\*\*.*?Thank you,? (?:Mr\.|Mrs\.|Dr\.).*?\.',
]
```

### The 108 Witness Challenge

A major challenge was matching extracted witness names to our canonical **witness-index.json**. Names appeared with many spelling variations:

| Canonical Name | Nizkor Spellings |
|----------------|------------------|
| Dr. Hinko Zaltz | Dr. Hinko Salz, Hinko Salz |
| Yitzhak Nehama | Itzchak Nechama, Mr. Nechama |
| Dr. Arieh Breslauer | Arye Zvi Breszlauer, Witness Breszlauer |
| Mordeichai Eliezer Greenspan | Mordecai Eliezer Grynszpan, M. Grynszpan |
| Shimon Servernik | Shim'on Srebrnik, Witness Srebrnik |

**Solution**: Build comprehensive variant lists for each witness:

```python
def match_witness_to_index(extracted_name, witness_index):
    """Match an extracted name to canonical witness"""
    
    for witness in witness_index["witnesses"]:
        # Check exact match
        if extracted_name.lower() == witness["english"].lower():
            return witness["english"]
        
        # Check variants
        for variant in witness.get("variants", []):
            if extracted_name.lower() == variant.lower():
                return witness["english"]
        
        # Check partial matches (first + last name)
        # ...
    
    return None
```

### Entity Consolidation with OpenAI

Raw spaCy extraction produced many duplicates and errors:
- "Hitler" and "Adolf Hitler" as separate entities
- "Ramat Gan" (a city) classified as PERSON
- "Wayback Machine Archive" extracted as ORGANIZATION

We built an **OpenAI-powered consolidation pipeline**:

```python
def consolidate_with_openai(entities, entity_type):
    """Use GPT-4o to consolidate and deduplicate entities"""
    
    prompt = f"""You are an expert on the Holocaust and the Eichmann Trial (1961).

I have a list of {entity_type} extracted from the trial transcripts using NER.
Many are duplicates, misspellings, partial extractions, or misclassified entities.

Your task:
1. Identify groups of entities that refer to the same thing
2. Choose the best canonical name for each group
3. Filter out entities that are NOT actually {entity_type}
4. Filter out generic terms, partial words, or extraction errors

Return a JSON object where:
- Keys are the canonical entity names to keep
- Values are arrays of all variant names to merge

Example:
{{
  "Adolf Hitler": ["Hitler", "Adolf Hitler", "Hitler's"],
  "Heinrich Himmler": ["Himmler", "Reichsfuehrer Himmler"]
}}
"""
    
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
    )
    
    return json.loads(response.choices[0].message.content)
```

### Date-Session Linking

We created DATE entities for timeline functionality, linking each session to its date:

```python
# Session → Date edges
for session in session_nodes:
    session_date = session.get("date")  # e.g., "1961-04-11"
    if session_date:
        date_id = f"date-{session_date}"
        edges.append({
            "source": session["id"],
            "target": date_id,
            "type": "OCCURRED_ON",
        })
```

### Final English Extraction Results

| Metric | Value |
|--------|-------|
| **Witnesses Found** | 108/108 (100%) |
| **English Testimonies** | 108 files |
| **Persons (Historical Figures)** | 388 |
| **Locations** | 298 |
| **Organizations** | 84 |
| **Events** | 10 |
| **Dates** | 78 |
| **Total Nodes** | 1,195 |
| **Total Edges** | 5,864 |

### Key Figures Extracted

| Name | Mentions |
|------|----------|
| Himmler | 962 |
| Heydrich | 557 |
| Adolf Hitler | 380 |
| Veesenmayer | 262 |
| Rudolf Hoess | 253 |
| Ernst Kaltenbrunner | 229 |
| Rudolf Kasztner | 198 |
| Odilo Globocnik | 157 |
| Goering | 141 |

### Testimony Cleanup

Extracted testimonies required cleanup:
1. **Remove Nizkor artifacts**: INFOLINKS_OFF, copyright notices, navigation elements
2. **Start marker**: Keep "What is your full name?" question
3. **End marker**: Truncate at "you have concluded your testimony"

```python
def save_testimony(witness_name, testimony_text, session_num):
    """Clean and save English testimony"""
    
    # Remove website artifacts
    cleaned = re.sub(r'INFOLINKS_OFF.*?\n', '', testimony_text)
    cleaned = re.sub(r'Home·Site Map.*?\n', '', cleaned)
    cleaned = re.sub(r'©.*?\d{4}.*?\n', '', cleaned)
    cleaned = re.sub(r'Nizkor urges the readers.*?manifestations\.', '', cleaned)
    
    # Format as Markdown
    content = f"""# Testimony of {witness_name}

**Session:** {session_num}

---

{cleaned}
"""
    
    filepath.write_text(content)
```

---

## Technical Challenges & Solutions

### Challenge 1: Hebrew Text Direction
**Problem**: Mixed LTR/RTL content causing display issues

**Solution**: Explicit `dir="rtl"` attributes and Unicode normalization

```tsx
<p dir="rtl" className="text-right">
  {hebrewText}
</p>
```

### Challenge 2: Name Variant Matching
**Problem**: Same witness with 5+ spelling variations

**Solution**: Comprehensive variant lists with fuzzy matching

```python
variants = [
    "דר' ז'ורז' ולרס",  # Full Hebrew
    "ולרס",             # Short Hebrew
    "ולר",              # Alternate spelling
    "Wellers",          # English
    "Georges",          # First name
    "ג'ורג'"            # Transliterated
]
```

### Challenge 3: Column Interleaving
**Problem**: PDF tools merging left/right columns

**Solution**: Use `pdftotext` without layout flag - the embedded text was already properly ordered

### Challenge 4: File Discovery
**Problem**: Missing files due to inconsistent naming

**Solution**: Case-insensitive glob patterns and manual file discovery

```python
files = list(Path(OCR_DIR).glob("[Vv]ol*.txt"))
```

### Challenge 5: Artifact Removal
**Problem**: Session headers and page numbers in extracted text

**Solution**: Post-processing regex cleanup

```python
def clean_testimony(text):
    # Remove page numbers
    text = re.sub(r'^\d{3,4}$', '', text, flags=re.MULTILINE)
    
    # Remove document headers
    text = re.sub(r'^משפט אייכמן$', '', text, flags=re.MULTILINE)
    
    return text.strip()
```

### Challenge 6: Large File Processing
**Problem**: 100,000+ lines causing memory issues

**Solution**: Streaming processing with chunking

```python
def process_large_file(filepath):
    with open(filepath, 'r') as f:
        chunk = []
        for line in f:
            chunk.append(line)
            if len(chunk) >= 5000:
                yield ''.join(chunk)
                chunk = []
        if chunk:
            yield ''.join(chunk)
```

---

## Technologies & Libraries Used

### Languages
| Language | Usage |
|----------|-------|
| **Python 3.11** | NER pipeline, text processing, extraction |
| **TypeScript/JavaScript** | Web scraping, Next.js frontend |
| **Bash** | PDF processing scripts |

### Python Libraries
| Library | Purpose |
|---------|---------|
| `spacy` | English NER (en_core_web_lg model) |
| `transformers` | DictaBERT Hebrew NER model |
| `openai` | GPT-4o API for entity consolidation |
| `asyncio` | Parallel processing |
| `diskcache` | Caching API responses |
| `PyMuPDF (fitz)` | PDF page extraction |
| `pathlib` | File system operations |
| `python-dotenv` | Environment variable management |

### JavaScript/TypeScript Libraries
| Library | Purpose |
|---------|---------|
| `Next.js 14` | React framework, App Router |
| `Puppeteer` | Web scraping, browser automation |
| `Axios` | HTTP requests |
| `Tailwind CSS` | Styling |

### External Services
| Service | Purpose |
|---------|---------|
| OpenAI GPT-4 | Entity extraction & consolidation |
| Google Cloud Vision | OCR (attempted) |
| Google Document AI | Layout parsing (attempted) |

### Command-Line Tools
| Tool | Purpose |
|------|---------|
| `pdftotext` (Poppler) | PDF text extraction |
| `grep` | Text pattern search |
| `head/tail` | File inspection |

---

## Final Results & Statistics

### Extraction Success

| Metric | Hebrew | English |
|--------|--------|---------|
| **Total Official Witnesses** | 108 | 108 |
| **Testimonies Extracted** | 108 (100%) | 108 (100%) |
| **Failed Extractions** | 0 | 0 |

### Data Volumes

| Metric | Value |
|--------|-------|
| **Total PDF Files (Hebrew)** | 14 |
| **Total Pages** | ~25,000 |
| **Total Text (chars)** | ~50 million |
| **Hebrew Testimony Files** | 108 Markdown files |
| **English Testimony Files** | 108 Markdown files |
| **Avg. Testimony Length** | ~15,000 characters |

### Entity Graph (English Transcripts)

| Entity Type | Raw Extracted | After Consolidation |
|-------------|---------------|---------------------|
| **Persons** | 1,728 | 496 (108 witnesses + 388 figures) |
| **Locations** | 536 | 298 |
| **Organizations** | 457 | 84 |
| **Events** | 59 | 10 |
| **Dates** | 78 | 78 |
| **Sessions** | 121 | 121 |
| **Testimonies** | 108 | 108 |
| **Total Nodes** | 3,087 | 1,195 |
| **Total Edges** | 16,848 | 5,864 |

### Top Historical Figures Extracted

| Name | Mentions |
|------|----------|
| Heinrich Himmler | 962 |
| Reinhard Heydrich | 557 |
| Adolf Hitler | 380 |
| Edmund Veesenmayer | 262 |
| Rudolf Hoess | 253 |
| Ernst Kaltenbrunner | 229 |
| Rudolf Kasztner | 198 |
| Odilo Globocnik | 157 |
| Hermann Goering | 141 |

### Session Coverage

| Volume | Sessions | Witnesses |
|--------|----------|-----------|
| Vol1_p114.txt | 1-14 | 5 |
| Vol1_p15291.txt | 15-29 | 38 |
| vol1_part3.txt | 30-40 | 12 |
| Vol2_p4155.txt | 41-54 | 23 |
| Vol2_p5564.txt | 55-64 | 10 |
| Vol2_p6575.txt | 65-75 | 20 |
| **TOTAL** | 1-75 | **108** |

### Nizkor English Coverage

| Volume | Sessions | Notes |
|--------|----------|-------|
| vol1 | 1-6, 9-30 | Sessions 7-8 missing (Opening Speech) |
| vol2 | 31-51 | Complete |
| vol3 | 50-75 | Complete |
| vol4 | 74-107 | Complete |
| vol5 | 107-114, 119-121 | Sessions 115-118 missing (Judgment) |

### Cost Analysis

| Approach | Estimated Cost |
|----------|----------------|
| Full OCR (Google Vision) | ~$1,500 |
| Full OCR (Document AI) | ~$1,000 |
| **Hebrew Approach (pdftotext)** | **$0** |
| OpenAI Entity Extraction (Hebrew) | ~$50 |
| OpenAI Entity Consolidation (English) | ~$20 |
| **Total Project Cost** | **~$70** |

### Time Invested

| Phase | Duration |
|-------|----------|
| Web scraping & file acquisition | 2 days |
| OCR research & failed attempts | 3 days |
| Discovery of embedded text | 1 hour |
| Hebrew text extraction pipeline | 1 day |
| Hebrew entity extraction pipeline | 2 days |
| Hebrew testimony extraction | 2 days |
| Nizkor English scraping | 1 day |
| English NER with spaCy | 1 day |
| OpenAI entity consolidation | 1 day |
| Web interface | 2 days |
| **Total** | **~15 days** |

---

## Lessons Learned

### 1. Check for Embedded Text First
Before investing in expensive OCR solutions, always check if PDFs already contain embedded text. A simple `pdftotext` test could save weeks of work.

### 2. Simple Solutions Often Work Best
The complex multi-column OCR with AI parsing was unnecessary. The simplest approach (`pdftotext` without flags) produced the cleanest results.

### 3. Domain-Specific Challenges Need Domain Knowledge
Understanding court transcript structure (sworn-in markers, Q&A format, dismissal phrases) was essential for accurate extraction.

### 4. Hebrew/RTL Text Requires Special Handling
Unicode directional markers, bracket reversals, and mixed-direction content require careful handling.

### 5. Iterative Development Works
Starting with one witness, validating the output, then scaling to all 108 was more effective than trying to process everything at once.

### 6. File Naming Matters
Inconsistent naming (`Vol1.txt` vs `vol1_part3.txt`) caused extraction failures until patterns were made case-insensitive.

### 7. Validate Against Ground Truth
Cross-referencing against Yad Vashem's official list of 108 witnesses ensured completeness.

### 8. Name Variant Matching is Critical
The same person can appear with 10+ different spellings. Building comprehensive variant lists and fuzzy matching was essential for 100% witness coverage.

### 9. LLM-Based Consolidation Beats Rule-Based
Using OpenAI GPT-4o to consolidate entities (merging "Hitler"/"Adolf Hitler", filtering misclassified cities as persons) produced far better results than manual rules.

### 10. Batch Processing Needs Cross-Batch Merging
Processing entities in batches of 100 for OpenAI consolidation created fragmentation - entities in different batches weren't merged. A post-processing step to merge across batches improves quality.

### 11. Multiple Source Languages Strengthen Data
Having both Hebrew (original) and English (Nizkor) transcripts allowed cross-validation and provided accessibility for international users.

---

## Future Enhancements

### Completed ✅
- ~~**Translation**: Machine translation to English for accessibility~~ → **English transcripts from Nizkor**
- ~~**Relationship Graph**: Visualize connections between witnesses, locations, events~~ → **Entity graph with 5,864 edges**
- ~~**Timeline Visualization**: Map testimonies to historical events~~ → **78 DATE nodes linked to sessions**

### Planned
1. **Full-Text Search**: Elasticsearch integration for searching across all testimonies
2. **Topic Extraction**: Identify key themes (camps, ghettos, events) per testimony
3. **Cross-Entity Relationships**: Deeper links (e.g., which witnesses mention which Nazi officials)
4. **Audio Integration**: Link to original trial recordings where available
5. **Interactive Knowledge Graph**: Visual exploration of entity relationships

---

## Acknowledgments

- **Yad Vashem** - For maintaining the official witness list and historical records
- **Israel State Archives** - For digitizing and hosting the trial transcripts
- **The 108 Witnesses** - Whose courage in testifying preserved history

---

*This project is dedicated to the memory of the six million Jews murdered in the Holocaust, and to the survivors whose testimonies ensure we never forget.*

---

**Project Repository**: [eichmann/](/)  
**Live Demo**: [localhost:3000/witnesses](/witnesses)  
**Last Updated**: December 31, 2024

---

## Pipeline Scripts Reference

### Extraction Pipeline

| Script | Purpose |
|--------|---------|
| `scrape_nizkor_transcripts.py` | Download English transcripts from Nizkor/Wayback |
| `extract_nizkor.py` | Extract entities and testimonies from English transcripts |
| `consolidate_entities.py` | Consolidate entities with OpenAI GPT-4o |
| `add_variants.py` | Add spelling variants to witness-index.json |

### Running the Full Pipeline

```bash
cd datawork/python-pipeline
source venv/bin/activate

# Step 1: Scrape Nizkor transcripts (if not already done)
python scrape_nizkor_transcripts.py

# Step 2: Extract entities and testimonies
python extract_nizkor.py

# Step 3: Consolidate with OpenAI
python consolidate_entities.py
```

### Output Files

| File | Description |
|------|-------------|
| `app/public/data/entities-consolidated.json` | Complete entity graph |
| `app/public/data/testimonies/en/*.md` | 108 English testimony files |
| `app/public/data/testimonies/*.md` | 108 Hebrew testimony files |
| `eichmann-entities/witness-index.json` | Canonical witness list with variants |

