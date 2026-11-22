// Drop-in replacements for the few `fs` functions the API routes use (Cloudflare Workers
// have no filesystem). See scripts/gen-bundled-data.mjs.
//  - Small files are bundled in code and always available.
//  - Transcripts (downloads/pdf/OCR_clean/*) are static assets under /ocr/. Call
//    `await preloadFiles([...paths])` before the sync functions touch them; each file is
//    fetched once per worker instance and then served from memory.
// Paths are matched by suffix, so existing join(process.cwd(), ...) calls keep working.
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { BUNDLED_FILES, OCR_SIZES } from '@/generated/bundled-data';

const OCR_PREFIX = 'downloads/pdf/OCR_clean/';
const loaded = new Map<string, string>();

function norm(path: string): string {
  return path.replace(/\\/g, '/');
}

function ocrName(path: string): string | null {
  const p = norm(path);
  const i = p.lastIndexOf(OCR_PREFIX);
  if (i === -1) return null;
  const name = p.slice(i + OCR_PREFIX.length);
  return name in OCR_SIZES ? name : null;
}

function bundled(path: string): string | undefined {
  const p = norm(path);
  for (const key of Object.keys(BUNDLED_FILES)) {
    if (p === key || p.endsWith('/' + key)) return BUNDLED_FILES[key];
  }
  return undefined;
}

function enoent(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' });
}

/** Fetch transcript files into memory so the sync functions below can read them. */
export async function preloadFiles(paths: string[]): Promise<void> {
  const names = [...new Set(paths.map(ocrName).filter((n): n is string => !!n && !loaded.has(n)))];
  if (names.length === 0) return;
  const { env } = getCloudflareContext();
  await Promise.all(
    names.map(async (name) => {
      const res = await env.ASSETS!.fetch(new URL(`/ocr/${encodeURIComponent(name)}`, 'https://assets.local'));
      if (res.ok) loaded.set(name, await res.text());
    })
  );
}

export function existsSync(path: string): boolean {
  const name = ocrName(path);
  return name ? true : bundled(path) !== undefined;
}

export function readFileSync(path: string, _encoding?: string): string {
  const name = ocrName(path);
  if (name) {
    const content = loaded.get(name);
    if (content === undefined) throw new Error(`Transcript ${name} not preloaded - call preloadFiles() first`);
    return content;
  }
  const content = bundled(path);
  if (content === undefined) throw enoent(path);
  return content;
}

export async function readFile(path: string, encoding?: string): Promise<string> {
  await preloadFiles([path]);
  return readFileSync(path, encoding);
}

export async function stat(path: string): Promise<{ size: number }> {
  const name = ocrName(path);
  if (name) return { size: OCR_SIZES[name] };
  const content = bundled(path);
  if (content === undefined) throw enoent(path);
  return { size: new TextEncoder().encode(content).length };
}

export async function readdir(dir: string): Promise<string[]> {
  const d = norm(dir).replace(/\/$/, '');
  if (d.endsWith(OCR_PREFIX.replace(/\/$/, ''))) return Object.keys(OCR_SIZES);
  return [];
}
