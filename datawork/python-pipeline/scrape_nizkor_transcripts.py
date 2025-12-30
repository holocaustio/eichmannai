#!/usr/bin/env python3
"""
Nizkor Project Eichmann Trial Transcripts Scraper

Scrapes the complete English transcripts from the Wayback Machine archive of
the Nizkor Project's Eichmann trial transcripts.

Source: https://web.archive.org/web/20230518010628/http://www.nizkor.com/hweb/people/e/eichmann-adolf/transcripts/Sessions/

Usage:
    python scrape_nizkor_transcripts.py [--test] [--volume N]
    
Options:
    --test      Only download first 3 sessions for testing
    --volume N  Only download volume N (1-5)
"""

import asyncio
import aiohttp
import os
import re
import json
import argparse
from pathlib import Path
from datetime import datetime
from bs4 import BeautifulSoup
from tqdm import tqdm
import time

# Base URLs for the Wayback Machine archive
WAYBACK_BASE = "https://web.archive.org/web"
NIZKOR_BASE = "http://www.nizkor.com/hweb/people/e/eichmann-adolf/transcripts/Sessions"

# Index page snapshots (using known working timestamps)
VOLUME_INDICES = {
    1: "20230428180113",
    2: "20230423134219",
    3: "20230428034952",
    4: "20230605011254",
    5: "20230605005437",
}

# Output directory
SCRIPT_DIR = Path(__file__).parent
OUTPUT_DIR = SCRIPT_DIR.parent.parent / "downloads" / "nizkor-transcripts"
PROGRESS_FILE = OUTPUT_DIR / ".progress.json"

# Rate limiting - be gentle with Wayback Machine
REQUEST_DELAY = 0.5  # seconds between requests
MAX_RETRIES = 5
MAX_CONCURRENT = 3  # Maximum concurrent requests (be nice to Wayback Machine)


def get_wayback_url(path: str, timestamp: str = "20230608043549") -> str:
    """Build a Wayback Machine URL for a given path."""
    if path.startswith("http"):
        return f"{WAYBACK_BASE}/{timestamp}/{path}"
    return f"{WAYBACK_BASE}/{timestamp}/{NIZKOR_BASE}/{path}"


def clean_text(text: str) -> str:
    """Clean extracted text while preserving intentional formatting."""
    # Normalize line endings
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    
    # Remove more than 2 consecutive newlines
    text = re.sub(r'\n{3,}', '\n\n', text)
    
    # Split into paragraphs (separated by double newlines)
    paragraphs = re.split(r'\n\n+', text)
    
    cleaned_paragraphs = []
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        
        # Check if this is a blockquote block (all lines start with >)
        lines = para.split('\n')
        if all(line.strip().startswith('>') for line in lines if line.strip()):
            # Keep blockquotes as-is (they have intentional line breaks)
            cleaned_paragraphs.append(para)
        # Check if this is a heading (starts with #)
        elif para.startswith('#'):
            cleaned_paragraphs.append(para)
        # Check if it's a horizontal rule
        elif para.strip() == '---':
            cleaned_paragraphs.append(para)
        # Check if this is a markdown list (- item on each line)
        elif all(line.strip().startswith('- ') for line in lines if line.strip()):
            cleaned_paragraphs.append(para)
        else:
            # Regular paragraph (including numbered text) - unwrap lines
            unwrapped = re.sub(r'(?<!\n)\n(?!\n)', ' ', para)
            # Clean up multiple spaces
            unwrapped = re.sub(r' {2,}', ' ', unwrapped)
            cleaned_paragraphs.append(unwrapped.strip())
    
    # Join paragraphs with double newlines
    text = '\n\n'.join(cleaned_paragraphs)
    
    return text.strip()


