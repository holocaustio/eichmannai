'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Witness {
  id: string;
  name: string;
  hebrewName: string;
  type: string;
  role: string;
  isWitness: boolean;
  sessions?: number[];
  mentions: number;
  testimonyFile?: string;
  testimonyLines?: string;
  testimonyChars?: number;
  hasTestimony?: boolean;
  sources?: Array<{
    file: string;
    lineStart: number;
    lineEnd: number;
    session: number;
  }>;
}

interface TestimonyIndex {
  witness: string;
  hebrew: string;
  file: string;
  lines: string;
  chars: number;
}

export default function WitnessDetailPage() {
  const params = useParams();
  const witnessName = decodeURIComponent(params.name as string);

  const [witness, setWitness] = useState<Witness | null>(null);
  const [testimony, setTestimony] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load witness data and testimony
  useEffect(() => {
    async function loadData() {
      try {
        // Load entities
        const entitiesRes = await fetch('/data/entities.json');
        const entities = await entitiesRes.json();
        
        const found = entities.nodes.find((n: Witness) => 
          n.isWitness && (
            n.name === witnessName ||
            n.name.toLowerCase() === witnessName.toLowerCase() ||
            n.name.replace(/ /g, '_') === witnessName ||
            n.name.replace(/ /g, '_').toLowerCase() === witnessName.toLowerCase()
          )
        );
        
        if (!found) {
          setError('Witness not found');
          setLoading(false);
          return;
        }
        
        setWitness(found);
        
        // Load testimony index to find the markdown file
        const indexRes = await fetch('/data/testimonies/_index.json');
        const index = await indexRes.json();
        
        const testimonyInfo = index.testimonies.find((t: TestimonyIndex) => 
          t.witness === found.name || 
          t.witness.toLowerCase() === found.name.toLowerCase()
        );
        
        if (testimonyInfo) {
          // Build filename from witness name
          const safeName = found.name.replace(/ /g, '_').replace(/'/g, '').replace(/"/g, '').replace(/[^\w\-]/g, '');
          const mdRes = await fetch(`/data/testimonies/${safeName}.md`);
          
          if (mdRes.ok) {
            const mdContent = await mdRes.text();
            setTestimony(mdContent);
          } else {
            // Try alternate filename formats
            const altName = found.name.replace(/ /g, '_');
            const altRes = await fetch(`/data/testimonies/${altName}.md`);
            if (altRes.ok) {
              setTestimony(await altRes.text());
            } else {
              setError('Testimony file not found');
            }
          }
        } else {
          setError('No testimony available for this witness');
        }
      } catch (err) {
        setError('Failed to load data');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    
    loadData();
  }, [witnessName]);

  // Parse and render markdown
  const renderMarkdown = (content: string) => {
    const lines = content.split('\n');
    const elements: JSX.Element[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      if (!trimmed) {
        elements.push(<div key={i} className="h-4" />);
        continue;
      }
      
      // Skip the footer
      if (trimmed.startsWith('---') && i > lines.length - 5) continue;
      if (trimmed.startsWith('*Extracted from')) continue;
      
      // H1 - Main title
      if (trimmed.startsWith('# ')) {
        elements.push(
          <h1 key={i} className="font-serif text-3xl md:text-4xl font-light mb-2 text-stone-100" dir="rtl">
            {trimmed.slice(2)}
          </h1>
        );
        continue;
      }
      
      // H2 - Subtitle
      if (trimmed.startsWith('## ')) {
        elements.push(
          <h2 key={i} className="text-xl text-stone-400 mb-6">
            {trimmed.slice(3)}
          </h2>
        );
        continue;
      }
      
      // Horizontal rule (after header)
      if (trimmed === '---') {
        elements.push(<hr key={i} className="border-stone-800 my-6" />);
        continue;
      }
      
      // Sworn in marker
      if (trimmed.includes('הושבע') || trimmed.includes('הצהיר')) {
        elements.push(
          <div key={i} className="my-6 py-3 px-4 bg-stone-800/50 border-r-4 border-amber-600 text-center">
            <span className="text-amber-500 text-lg" dir="rtl">{trimmed.replace(/\*\*/g, '')}</span>
          </div>
        );
        continue;
      }
      
      // Bold speaker labels **Speaker:**
      if (trimmed.startsWith('**') && trimmed.includes(':**')) {
        const match = trimmed.match(/^\*\*(.+?):\*\*\s*(.*)/);
        if (match) {
          const [, speaker, rest] = match;
          elements.push(
            <div key={i} className="mt-6 mb-2" dir="rtl">
              <span className="text-amber-500 font-semibold">{speaker}:</span>
              {rest && <span className="text-stone-300 mr-2">{rest}</span>}
            </div>
          );
          continue;
        }
      }
      
      // Question (שאלה or ש.)
      if (trimmed.startsWith('**שאלה:**') || trimmed.startsWith('ש.')) {
        const text = trimmed.replace(/^\*\*שאלה:\*\*\s*/, '').replace(/^ש\.\s*/, '');
        elements.push(
          <div key={i} className="mt-4 mb-2 flex gap-3" dir="rtl">
            <span className="text-amber-500 font-bold shrink-0">ש.</span>
            <span className="text-stone-300">{text}</span>
          </div>
        );
        continue;
      }
      
      // Answer (תשובה or ת.)
      if (trimmed.startsWith('**תשובה:**') || trimmed.startsWith('ת.')) {
        const text = trimmed.replace(/^\*\*תשובה:\*\*\s*/, '').replace(/^ת\.\s*/, '');
        elements.push(
          <div key={i} className="mb-4 pr-4 border-r-2 border-emerald-800/50 flex gap-3" dir="rtl">
            <span className="text-emerald-500 font-bold shrink-0">ת.</span>
            <span className="text-stone-200">{text}</span>
          </div>
        );
        continue;
      }
      
      // End of testimony marker
      if (trimmed.includes('סיימת את עדותך') || trimmed.includes('גמרת את עדותך')) {
        elements.push(
          <div key={i} className="my-8 py-4 border-y border-stone-700 text-center">
            <span className="text-stone-400 font-serif text-lg" dir="rtl">
              {trimmed.replace(/\*\*/g, '')}
            </span>
          </div>
        );
        continue;
      }
      
      // Regular text (remove any remaining markdown bold)
      const cleanText = trimmed.replace(/\*\*/g, '');
      elements.push(
        <p key={i} className="text-stone-300 my-1 leading-relaxed" dir="rtl">
          {cleanText}
        </p>
      );
    }
    
    return elements;
  };

  if (loading) {
    return (
      <main className="bg-stone-950 text-stone-100 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-2 border-stone-600 border-t-stone-300 rounded-full animate-spin mb-4" />
          <p className="text-stone-500">Loading testimony...</p>
        </div>
      </main>
    );
  }

  if (!witness) {
    return (
      <main className="bg-stone-950 text-stone-100 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl mb-4">Witness Not Found</h1>
          <p className="text-stone-500 mb-6">Could not find witness: {witnessName}</p>
          <Link href="/witnesses" className="text-stone-400 hover:text-stone-200">
            ← Back to witnesses
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="bg-stone-950 text-stone-100 min-h-screen">
      {/* Header */}
      <header className="border-b border-stone-900 sticky top-0 bg-stone-950/95 backdrop-blur-sm z-50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/witnesses" className="text-stone-400 hover:text-stone-200 transition-colors text-sm">
            ← Back to Witnesses
          </Link>
          <span className="text-stone-500 text-sm">Witness Testimony</span>
        </div>
      </header>

      {/* Witness Info */}
      <section className="py-12 px-6 border-b border-stone-900">
        <div className="max-w-4xl mx-auto">
          <p className="text-stone-600 text-xs tracking-[0.3em] uppercase mb-4">Witness</p>
          
          <h1 className="font-serif text-4xl md:text-5xl font-light mb-2">
            {witness.name}
          </h1>
          
          <p className="text-stone-400 text-2xl mb-6" dir="rtl">
            {witness.hebrewName}
          </p>

          <div className="flex flex-wrap gap-3 text-sm">
            {witness.sessions && witness.sessions.length > 0 && (
              <span className="border border-stone-800 px-3 py-1 text-stone-400">
                Sessions: {witness.sessions.slice(0, 5).join(', ')}{witness.sessions.length > 5 ? '...' : ''}
              </span>
            )}
            {witness.testimonyFile && (
              <span className="border border-stone-800 px-3 py-1 text-stone-400">
                Source: {witness.testimonyFile}
              </span>
            )}
            {witness.testimonyLines && (
              <span className="border border-stone-800 px-3 py-1 text-stone-400">
                Lines: {witness.testimonyLines}
              </span>
            )}
            {witness.testimonyChars && (
              <span className="border border-stone-800 px-3 py-1 text-stone-400">
                {witness.testimonyChars.toLocaleString()} characters
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Testimony Section */}
      <section className="py-12 px-6">
        <div className="max-w-4xl mx-auto">
          {error && (
            <div className="text-center py-16">
              <p className="text-stone-500 mb-4">{error}</p>
              <Link href="/witnesses" className="text-stone-400 hover:text-stone-200">
                ← Back to witnesses
              </Link>
            </div>
          )}

          {testimony && (
            <div>
              <div className="bg-stone-900/50 border border-stone-800 p-8 md:p-12">
                <div className="font-serif text-lg leading-loose">
                  {renderMarkdown(testimony)}
                </div>
              </div>

              <div className="mt-8 text-stone-600 text-sm text-center">
                <p>
                  {witness.testimonyChars && (
                    <span>{witness.testimonyChars.toLocaleString()} characters</span>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Related Sessions */}
      {witness.sessions && witness.sessions.length > 0 && (
        <section className="py-12 px-6 border-t border-stone-900 bg-stone-900/20">
          <div className="max-w-4xl mx-auto">
            <h3 className="font-serif text-xl mb-6">Sessions</h3>
            <div className="flex flex-wrap gap-3">
              {witness.sessions.slice(0, 10).map(session => (
                <div 
                  key={session}
                  className="border border-stone-800 px-4 py-3"
                >
                  <span className="text-stone-300">Session {session}</span>
                  <span className="text-stone-600 text-sm mr-2" dir="rtl"> • ישיבה {session}</span>
                </div>
              ))}
              {witness.sessions.length > 10 && (
                <div className="border border-stone-800 px-4 py-3 text-stone-500">
                  +{witness.sessions.length - 10} more
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-stone-900">
        <div className="max-w-4xl mx-auto text-center">
          <Link href="/witnesses" className="text-stone-500 hover:text-stone-300 text-sm">
            ← View all witnesses
          </Link>
        </div>
      </footer>
    </main>
  );
}
