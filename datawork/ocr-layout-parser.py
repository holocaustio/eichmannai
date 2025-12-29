#!/usr/bin/env python3
"""
Google Document AI Layout Parser OCR - with proper multi-column reading order.
Mirrors the JavaScript ocr-parallel.js approach but uses Layout Parser.
"""

import os
import sys
import json
import asyncio
import aiohttp
import subprocess
import tempfile
import shutil
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from google.oauth2 import service_account
from google.auth.transport.requests import Request

# ============================================
# CONFIGURATION
# ============================================
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent

CONFIG = {
    'project_number': '261156330246',
    'location': 'us',
    # Layout Parser processor - you need to create this in Google Cloud Console
    # Go to: https://console.cloud.google.com/ai/document-ai
    # Create a "Layout Parser" processor
    'layout_processor_id': os.environ.get('LAYOUT_PARSER_PROCESSOR_ID', ''),
    # Fallback to existing OCR processor if no layout parser
    'ocr_processor_id': '40eca46e4a17cb7c',
    'credentials_path': PROJECT_ROOT / 'google-credentials.json',
    'max_pages_per_request': 15,
    'concurrency': 5,
}

PDF_DIR = PROJECT_ROOT / 'downloads' / 'pdf' / 'filestoprocess'
OCR_DIR = PROJECT_ROOT / 'downloads' / 'pdf' / 'OCR_layout'
TEMP_DIR = SCRIPT_DIR / 'temp_pdfs'

# Create directories
OCR_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DIR.mkdir(parents=True, exist_ok=True)


def get_access_token():
    """Get access token using service account credentials."""
    credentials = service_account.Credentials.from_service_account_file(
        str(CONFIG['credentials_path']),
        scopes=['https://www.googleapis.com/auth/cloud-platform']
    )
    credentials.refresh(Request())
    return credentials.token


def get_pdf_page_count(pdf_path: str) -> int:
    """Get the number of pages in a PDF."""
    try:
        result = subprocess.run(
            ['pdfinfo', pdf_path],
            capture_output=True, text=True, timeout=30
        )
        for line in result.stdout.split('\n'):
            if line.startswith('Pages:'):
                return int(line.split(':')[1].strip())
    except Exception:
        pass
    return 0


def split_pdf(pdf_path: str, output_dir: Path, max_pages: int) -> list:
    """Split a PDF into chunks of max_pages each using pdfseparate/pdfunite (poppler)."""
    base_name = Path(pdf_path).stem
    page_count = get_pdf_page_count(pdf_path)
    
    if page_count == 0:
        print(f"  ⚠️  Could not determine page count for {base_name}")
        return []
    
    if page_count <= max_pages:
        return [{'path': pdf_path, 'start': 1, 'end': page_count}]
    
    print(f"  Splitting {page_count} pages into chunks of {max_pages}...")
    
    chunks = []
    for start in range(1, page_count + 1, max_pages):
        end = min(start + max_pages - 1, page_count)
        chunk_path = output_dir / f"{base_name}_p{start}-{end}.pdf"
        
        try:
            # Use pdfseparate + pdfunite (poppler) like the JS version
            temp_pages = []
            for page in range(start, end + 1):
                page_file = output_dir / f"{base_name}_page_{page}.pdf"
                subprocess.run([
                    'pdfseparate', '-f', str(page), '-l', str(page),
                    pdf_path, str(page_file)
                ], check=True, capture_output=True, timeout=60)
                temp_pages.append(str(page_file))
            
            # Unite the pages
            subprocess.run(
                ['pdfunite'] + temp_pages + [str(chunk_path)],
                check=True, capture_output=True, timeout=120
            )
            
            # Cleanup temp pages
            for p in temp_pages:
                try:
                    Path(p).unlink()
                except:
                    pass
            
            chunks.append({'path': str(chunk_path), 'start': start, 'end': end})
            
        except Exception as e:
            print(f"  ⚠️  Error splitting pages {start}-{end}: {e}")
    
    return chunks