def convert_html_to_markdown(element) -> str:
    """Convert an HTML element to markdown, preserving formatting."""
    if element is None:
        return ""
    
    if isinstance(element, str):
        return element.strip()
    
    # Handle different tag types
    tag_name = element.name if hasattr(element, 'name') else None
    
    if tag_name is None:
        return str(element).strip()
    
    # Skip certain elements
    if tag_name in ['script', 'style', 'link', 'iframe', 'form', 'input', 'button']:
        return ""
    
    # Handle bold tags - convert to markdown
    if tag_name in ['b', 'strong']:
        inner_text = ''.join(convert_html_to_markdown(child) for child in element.children)
        inner_text = inner_text.strip()
        if inner_text:
            return f"**{inner_text}**"
        return ""
    
    # Handle italic tags
    if tag_name in ['i', 'em']:
        inner_text = ''.join(convert_html_to_markdown(child) for child in element.children)
        inner_text = inner_text.strip()
        if inner_text:
            return f"*{inner_text}*"
        return ""
    
    # Handle paragraphs - add double newlines
    if tag_name == 'p':
        inner_text = ''.join(convert_html_to_markdown(child) for child in element.children)
        inner_text = inner_text.strip()
        if inner_text:
            return f"\n\n{inner_text}\n\n"
        return "\n\n"
    
    # Handle line breaks
    if tag_name == 'br':
        return "\n"
    
    # Handle horizontal rules
    if tag_name == 'hr':
        return "\n\n---\n\n"
    
    # Handle headings
    if tag_name in ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']:
        level = int(tag_name[1])
        inner_text = ''.join(convert_html_to_markdown(child) for child in element.children)
        inner_text = inner_text.strip()
        if inner_text:
            return f"\n\n{'#' * level} {inner_text}\n\n"
        return ""
    
    # Handle blockquotes
    if tag_name == 'blockquote':
        inner_text = ''.join(convert_html_to_markdown(child) for child in element.children)
        inner_text = inner_text.strip()
        if inner_text:
            # Add > to each line
            lines = inner_text.split('\n')
            quoted = '\n'.join(f"> {line}" if line.strip() else ">" for line in lines)
            return f"\n\n{quoted}\n\n"
        return ""
    
    # Handle lists
    if tag_name == 'ul':
        items = []
        for child in element.children:
            if hasattr(child, 'name') and child.name == 'li':
                item_text = ''.join(convert_html_to_markdown(c) for c in child.children).strip()
                if item_text:
                    items.append(f"- {item_text}")
        if items:
            return "\n\n" + "\n".join(items) + "\n\n"
        return ""
    
    if tag_name == 'ol':
        items = []
        for i, child in enumerate(element.children, 1):
            if hasattr(child, 'name') and child.name == 'li':
                item_text = ''.join(convert_html_to_markdown(c) for c in child.children).strip()
                if item_text:
                    items.append(f"{i}. {item_text}")
        if items:
            return "\n\n" + "\n".join(items) + "\n\n"
        return ""
    
    # Handle center tags (often used for titles)
    if tag_name == 'center':
        inner_text = ''.join(convert_html_to_markdown(child) for child in element.children)
        inner_text = inner_text.strip()
        if inner_text:
            return f"\n\n{inner_text}\n\n"
        return ""
    
    # Handle font tags (just get content)
    if tag_name == 'font':
        return ''.join(convert_html_to_markdown(child) for child in element.children)
    
    # Handle div, span, and other containers - just recurse
    if tag_name in ['div', 'span', 'td', 'th', 'tr', 'table', 'tbody', 'thead']:
        return ''.join(convert_html_to_markdown(child) for child in element.children)
    
    # Handle anchor tags - just get the text
    if tag_name == 'a':
        return ''.join(convert_html_to_markdown(child) for child in element.children)
    
    # Handle images - skip or get alt text
    if tag_name == 'img':
        alt = element.get('alt', '')
        if alt and 'banner' not in alt.lower() and 'pixel' not in alt.lower():
            return f"[{alt}]"
        return ""
    
    # Default: recurse into children
    if hasattr(element, 'children'):
        return ''.join(convert_html_to_markdown(child) for child in element.children)
    
    return ""


