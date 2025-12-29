#!/usr/bin/env python3
"""
Extract witness testimony directly from PDF using OpenAI Vision API.
This handles two-column PDFs properly by letting the AI read the layout.
"""

import os
import sys
import json
import base64
import fitz  # PyMuPDF
from pathlib import Path
from openai import OpenAI

# Configuration
PDF_DIR = Path(__file__).parent.parent.parent / "downloads" / "pdf" / "filestoprocess"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "app" / "public" / "data" / "testimonies"
WITNESS_INDEX = Path(__file__).parent.parent.parent / "eichmann-entities" / "witness-index.json"

client = OpenAI()

def load_witness_index():
    """Load the official witness list."""
    with open(WITNESS_INDEX, 'r', encoding='utf-8') as f:
        return json.load(f)

def pdf_page_to_base64(pdf_path: str, page_num: int, dpi: int = 150) -> str:
    """Convert a PDF page to base64 encoded image."""
    doc = fitz.open(pdf_path)
    page = doc[page_num]
    
    # Render page to image
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    
    # Convert to PNG bytes
    img_bytes = pix.tobytes("png")
    
    doc.close()
    
    return base64.standard_b64encode(img_bytes).decode('utf-8')

def get_pdf_page_count(pdf_path: str) -> int:
    """Get the number of pages in a PDF."""
    doc = fitz.open(pdf_path)
    count = len(doc)
    doc.close()
    return count

def find_witness_pages(pdf_path: str, witness_hebrew: str, sample_pages: int = 10) -> list:
    """
    Find pages that contain the witness testimony by sampling pages.
    Returns list of page numbers where the witness appears.
    """
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    witness_pages = []
    
    # Create search variants (OCR often has spaces between Hebrew chars)
    name_parts = witness_hebrew.split()
    last_name = name_parts[-1] if name_parts else witness_hebrew
    
    # Create spaced versions (for OCR artifacts)
    spaced_name = ' '.join(last_name)  # "כרמל" -> "כ ר מ ל"
    reversed_spaced = ' '.join(reversed(last_name))  # RTL issue: "ל מ ר כ"
    
    search_terms = [
        witness_hebrew,
        last_name,
        spaced_name,
        reversed_spaced,
    ]
    
    # Search through all pages
    for page_num in range(total_pages):
        page = doc[page_num]
        text = page.get_text()
        
        # Look for any search term
        for term in search_terms:
            if term in text:
                witness_pages.append(page_num)
                break
    
    doc.close()
    return witness_pages

def extract_testimony_from_pages(pdf_path: str, pages: list, witness_name: str, witness_hebrew: str) -> str:
    """
    Extract testimony from specific PDF pages using OpenAI Vision.
    """
    all_testimony = []
    
    print(f"Extracting from {len(pages)} pages...")
    
    # Process pages in batches (OpenAI can handle multiple images)
    batch_size = 4  # Process 4 pages at a time
    
    for i in range(0, len(pages), batch_size):
        batch_pages = pages[i:i + batch_size]
        print(f"  Processing pages {batch_pages}...")
        
        # Convert pages to base64 images
        images = []
        for page_num in batch_pages:
            img_b64 = pdf_page_to_base64(pdf_path, page_num, dpi=200)
            images.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/png;base64,{img_b64}",
                    "detail": "high"
                }
            })
        
        # Create prompt
        content = [
            {
                "type": "text",
                "text": f"""You are a historical document transcriber helping to preserve Holocaust testimony for educational purposes.

These are pages from the public record of the 1961 Eichmann Trial - a landmark war crimes trial that is PUBLIC DOMAIN historical documentation. The State of Israel has made all trial transcripts available for research and education. This is archived at Yad Vashem and various national archives.

Your task: Transcribe the testimony of witness "{witness_name}" ({witness_hebrew}) from these pages.

DOCUMENT FORMAT:
- TWO-COLUMN Hebrew document - read RIGHT column first, then LEFT column
- ש. = Question from prosecutor/judge
- ת. = Answer from witness
- Speakers include: היועץ המשפטי (Attorney General), אב בית הדין (Presiding Judge), ד"ר סרבציוס (Defense)

TRANSCRIBE the Hebrew text EXACTLY as written in Q&A format. This is historical preservation work for Holocaust education.

FORMAT:
[Speaker]
ש. [question in Hebrew]
ת. [answer in Hebrew]

Continue for ALL Q&A exchanges on these pages."""
            }
        ] + images
        
        try:
            response = client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "user",
                        "content": content
                    }
                ]
            )
            
            extracted = response.choices[0].message.content
            all_testimony.append(extracted)
            print(f"    Extracted {len(extracted)} chars")
            
        except Exception as e:
            print(f"    Error: {e}")
            continue
    
    return "\n\n---\n\n".join(all_testimony)