async def process_chunk_with_layout(session: aiohttp.ClientSession, chunk_path: str, 
                                     access_token: str, use_layout: bool = True) -> str:
    """Process a single PDF chunk using Layout Parser or OCR."""
    
    with open(chunk_path, 'rb') as f:
        file_content = f.read()
    
    import base64
    encoded_content = base64.b64encode(file_content).decode('utf-8')
    
    # Choose processor
    processor_id = CONFIG['layout_processor_id'] if use_layout and CONFIG['layout_processor_id'] else CONFIG['ocr_processor_id']
    
    api_url = (
        f"https://{CONFIG['location']}-documentai.googleapis.com/v1/"
        f"projects/{CONFIG['project_number']}/locations/{CONFIG['location']}/"
        f"processors/{processor_id}:process"
    )
    
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json; charset=utf-8',
    }
    
    # Build request body
    if use_layout and CONFIG['layout_processor_id']:
        # Layout Parser request - extracts with proper reading order
        body = {
            'rawDocument': {
                'content': encoded_content,
                'mimeType': 'application/pdf',
            },
            'processOptions': {
                'layoutConfig': {
                    'chunkingConfig': {
                        'chunkSize': 500,
                        'includeAncestorHeadings': True,
                    }
                }
            }
        }
    else:
        # Standard OCR request
        body = {
            'rawDocument': {
                'content': encoded_content,
                'mimeType': 'application/pdf',
            },
            'processOptions': {
                'ocrConfig': {
                    'hints': {
                        'languageHints': ['he', 'de', 'fr', 'en']
                    }
                }
            }
        }
    
    async with session.post(api_url, headers=headers, json=body) as response:
        if response.status != 200:
            error_text = await response.text()
            raise Exception(f"API Error {response.status}: {error_text[:200]}")
        
        result = await response.json()
        
        # Extract text based on response type
        document = result.get('document', {})
        
        # For Layout Parser, try to get text from layout blocks (proper reading order)
        if use_layout and CONFIG['layout_processor_id']:
            text_parts = []
            
            # First try document layout blocks
            layout = document.get('documentLayout', {})
            blocks = layout.get('blocks', [])
            
            if blocks:
                for block in blocks:
                    text_block = block.get('textBlock', {})
                    if text_block.get('text'):
                        text_parts.append(text_block['text'])
            
            # Then try chunked document
            if not text_parts:
                chunked = document.get('chunkedDocument', {})
                chunks = chunked.get('chunks', [])
                for chunk in chunks:
                    if chunk.get('content'):
                        text_parts.append(chunk['content'])
            
            if text_parts:
                return '\n\n'.join(text_parts)
        
        # Fallback to raw text
        return document.get('text', '')


async def process_document(pdf_path: str, access_token: str, use_layout: bool = True) -> dict:
    """Process a single PDF document."""
    pdf_name = Path(pdf_path).stem
    output_path = OCR_DIR / f"{pdf_name}.txt"
    
    # Skip if already processed
    if output_path.exists():
        return {'name': pdf_name, 'status': 'skipped'}
    
    file_size_mb = Path(pdf_path).stat().st_size / (1024 * 1024)
    
    if file_size_mb > 20:
        return {'name': pdf_name, 'status': 'failed', 'error': 'File too large (>20MB)'}
    
    try:
        # Split PDF into chunks
        chunks = split_pdf(pdf_path, TEMP_DIR, CONFIG['max_pages_per_request'])
        
        if not chunks:
            return {'name': pdf_name, 'status': 'failed', 'error': 'Failed to split PDF'}
        
        full_text = ''
        
        async with aiohttp.ClientSession() as session:
            for i, chunk in enumerate(chunks):
                if len(chunks) > 1:
                    print(f"    Chunk {i+1}/{len(chunks)} (pages {chunk['start']}-{chunk['end']})")
                
                chunk_text = await process_chunk_with_layout(
                    session, chunk['path'], access_token, use_layout
                )
                full_text += chunk_text
                
                # Clean up temp chunk file
                if chunk['path'] != pdf_path:
                    try:
                        Path(chunk['path']).unlink()
                    except:
                        pass
        
        # Save the text
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(full_text)
        
        return {'name': pdf_name, 'status': 'success', 'chars': len(full_text)}
        
    except Exception as e:
        return {'name': pdf_name, 'status': 'failed', 'error': str(e)}