def extract_transcript_content(html: str, url: str = "") -> dict:
    """Extract transcript content from HTML page, preserving formatting."""
    soup = BeautifulSoup(html, 'lxml')
    
    # Remove Wayback Machine elements completely
    for element in soup.find_all(['script', 'style', 'link']):
        element.decompose()
    
    # Remove Wayback Machine toolbar/banner divs
    for div in soup.find_all('div', id=re.compile(r'^wm-')):
        div.decompose()
    for div in soup.find_all('div', id='donato'):
        div.decompose()
    for div in soup.find_all('div', id='donato-base'):
        div.decompose()
    for div in soup.find_all(id='wm-ipp-base'):
        div.decompose()
    for div in soup.find_all(id='wm-ipp-print'):
        div.decompose()
    
    # Remove Nizkor banner image
    for img in soup.find_all('img', alt=re.compile(r'Nizkor', re.I)):
        img.decompose()
    
    # Find the body content
    body = soup.find('body')
    if not body:
        return {"content": "", "title": "", "session": ""}
    
    # Extract title
    title_tag = soup.find('title')
    title = title_tag.get_text() if title_tag else ""
    
    # Convert body content to markdown
    content_parts = []
    for element in body.children:
        # Skip navigation elements at the bottom
        if hasattr(element, 'get_text'):
            text_preview = element.get_text()[:50] if element.get_text() else ""
            if '[ Index' in text_preview or '[Index' in text_preview:
                continue
            if 'an error occurred' in text_preview.lower():
                continue
        
        converted = convert_html_to_markdown(element)
        if converted and converted.strip():
            content_parts.append(converted)
    
    raw_content = ''.join(content_parts)
    
    # Remove Wayback Machine artifacts that might have slipped through
    raw_content = re.sub(r'The Wayback Machine - https?://[^\s]+', '', raw_content)
    raw_content = re.sub(r'\d+ captures.*?loading', '', raw_content, flags=re.DOTALL)
    raw_content = re.sub(r'success\s*fail', '', raw_content)
    raw_content = re.sub(r'About this capture.*?TIMESTAMPS', '', raw_content, flags=re.DOTALL)
    raw_content = re.sub(r'COLLECTED BY.*?loading', '', raw_content, flags=re.DOTALL)
    raw_content = re.sub(r'BEGIN WAYBACK TOOLBAR INSERT.*?END WAYBACK TOOLBAR INSERT', '', raw_content, flags=re.DOTALL)
    
    # Remove the Nizkor banner text
    raw_content = re.sub(r"The Nizkor Project: Remembering the Holocaust \(Shoah\)\s*", '', raw_content)
    
    # Remove SEO/metadata artifacts
    raw_content = re.sub(r'Eichmann trial, Adolf Eichmann - Holocaust link to Nuremberg trial\[.*?\]', '', raw_content)
    raw_content = re.sub(r'\[Holocaust, Adolf Eichmann, Eichmann trial, holocaust, Jewish holocaust\]', '', raw_content)
    
    # Add space after bold colons for readability (e.g., **Judge:**text -> **Judge:** text)
    raw_content = re.sub(r'\*\*([^*]+):\*\*(?!\s)', r'**\1:** ', raw_content)
    
    # Fix errant colons after "Accused" when used as a noun (not speaker label)
    # Speaker labels are followed by capital letters or brackets, not lowercase words
    raw_content = re.sub(r'\bAccused:\s+([a-z])', r'Accused \1', raw_content)
    raw_content = re.sub(r'\*\*Accused:\*\*\s+([a-z])', r'**Accused** \1', raw_content)
    
    # Fix missing space after punctuation
    raw_content = re.sub(r',([a-zA-Z])', r', \1', raw_content)
    raw_content = re.sub(r'\.([A-Z])', r'. \1', raw_content)
    
    # Fix double/multiple spaces (but preserve intentional line-start indentation in blockquotes)
    raw_content = re.sub(r'(?<=>)  +', ' ', raw_content)  # In blockquotes after >
    raw_content = re.sub(r'([^\n>])  +', r'\1 ', raw_content)  # Elsewhere
    
    # Extract session number if present
    session_match = re.search(r'Session\s+(?:No\.\s*)?(\d+)', raw_content)
    session = session_match.group(1) if session_match else ""
    
    content = clean_text(raw_content)
    
    return {
        "content": content,
        "title": title.strip(),
        "session": session,
    }