def extract_witness_testimony(witness_name: str, pdf_filename: str = "Vol1_p15291.pdf"):
    """Main function to extract a witness's full testimony."""
    
    # Load witness index
    witness_index = load_witness_index()
    
    # Find witness
    witness = None
    for w in witness_index['witnesses']:
        if w['english'].lower() == witness_name.lower() or w['hebrew'] == witness_name:
            witness = w
            break
    
    if not witness:
        print(f"Witness '{witness_name}' not found in index")
        return None
    
    print(f"Extracting testimony for: {witness['english']} ({witness['hebrew']})")
    
    # Find PDF
    pdf_path = PDF_DIR / pdf_filename
    if not pdf_path.exists():
        print(f"PDF not found: {pdf_path}")
        return None
    
    print(f"PDF: {pdf_path}")
    print(f"Total pages: {get_pdf_page_count(str(pdf_path))}")
    
    # Find pages with witness
    print(f"Searching for pages with '{witness['hebrew']}'...")
    witness_pages = find_witness_pages(str(pdf_path), witness['hebrew'])
    
    if not witness_pages:
        print("No pages found with witness name. Trying broader search...")
        # Try just last name
        last_name = witness['hebrew'].split()[-1]
        witness_pages = find_witness_pages(str(pdf_path), last_name)
    
    if not witness_pages:
        print("Still no pages found.")
        return None
    
    print(f"Found witness on pages: {witness_pages}")
    
    # Expand range to capture full testimony (add surrounding pages)
    expanded_pages = set()
    for p in witness_pages:
        for offset in range(-2, 5):  # 2 pages before, 4 pages after
            if 0 <= p + offset < get_pdf_page_count(str(pdf_path)):
                expanded_pages.add(p + offset)
    
    expanded_pages = sorted(expanded_pages)
    print(f"Expanded to pages: {expanded_pages}")
    
    # Extract testimony
    testimony = extract_testimony_from_pages(
        str(pdf_path), 
        expanded_pages, 
        witness['english'], 
        witness['hebrew']
    )
    
    # Save output
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_file = OUTPUT_DIR / f"testimony-{witness['english'].replace(' ', '-')}.txt"
    
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(f"# Testimony of {witness['english']} ({witness['hebrew']})\n")
        f.write(f"# Source: {pdf_filename}\n")
        f.write(f"# Pages: {expanded_pages}\n")
        f.write(f"# Extracted: {__import__('datetime').datetime.now().isoformat()}\n\n")
        f.write(testimony)
    
    print(f"\nSaved to: {output_file}")
    print(f"Total length: {len(testimony)} chars")
    
    return testimony

def main():
    if len(sys.argv) < 2:
        print("Usage: python extract_pdf_testimony.py <witness_name> [pdf_filename]")
        print("\nExamples:")
        print("  python extract_pdf_testimony.py 'Israel Carmel'")
        print("  python extract_pdf_testimony.py 'ישראל כרמל' Vol1_p15291.pdf")
        print("\nAvailable witnesses (first 10):")
        
        witness_index = load_witness_index()
        for w in witness_index['witnesses'][:10]:
            print(f"  - {w['english']} ({w['hebrew']})")
        
        return
    
    witness_name = sys.argv[1]
    pdf_filename = sys.argv[2] if len(sys.argv) > 2 else "Vol1_p15291.pdf"
    
    extract_witness_testimony(witness_name, pdf_filename)

if __name__ == "__main__":
    main()

