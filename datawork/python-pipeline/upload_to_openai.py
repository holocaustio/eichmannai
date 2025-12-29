#!/usr/bin/env python3
"""
Upload OCR files to OpenAI and create a file index.

Usage:
    python upload_to_openai.py --test  # Upload single test file
    python upload_to_openai.py --all   # Upload all OCR files
"""

import os
import sys
import json
import argparse
import asyncio
from pathlib import Path
from datetime import datetime
from typing import List, Dict

from openai import OpenAI
from dotenv import load_dotenv
from tqdm import tqdm

load_dotenv()

# =============================================================================
# Configuration
# =============================================================================

BASE_DIR = Path(__file__).parent.parent.parent
OCR_DIR = BASE_DIR / "downloads" / "pdf" / "OCR"
APP_DATA_DIR = BASE_DIR / "app" / "public" / "data"
OUTPUT_INDEX = APP_DATA_DIR / "file-index.json"

# Vector store ID (provided by user)
VECTOR_STORE_ID = "vs_69510f678bc8819184b2fbe81d46736e"

# =============================================================================
# Upload Functions
# =============================================================================

def upload_file(client: OpenAI, file_path: Path) -> Dict:
    """Upload a single file to OpenAI."""
    try:
        with open(file_path, "rb") as f:
            response = client.files.create(
                file=f,
                purpose="user_data"
            )
        
        return {
            "success": True,
            "file_id": response.id,
            "filename": response.filename,
            "bytes": response.bytes,
            "created_at": response.created_at
        }
    
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def list_existing_files(client: OpenAI) -> Dict[str, str]:
    """List existing files on OpenAI to avoid duplicates."""
    try:
        files = client.files.list()
        return {f.filename: f.id for f in files.data}
    except Exception as e:
        print(f"⚠️ Could not list existing files: {e}")
        return {}


def upload_files(file_paths: List[Path], skip_existing: bool = True) -> Dict:
    """Upload multiple files to OpenAI."""
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
    # Check existing files
    existing = {}
    if skip_existing:
        print("📋 Checking existing files on OpenAI...")
        existing = list_existing_files(client)
        print(f"   Found {len(existing)} existing files")
    
    results = {
        "uploaded": [],
        "skipped": [],
        "failed": []
    }
    
    for file_path in tqdm(file_paths, desc="Uploading"):
        filename = file_path.name
        
        # Skip if already exists
        if skip_existing and filename in existing:
            results["skipped"].append({
                "filename": filename,
                "file_id": existing[filename]
            })
            continue
        
        result = upload_file(client, file_path)
        
        if result["success"]:
            results["uploaded"].append({
                "filename": filename,
                "file_id": result["file_id"],
                "bytes": result["bytes"],
                "local_path": str(file_path)
            })
        else:
            results["failed"].append({
                "filename": filename,
                "error": result["error"]
            })
    
    return results


def create_file_index(results: Dict, existing_index: Dict = None) -> Dict:
    """Create a file index from upload results."""
    index = existing_index or {
        "created_at": datetime.now().isoformat(),
        "vector_store_id": VECTOR_STORE_ID,
        "files": {}
    }
    
    # Update timestamp
    index["updated_at"] = datetime.now().isoformat()
    
    # Add uploaded files
    for item in results.get("uploaded", []):
        index["files"][item["filename"]] = {
            "file_id": item["file_id"],
            "bytes": item["bytes"],
            "uploaded_at": datetime.now().isoformat()
        }
    
    # Add skipped files (already existed)
    for item in results.get("skipped", []):
        if item["filename"] not in index["files"]:
            index["files"][item["filename"]] = {
                "file_id": item["file_id"],
                "uploaded_at": "existing"
            }
    
    index["total_files"] = len(index["files"])
    
    return index


# =============================================================================
# Main
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="Upload OCR files to OpenAI")
    parser.add_argument("--test", action="store_true", help="Upload single test file")
    parser.add_argument("--all", action="store_true", help="Upload all OCR files")
    parser.add_argument("--file", help="Upload specific file")
    parser.add_argument("--list", action="store_true", help="List files in index")
    args = parser.parse_args()
    
    # List mode
    if args.list:
        if OUTPUT_INDEX.exists():
            with open(OUTPUT_INDEX) as f:
                index = json.load(f)
            print(f"📁 File Index: {OUTPUT_INDEX}")
            print(f"   Total files: {index.get('total_files', 0)}")
            print(f"   Created: {index.get('created_at', 'N/A')}")
            print(f"   Updated: {index.get('updated_at', 'N/A')}")
            print(f"\n   Files:")
            for filename, info in list(index.get("files", {}).items())[:10]:
                print(f"     {filename}: {info.get('file_id', 'N/A')}")
            if len(index.get("files", {})) > 10:
                print(f"     ... and {len(index.get('files', {})) - 10} more")
        else:
            print("❌ No file index found")
        return
    
    # Select files to upload
    if args.test:
        files = [OCR_DIR / "Vol1_p15291.txt"]
    elif args.file:
        files = [OCR_DIR / args.file]
    elif args.all:
        files = list(OCR_DIR.glob("*.txt"))
    else:
        print("❌ Specify --test, --all, or --file <filename>")
        return
    
    # Filter to existing files
    files = [f for f in files if f.exists()]
    
    if not files:
        print("❌ No files found to upload")
        return
    
    print(f"\n{'='*60}")
    print("OpenAI File Upload")
    print(f"{'='*60}")
    print(f"Files to upload: {len(files)}")
    print(f"Vector store: {VECTOR_STORE_ID}")
    
    # Load existing index
    existing_index = None
    if OUTPUT_INDEX.exists():
        with open(OUTPUT_INDEX) as f:
            existing_index = json.load(f)
        print(f"Existing index: {existing_index.get('total_files', 0)} files")
    
    # Upload files
    print(f"\n📤 Uploading files...")
    results = upload_files(files)
    
    # Print results
    print(f"\n✅ Uploaded: {len(results['uploaded'])}")
    print(f"⏭️ Skipped (existing): {len(results['skipped'])}")
    print(f"❌ Failed: {len(results['failed'])}")
    
    if results["failed"]:
        print("\n   Failed files:")
        for item in results["failed"]:
            print(f"     {item['filename']}: {item['error']}")
    
    # Create/update index
    index = create_file_index(results, existing_index)
    
    # Save index
    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_INDEX, 'w', encoding='utf-8') as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
    
    print(f"\n📁 Index saved: {OUTPUT_INDEX}")
    print(f"   Total files in index: {index['total_files']}")
    
    # Print sample file IDs for testing
    if results["uploaded"]:
        print(f"\n📝 Sample file IDs for testing:")
        for item in results["uploaded"][:3]:
            print(f"   {item['filename']}: {item['file_id']}")


if __name__ == "__main__":
    main()