async def fetch_page(session: aiohttp.ClientSession, url: str, semaphore: asyncio.Semaphore = None, verbose: bool = False) -> str | None:
    """Fetch a page with retries and optional semaphore for rate limiting."""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Connection': 'keep-alive',
    }
    
    async def do_fetch():
        for attempt in range(MAX_RETRIES):
            try:
                await asyncio.sleep(REQUEST_DELAY * (attempt + 1))  # Increasing delay on retries
                async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=90)) as response:
                    if response.status == 200:
                        return await response.text()
                    elif response.status == 404:
                        if verbose:
                            print(f"  404: {url}")
                        return None
                    elif response.status == 429:  # Too many requests
                        wait_time = 5 * (2 ** attempt)
                        if verbose:
                            print(f"  Rate limited, waiting {wait_time}s...")
                        await asyncio.sleep(wait_time)
                    elif response.status == 503:  # Service unavailable
                        wait_time = 3 * (attempt + 1)
                        if verbose:
                            print(f"  503 error, waiting {wait_time}s...")
                        await asyncio.sleep(wait_time)
                    else:
                        if verbose:
                            print(f"  Status {response.status}: {url}")
                        await asyncio.sleep(2)
            except asyncio.TimeoutError:
                if verbose:
                    print(f"  Timeout (attempt {attempt + 1}): {url}")
                await asyncio.sleep(2 * (attempt + 1))
            except Exception as e:
                if verbose:
                    print(f"  Error (attempt {attempt + 1}): {e}")
                await asyncio.sleep(2 * (attempt + 1))
        return None
    
    if semaphore:
        async with semaphore:
            return await do_fetch()
    else:
        return await do_fetch()


def parse_session_links_from_index(html: str, volume: int) -> list[dict]:
    """Parse session links from an index page."""
    soup = BeautifulSoup(html, 'lxml')
    sessions = []
    
    # Find all links that match session patterns
    for link in soup.find_all('a', href=True):
        href = link['href']
        text = link.get_text(strip=True)
        
        # Match session pages like Session-001-01.html
        match = re.match(r'Session-(\d+(?:-\d+)?)-(\d+)\.html', href)
        if match:
            session_id = match.group(1)
            part = int(match.group(2))
            
            sessions.append({
                'session_id': session_id,
                'part': part,
                'href': href,
                'text': text,
                'volume': volume,
            })
        
        # Also capture special pages like Defence-Submission, Testimony-In-Camera, etc.
        elif 'Defence-Submission' in href or 'Testimony-' in href:
            sessions.append({
                'session_id': href.replace('.html', ''),
                'part': 1,
                'href': href,
                'text': text,
                'volume': volume,
                'special': True,
            })
    
    return sessions


async def fetch_and_extract(session: aiohttp.ClientSession, part_info: dict, timestamp: str, semaphore: asyncio.Semaphore) -> tuple[int, dict | None]:
    """Fetch a page and extract content. Returns (part_number, extracted_content)."""
    part_url = get_wayback_url(part_info['href'], timestamp)
    html = await fetch_page(session, part_url, semaphore)
    
    if html:
        extracted = extract_transcript_content(html, part_url)
        return (part_info['part'], extracted)
    return (part_info['part'], None)


async def discover_all_parts(session: aiohttp.ClientSession, session_id: str, known_parts: list[dict], timestamp: str, semaphore: asyncio.Semaphore) -> list[dict]:
    """Discover all parts for a session by probing for additional part numbers."""
    # Get the maximum known part number
    max_known = max(p['part'] for p in known_parts) if known_parts else 0
    
    # Probe for additional parts (up to 15 parts max)
    all_parts = list(known_parts)
    discovered_parts = set(p['part'] for p in known_parts)
    
    # Try to find missing parts between 1 and max, and parts beyond max
    parts_to_try = []
    for i in range(1, max_known + 10):  # Try up to 9 parts beyond max known
        if i not in discovered_parts:
            parts_to_try.append(i)
    
    if not parts_to_try:
        return all_parts
    
    # Build URLs to probe
    probe_tasks = []
    for part_num in parts_to_try:
        # Format the part number with leading zero for single digits
        href = f"Session-{session_id}-{part_num:02d}.html"
        probe_tasks.append((part_num, href))
    
    # Probe in parallel
    async def probe_part(part_num: int, href: str) -> dict | None:
        url = get_wayback_url(href, timestamp)
        html = await fetch_page(session, url, semaphore)
        if html and len(html) > 1000:  # Ensure it's a real page, not an error
            return {
                'session_id': session_id,
                'part': part_num,
                'href': href,
                'text': f'Part {part_num}',
                'volume': known_parts[0]['volume'] if known_parts else 1,
                'discovered': True,
            }
        return None
    
    results = await asyncio.gather(*[probe_part(p, h) for p, h in probe_tasks])
    
    for result in results:
        if result:
            all_parts.append(result)
    
    # Sort by part number
    all_parts.sort(key=lambda x: x['part'])
    
    return all_parts


