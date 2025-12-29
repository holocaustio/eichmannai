#!/usr/bin/env python3
"""
Re-OCR PDF files using Google Document AI Layout Parser.
This properly handles multi-column documents and preserves reading order.
"""

import os
import sys
import json
from pathlib import Path
from google.cloud import documentai_v1 as documentai
from google.api_core.client_options import ClientOptions

# Configuration
PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "YOUR_PROJECT_ID")
LOCATION = "us"  # or "eu"
# You need to create a Layout Parser processor in Document AI console
PROCESSOR_ID = os.environ.get("LAYOUT_PARSER_PROCESSOR_ID", "")

PDF_DIR = Path(__file__).parent.parent.parent / "downloads" / "pdf" / "filestoprocess"
OUTPUT_DIR = Path(__file__).parent.parent.parent / "downloads" / "pdf" / "OCR_layout"

def process_document_with_layout(
    project_id: str,
    location: str,
    processor_id: str,
    file_path: str,
    mime_type: str = "application/pdf",
) -> str:
    """
    Process a document with the Layout Parser to get proper reading order.
    """
    # You must set the `api_endpoint` if you use a location other than "us"
    opts = ClientOptions(api_endpoint=f"{location}-documentai.googleapis.com")
    
    client = documentai.DocumentProcessorServiceClient(client_options=opts)
    
    # The full resource name of the processor
    name = client.processor_path(project_id, location, processor_id)
    
    # Read the file
    with open(file_path, "rb") as f:
        file_content = f.read()
    
    # Configure process options for layout parsing
    process_options = documentai.ProcessOptions(
        layout_config=documentai.ProcessOptions.LayoutConfig(
            chunking_config=documentai.ProcessOptions.LayoutConfig.ChunkingConfig(
                chunk_size=500,  # Small chunks to preserve structure
                include_ancestor_headings=True,
            )
        )
    )
    
    # Create the request
    request = documentai.ProcessRequest(
        name=name,
        raw_document=documentai.RawDocument(content=file_content, mime_type=mime_type),
        process_options=process_options,
    )
    
    print(f"  Sending to Document AI Layout Parser...")
    result = client.process_document(request=request)
    document = result.document
    
    # Extract text with proper reading order from layout blocks
    full_text_parts = []
    
    # The document_layout contains blocks in reading order
    if document.document_layout and document.document_layout.blocks:
        print(f"  Found {len(document.document_layout.blocks)} layout blocks")
        for block in document.document_layout.blocks:
            if block.text_block and block.text_block.text:
                full_text_parts.append(block.text_block.text)
    
    # Fallback to chunked document
    if not full_text_parts and document.chunked_document and document.chunked_document.chunks:
        print(f"  Using {len(document.chunked_document.chunks)} chunks")
        for chunk in document.chunked_document.chunks:
            if chunk.content:
                full_text_parts.append(chunk.content)
    
    # Final fallback to raw text (but this won't have reading order)
    if not full_text_parts:
        print("  Falling back to raw document text")
        return document.text
    
    return "\n\n".join(full_text_parts)


def reocr_pdf(pdf_path: str, output_path: str = None) -> str:
    """Re-OCR a single PDF file with layout parsing."""
    
    if not PROCESSOR_ID:
        print("ERROR: Set LAYOUT_PARSER_PROCESSOR_ID environment variable")
        print("\nTo create a Layout Parser processor:")
        print("1. Go to https://console.cloud.google.com/ai/document-ai")
        print("2. Click 'Create Processor'")
        print("3. Select 'Layout Parser'")
        print("4. Copy the processor ID")
        return None
    
    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        print(f"PDF not found: {pdf_path}")
        return None
    
    print(f"Processing: {pdf_path.name}")
    print(f"  File size: {pdf_path.stat().st_size / 1024 / 1024:.1f} MB")
    
    # Check page limit (15 pages for online processing)
    # For larger files, you'd need batch processing
    
    try:
        text = process_document_with_layout(
            PROJECT_ID,
            LOCATION,
            PROCESSOR_ID,
            str(pdf_path),
        )
        
        if output_path is None:
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            output_path = OUTPUT_DIR / f"{pdf_path.stem}.txt"
        
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(text)
        
        print(f"  Saved: {output_path}")
        print(f"  Length: {len(text):,} characters")
        
        return text
        
    except Exception as e:
        print(f"  Error: {e}")
        return None


def main():
    if len(sys.argv) < 2:
        print("Usage: python reocr_with_layout.py <pdf_file> [output_file]")
        print("\nEnvironment variables needed:")
        print("  GOOGLE_CLOUD_PROJECT - Your GCP project ID")
        print("  LAYOUT_PARSER_PROCESSOR_ID - Your Layout Parser processor ID")
        print("  GOOGLE_APPLICATION_CREDENTIALS - Path to service account key")
        print("\nTo create a Layout Parser:")
        print("1. Go to https://console.cloud.google.com/ai/document-ai")
        print("2. Create a 'Layout Parser' processor")
        print("3. Set the processor ID in LAYOUT_PARSER_PROCESSOR_ID")
        return
    
    pdf_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None
    
    reocr_pdf(pdf_path, output_path)


if __name__ == "__main__":
    main()

