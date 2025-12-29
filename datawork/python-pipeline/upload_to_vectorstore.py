#!/usr/bin/env python3
"""
Upload OCR files to OpenAI Vector Store.

Usage:
    python upload_to_vectorstore.py --test  # Upload single test file
    python upload_to_vectorstore.py --all   # Upload all OCR files
"""

import os
import sys
import json
import argparse
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
# Upload to Vector Store
# =============================================================================

def upload_file_to_vectorstore(client: OpenAI, file_path: Path, vector_store_id: str) -> Dict:
    """Upload a single file to OpenAI and add to vector store."""
    try:
        # Step 1: Upload file with purpose "assistants"
        print(f"     Uploading {file_path.name}...")
        with open(file_path, "rb") as f:
            file_response = client.files.create(
                file=f,
                purpose="assistants"  # Use assistants purpose for vector store
            )
        
        file_id = file_response.id
        print(f"     File uploaded: {file_id}")
        
        # Step 2: Add file to vector store
        print(f"     Adding to vector store...")
        vs_file = client.vector_stores.files.create(
            vector_store_id=vector_store_id,
            file_id=file_id
        )
        
        return {
            "success": True,
            "file_id": file_id,
            "vector_store_file_id": vs_file.id,
            "filename": file_response.filename,
            "bytes": file_response.bytes,
            "status": vs_file.status
        }
    
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def list_vectorstore_files(client: OpenAI, vector_store_id: str) -> Dict[str, str]:
    """List existing files in the vector store."""
    try:
        files = client.vector_stores.files.list(vector_store_id=vector_store_id)
        
        result = {}
        for f in files.data:
            # Get the original file info
            try:
                file_info = client.files.retrieve(f.id)
                result[file_info.filename] = f.id
            except:
                result[f.id] = f.id
        
        return result
    except Exception as e:
        print(f"⚠️ Could not list vector store files: {e}")
        return {}


def upload_files_to_vectorstore(file_paths: List[Path], vector_store_id: str, skip_existing: bool = True) -> Dict:
    """Upload multiple files to OpenAI vector store."""
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
    # Check existing files in vector store
    existing = {}
    if skip_existing:
        print("📋 Checking existing files in vector store...")
        existing = list_vectorstore_files(client, vector_store_id)
        print(f"   Found {len(existing)} existing files")
    
    results = {
        "uploaded": [],
        "skipped": [],
        "failed": []
    }
    
    for file_path in tqdm(file_paths, desc="Processing"):
        filename = file_path.name
        
        # Skip if already exists
        if skip_existing and filename in existing:
            results["skipped"].append({
                "filename": filename,
                "file_id": existing[filename]
            })
            print(f"   ⏭️ Skipping {filename} (already exists)")
            continue
        
        result = upload_file_to_vectorstore(client, file_path, vector_store_id)
        
        if result["success"]:
            results["uploaded"].append({
                "filename": filename,
                "file_id": result["file_id"],
                "vs_file_id": result["vector_store_file_id"],
                "bytes": result["bytes"],
                "status": result["status"],
                "local_path": str(file_path)
            })
            print(f"   ✅ Uploaded {filename}")
        else:
            results["failed"].append({
                "filename": filename,
                "error": result["error"]
            })
            print(f"   ❌ Failed {filename}: {result['error']}")
    
    return results


def create_file_index(results: Dict, vector_store_id: str, existing_index: Dict = None) -> Dict:
    """Create a file index from upload results."""
    index = existing_index or {
        "created_at": datetime.now().isoformat(),
        "vector_store_id": vector_store_id,
        "files": {}
    }
    
    # Update
    index["updated_at"] = datetime.now().isoformat()
    index["vector_store_id"] = vector_store_id
    
    # Add uploaded files
    for item in results.get("uploaded", []):
        index["files"][item["filename"]] = {
            "file_id": item["file_id"],
            "vs_file_id": item["vs_file_id"],
            "bytes": item["bytes"],
            "status": item["status"],
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
    parser = argparse.ArgumentParser(description="Upload OCR files to OpenAI Vector Store")
    parser.add_argument("--test", action="store_true", help="Upload single test file")
    parser.add_argument("--all", action="store_true", help="Upload all OCR files")
    parser.add_argument("--file", help="Upload specific file")
    parser.add_argument("--list", action="store_true", help="List files in vector store")
    parser.add_argument("--vector-store", default=VECTOR_STORE_ID, help="Vector store ID")
    args = parser.parse_args()
    
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
    # List mode
    if args.list:
        print(f"📋 Files in Vector Store: {args.vector_store}")
        print("-" * 60)
        
        try:
            files = client.vector_stores.files.list(vector_store_id=args.vector_store)
            for f in files.data:
                try:
                    file_info = client.files.retrieve(f.id)
                    print(f"  {file_info.filename}: {f.id} ({f.status})")
                except:
                    print(f"  {f.id}: {f.status}")
            print(f"\nTotal: {len(files.data)} files")
        except Exception as e:
            print(f"❌ Error: {e}")
        
        # Also show local index
        if OUTPUT_INDEX.exists():
            print(f"\n📁 Local Index: {OUTPUT_INDEX}")
            with open(OUTPUT_INDEX) as f:
                index = json.load(f)
            print(f"   Total files: {index.get('total_files', 0)}")
        return
    
    # Select files to upload
    if args.test:
        files = [OCR_DIR / "Vol1_p15291.txt"]
    elif args.file:
        files = [OCR_DIR / args.file]
    elif args.all:
        files = sorted(OCR_DIR.glob("*.txt"))
    else:
        print("❌ Specify --test, --all, or --file <filename>")
        return
    
    # Filter to existing files
    files = [f for f in files if f.exists()]
    
    if not files:
        print("❌ No files found to upload")
        return
    
    print(f"\n{'='*60}")
    print("OpenAI Vector Store Upload")
    print(f"{'='*60}")
    print(f"Files to upload: {len(files)}")
    print(f"Vector store: {args.vector_store}")
    
    # Load existing index
    existing_index = None
    if OUTPUT_INDEX.exists():
        with open(OUTPUT_INDEX) as f:
            existing_index = json.load(f)
        print(f"Existing index: {existing_index.get('total_files', 0)} files")
    
    # Upload files
    print(f"\n📤 Uploading files to vector store...")
    results = upload_files_to_vectorstore(files, args.vector_store)
    
    # Print results
    print(f"\n{'='*60}")
    print("RESULTS")
    print(f"{'='*60}")
    print(f"✅ Uploaded: {len(results['uploaded'])}")
    print(f"⏭️ Skipped (existing): {len(results['skipped'])}")
    print(f"❌ Failed: {len(results['failed'])}")
    
    if results["failed"]:
        print("\n   Failed files:")
        for item in results["failed"]:
            print(f"     {item['filename']}: {item['error']}")
    
    # Create/update index
    index = create_file_index(results, args.vector_store, existing_index)
    
    # Save index
    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_INDEX, 'w', encoding='utf-8') as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
    
    print(f"\n📁 Index saved: {OUTPUT_INDEX}")
    print(f"   Total files in index: {index['total_files']}")
    
    # Print sample file IDs for testing
    if results["uploaded"]:
        print(f"\n📝 Sample file IDs for API testing:")
        for item in results["uploaded"][:3]:
            print(f"   {item['filename']}: {item['file_id']}")


if __name__ == "__main__":
    main()