async def scrape_volume(session: aiohttp.ClientSession, volume: int, test_mode: bool = False, semaphore: asyncio.Semaphore = None) -> dict:
    """Scrape all sessions from a volume using parallel downloads."""
    timestamp = VOLUME_INDICES[volume]
    index_url = get_wayback_url(f"index-0{volume}.html", timestamp)
    
    print(f"\n{'='*60}")
    print(f"Scraping Volume {volume}")
    print(f"Index URL: {index_url}")
    print(f"{'='*60}")
    
    # Fetch index page (with verbose for debugging)
    html = await fetch_page(session, index_url, semaphore, verbose=True)
    if not html:
        print(f"Failed to fetch index page for volume {volume}")
        # Try once more with a longer delay
        print("  Retrying after 5 second delay...")
        await asyncio.sleep(5)
        html = await fetch_page(session, index_url, semaphore, verbose=True)
        if not html:
            print(f"  Still failed. Skipping volume {volume}.")
            return {}
    
    # Parse session links
    session_links = parse_session_links_from_index(html, volume)
    print(f"Found {len(session_links)} session pages")
    
    # Group by session
    sessions_grouped = {}
    for link in session_links:
        sid = link['session_id']
        if sid not in sessions_grouped:
            sessions_grouped[sid] = []
        sessions_grouped[sid].append(link)
    
    # Sort parts within each session
    for sid in sessions_grouped:
        sessions_grouped[sid].sort(key=lambda x: x['part'])
    
    print(f"Grouped into {len(sessions_grouped)} unique sessions")
    
    if test_mode:
        # Only process first 3 sessions in test mode
        session_ids = list(sessions_grouped.keys())[:3]
        sessions_grouped = {k: v for k, v in sessions_grouped.items() if k in session_ids}
        print(f"Test mode: limiting to {len(sessions_grouped)} sessions")
    
    # Create volume output directory
    vol_dir = OUTPUT_DIR / f"vol{volume}"
    vol_dir.mkdir(parents=True, exist_ok=True)
    
    # Filter out already downloaded sessions
    sessions_to_download = {}
    results = {}
    for session_id, parts in sessions_grouped.items():
        output_file = vol_dir / f"{session_id}.md"
        if output_file.exists():
            results[session_id] = {"status": "skipped", "parts": len(parts)}
        else:
            sessions_to_download[session_id] = parts
    
    if results:
        print(f"Skipping {len(results)} already downloaded sessions")
    
    if not sessions_to_download:
        print("All sessions already downloaded")
        return results
    
    # First, discover all parts for each session (some parts may not be in the index)
    print(f"Discovering all parts for {len(sessions_to_download)} sessions...")
    discovery_tasks = []
    session_ids_ordered = list(sessions_to_download.keys())
    
    for session_id in session_ids_ordered:
        parts = sessions_to_download[session_id]
        discovery_tasks.append(discover_all_parts(session, session_id, parts, timestamp, semaphore))
    
    discovered_results = await asyncio.gather(*discovery_tasks)
    
    # Update sessions with discovered parts
    for session_id, all_parts in zip(session_ids_ordered, discovered_results):
        old_count = len(sessions_to_download[session_id])
        sessions_to_download[session_id] = all_parts
        if len(all_parts) > old_count:
            print(f"  {session_id}: found {len(all_parts) - old_count} additional parts (total: {len(all_parts)})")
    
    # Collect all pages to fetch
    all_fetch_tasks = []
    task_to_session = {}  # Map task index to (session_id, part_info)
    
    for session_id, parts in sessions_to_download.items():
        for part_info in parts:
            task_idx = len(all_fetch_tasks)
            all_fetch_tasks.append(fetch_and_extract(session, part_info, timestamp, semaphore))
            task_to_session[task_idx] = (session_id, part_info)
    
    print(f"Fetching {len(all_fetch_tasks)} pages in parallel...")
    
    # Fetch all pages in parallel
    fetch_results = await asyncio.gather(*all_fetch_tasks, return_exceptions=True)
    
    # Group results by session
    session_contents = {sid: {} for sid in sessions_to_download.keys()}
    session_titles = {sid: "" for sid in sessions_to_download.keys()}
    
    for idx, result in enumerate(fetch_results):
        session_id, part_info = task_to_session[idx]
        
        if isinstance(result, Exception):
            print(f"  Error fetching part {part_info['part']} of session {session_id}: {result}")
            continue
        
        part_num, extracted = result
        if extracted and extracted.get('content'):
            session_contents[session_id][part_num] = extracted['content']
            if not session_titles[session_id] and extracted.get('title'):
                session_titles[session_id] = extracted['title']
    
    # Save each session
    print(f"Saving {len(sessions_to_download)} sessions...")
    for session_id, parts in tqdm(sessions_to_download.items(), desc=f"Saving Vol {volume}"):
        output_file = vol_dir / f"{session_id}.md"
        
        # Get contents in order
        all_content = []
        for part_info in parts:
            part_num = part_info['part']
            if part_num in session_contents[session_id]:
                all_content.append(f"<!-- Part {part_num} -->\n\n{session_contents[session_id][part_num]}")
        
        if all_content:
            # Combine all parts
            session_title = session_titles[session_id]
            full_content = f"# {session_title or f'Session {session_id}'}\n\n"
            full_content += f"**Volume:** {volume}\n"
            full_content += f"**Session:** {session_id}\n"
            full_content += f"**Parts:** {len(parts)}\n"
            full_content += f"**Source:** Nizkor Project (Wayback Machine Archive)\n"
            full_content += f"**Scraped:** {datetime.now().isoformat()}\n\n"
            full_content += "---\n\n"
            full_content += "\n\n---\n\n".join(all_content)
            
            # Save
            output_file.write_text(full_content, encoding='utf-8')
            results[session_id] = {"status": "success", "parts": len(parts)}
        else:
            results[session_id] = {"status": "empty", "parts": len(parts)}
    
    return results