async def process_with_concurrency(pdf_files: list, concurrency: int, 
                                    access_token: str, use_layout: bool = True):
    """Process multiple PDFs with concurrency limit."""
    semaphore = asyncio.Semaphore(concurrency)
    
    async def bounded_process(pdf_path):
        async with semaphore:
            result = await process_document(pdf_path, access_token, use_layout)
            
            if result['status'] == 'success':
                print(f"✓ {result['name']} ({result['chars']:,} chars)")
            elif result['status'] == 'skipped':
                print(f"⏭ {result['name']} (skipped)")
            else:
                print(f"✗ {result['name']}: {result.get('error', 'Unknown error')}")
            
            return result
    
    tasks = [bounded_process(pdf) for pdf in pdf_files]
    return await asyncio.gather(*tasks)


async def main():
    print('=' * 60)
    print('Google Document AI OCR - LAYOUT PARSER')
    print('=' * 60)
    
    # Check for Layout Parser processor
    use_layout = bool(CONFIG['layout_processor_id'])
    if use_layout:
        print(f"\n✓ Using Layout Parser: {CONFIG['layout_processor_id']}")
        print("  (Proper multi-column reading order)")
    else:
        print(f"\n⚠️  No Layout Parser configured, using basic OCR: {CONFIG['ocr_processor_id']}")
        print("  Set LAYOUT_PARSER_PROCESSOR_ID to enable Layout Parser")
    
    # Check credentials
    if not CONFIG['credentials_path'].exists():
        print(f"\n❌ Credentials not found: {CONFIG['credentials_path']}")
        sys.exit(1)
    
    print(f"\nProject: {CONFIG['project_number']}")
    print(f"Concurrency: {CONFIG['concurrency']} parallel requests")
    print(f"Input: {PDF_DIR}")
    print(f"Output: {OCR_DIR}")
    
    # Get PDF files
    if not PDF_DIR.exists():
        print(f"\n❌ PDF directory not found: {PDF_DIR}")
        sys.exit(1)
    
    pdf_files = sorted([str(f) for f in PDF_DIR.glob('*.pdf')])
    
    if not pdf_files:
        print("\n❌ No PDF files found")
        sys.exit(1)
    
    print(f"\nFound {len(pdf_files)} PDF files\n")
    print("Starting processing...\n")
    
    # Get access token
    access_token = get_access_token()
    
    # Process files
    import time
    start_time = time.time()
    
    results = await process_with_concurrency(
        pdf_files, 
        CONFIG['concurrency'], 
        access_token,
        use_layout
    )
    
    elapsed = time.time() - start_time
    
    # Cleanup temp directory
    try:
        shutil.rmtree(TEMP_DIR)
    except:
        pass
    
    # Summary
    success = sum(1 for r in results if r['status'] == 'success')
    skipped = sum(1 for r in results if r['status'] == 'skipped')
    failed = sum(1 for r in results if r['status'] == 'failed')
    
    print(f"\n{'=' * 60}")
    print(f"COMPLETE in {elapsed:.1f}s")
    print('=' * 60)
    print(f"Processed: {success}")
    print(f"Skipped: {skipped}")
    print(f"Failed: {failed}")
    print(f"\nOutput: {OCR_DIR}")


async def process_single_file(pdf_path: str):
    """Process a single PDF file."""
    print('=' * 60)
    print('Google Document AI OCR - Single File (Layout Parser)')
    print('=' * 60)
    
    if not Path(pdf_path).exists():
        print(f"\n❌ File not found: {pdf_path}")
        sys.exit(1)
    
    use_layout = bool(CONFIG['layout_processor_id'])
    if use_layout:
        print(f"\n✓ Using Layout Parser: {CONFIG['layout_processor_id']}")
    else:
        print(f"\n⚠️  Using basic OCR: {CONFIG['ocr_processor_id']}")
    
    access_token = get_access_token()
    
    print(f"\nProcessing: {Path(pdf_path).name}")
    result = await process_document(pdf_path, access_token, use_layout)
    
    if result['status'] == 'success':
        print(f"\n✓ Complete! Saved {result['chars']:,} characters")
    elif result['status'] == 'skipped':
        print("\n✓ Already processed")
    else:
        print(f"\n❌ Failed: {result.get('error', 'Unknown error')}")


if __name__ == '__main__':
    if len(sys.argv) > 1:
        # Single file mode
        asyncio.run(process_single_file(sys.argv[1]))
    else:
        # Process all files
        asyncio.run(main())

