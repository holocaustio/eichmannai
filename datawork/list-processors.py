#!/usr/bin/env python3
"""
List available Document AI processors in the project.
"""

import json
from pathlib import Path
from google.oauth2 import service_account
from google.auth.transport.requests import Request
import urllib.request
import urllib.error

PROJECT_NUMBER = '261156330246'
LOCATION = 'us'
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
CREDENTIALS_PATH = PROJECT_ROOT / 'google-credentials.json'


def get_access_token():
    credentials = service_account.Credentials.from_service_account_file(
        str(CREDENTIALS_PATH),
        scopes=['https://www.googleapis.com/auth/cloud-platform']
    )
    credentials.refresh(Request())
    return credentials.token


def list_processors():
    token = get_access_token()
    
    url = f"https://{LOCATION}-documentai.googleapis.com/v1/projects/{PROJECT_NUMBER}/locations/{LOCATION}/processors"
    
    req = urllib.request.Request(url, headers={
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
    })
    
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            return data.get('processors', [])
    except urllib.error.HTTPError as e:
        print(f"Error: {e.code} - {e.read().decode()[:200]}")
        return []


def main():
    print("=" * 60)
    print("Document AI Processors")
    print("=" * 60)
    print(f"\nProject: {PROJECT_NUMBER}")
    print(f"Location: {LOCATION}\n")
    
    processors = list_processors()
    
    if not processors:
        print("No processors found.\n")
        print("To create a Layout Parser:")
        print("1. Go to https://console.cloud.google.com/ai/document-ai/processors")
        print("2. Click 'Create Processor'")
        print("3. Select 'Layout Parser'")
        print("4. Name it and create")
        print("5. Copy the Processor ID")
        return
    
    print(f"Found {len(processors)} processor(s):\n")
    
    layout_parsers = []
    
    for p in processors:
        name = p.get('displayName', 'Unknown')
        ptype = p.get('type', 'Unknown')
        processor_id = p.get('name', '').split('/')[-1]
        state = p.get('state', 'Unknown')
        
        print(f"  {name}")
        print(f"    ID: {processor_id}")
        print(f"    Type: {ptype}")
        print(f"    State: {state}")
        print()
        
        if 'LAYOUT' in ptype.upper():
            layout_parsers.append(processor_id)
    
    if layout_parsers:
        print("-" * 60)
        print("✓ Found Layout Parser(s)!")
        print(f"\nTo use Layout Parser, set environment variable:")
        print(f"  export LAYOUT_PARSER_PROCESSOR_ID='{layout_parsers[0]}'")
        print(f"\nOr add to the script CONFIG.")
    else:
        print("-" * 60)
        print("⚠️  No Layout Parser found.")
        print("\nTo create one:")
        print("1. Go to https://console.cloud.google.com/ai/document-ai/processors")
        print(f"   (Make sure project {PROJECT_NUMBER} is selected)")
        print("2. Click 'Create Processor'")
        print("3. Select 'Layout Parser' from the list")
        print("4. Give it a name and click 'Create'")
        print("5. Copy the Processor ID from the processor details page")


if __name__ == '__main__':
    main()