async def main():
    parser = argparse.ArgumentParser(description='Scrape Nizkor Eichmann trial transcripts')
    parser.add_argument('--test', action='store_true', help='Test mode: only download first 3 sessions per volume')
    parser.add_argument('--volume', type=int, choices=[1, 2, 3, 4, 5], help='Only scrape specific volume')
    args = parser.parse_args()
    
    print("="*60)
    print("Nizkor Eichmann Trial Transcripts Scraper (Parallel)")
    print("="*60)
    print(f"Output directory: {OUTPUT_DIR}")
    print(f"Test mode: {args.test}")
    print(f"Max concurrent requests: {MAX_CONCURRENT}")
    if args.volume:
        print(f"Volume: {args.volume}")
    print()
    
    # Create output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    # Create semaphore for rate limiting
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    
    # Create aiohttp session with higher connection limit
    connector = aiohttp.TCPConnector(limit=MAX_CONCURRENT * 2)
    async with aiohttp.ClientSession(connector=connector) as session:
        all_results = {}
        
        volumes = [args.volume] if args.volume else [1, 2, 3, 4, 5]
        
        start_time = time.time()
        
        for volume in volumes:
            results = await scrape_volume(session, volume, test_mode=args.test, semaphore=semaphore)
            all_results[f"volume_{volume}"] = results
        
        elapsed = time.time() - start_time
        
        # Save progress
        PROGRESS_FILE.write_text(json.dumps(all_results, indent=2), encoding='utf-8')
    
    # Summary
    print("\n" + "="*60)
    print("SCRAPING COMPLETE")
    print("="*60)
    
    total_sessions = 0
    total_success = 0
    for vol, results in all_results.items():
        vol_success = sum(1 for r in results.values() if r.get('status') == 'success')
        vol_total = len(results)
        print(f"{vol}: {vol_success}/{vol_total} sessions")
        total_sessions += vol_total
        total_success += vol_success
    
    print(f"\nTotal: {total_success}/{total_sessions} sessions downloaded")
    print(f"Time: {elapsed:.1f} seconds")
    print(f"Output: {OUTPUT_DIR}")


if __name__ == "__main__":
    asyncio.run(main())
