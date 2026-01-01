'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useAIAssistant } from '../../components/AIAssistant';
import { parseEntityMarkers } from '../../components/EntityLink';

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
  image?: string;
}

interface TestimonyIndex {
  witness: string;
  hebrew: string;
  file: string;
  lines: string;
  chars: number;
}

interface SessionVideo {
  videoId: string;
  title: string;
}

interface SessionVideosData {
  playlistId: string;
  playlistUrl: string;
  sessions: Record<string, SessionVideo[]>;
}

interface LinkedEntity {
  id: string;
  name: string;
  type: string;
  englishName?: string;
  sessions?: number[];
  mentions?: number;
  isWitness?: boolean;
}

interface EntityGraphData {
  nodes: LinkedEntity[];
}

interface EntitiesData {
  nodes: Witness[];
}

type Language = 'en' | 'he';

export default function WitnessDetailClient() {
  const params = useParams();
  const witnessName = decodeURIComponent(params.name as string);

  const [witness, setWitness] = useState<Witness | null>(null);
  const [testimony, setTestimony] = useState<string | null>(null);
  const [sessionVideos, setSessionVideos] = useState<SessionVideo[]>([]);
  const [linkedEntities, setLinkedEntities] = useState<LinkedEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [language, setLanguage] = useState<Language>('en');
  const [loadingTestimony, setLoadingTestimony] = useState(false);
  const { setContext, openAssistant } = useAIAssistant();

  // Load witness data and testimony
  useEffect(() => {
    async function loadData() {
      try {
        // Load consolidated entities, testimony index, and session videos
        const [consolidatedRes, testimonyIndexRes, videosRes] = await Promise.all([
          fetch('/data/entities-consolidated.json'),
          fetch('/data/testimonies/_index.json'),
          fetch('/data/session-videos.json')
        ]);
        const consolidated: EntityGraphData & { nodes: Witness[] } = await consolidatedRes.json();
        const testimonyIndex = await testimonyIndexRes.json();
        const videosData: SessionVideosData = await videosRes.json();
        
        // First try to find in consolidated entities
        let found = consolidated.nodes.find((n: Witness) => 
          n.isWitness && (
            n.name === witnessName ||
            n.name.toLowerCase() === witnessName.toLowerCase() ||
            n.name.replace(/ /g, '_') === witnessName ||
            n.name.replace(/ /g, '_').toLowerCase() === witnessName.toLowerCase()
          )
        );
        
        // If not found in entities, try to find in testimony index
        if (!found) {
          const testimonyInfo = testimonyIndex.testimonies?.find((t: TestimonyIndex) => 
            t.witness === witnessName ||
            t.witness.toLowerCase() === witnessName.toLowerCase() ||
            t.witness.replace(/ /g, '_') === witnessName ||
            t.witness.replace(/ /g, '_').toLowerCase() === witnessName.toLowerCase()
          );
          
          if (testimonyInfo) {
            // Create a minimal witness object from testimony info
            found = {
              id: `testimony-${testimonyInfo.witness.replace(/ /g, '_')}`,
              name: testimonyInfo.witness,
              hebrewName: testimonyInfo.hebrew,
              type: 'PERSON',
              role: 'Witness',
              isWitness: true,
              sessions: [],
              mentions: 1,
              hasTestimony: true,
              testimonyFile: testimonyInfo.output,
              testimonyLines: testimonyInfo.lines,
              testimonyChars: testimonyInfo.chars
            };
          }
        }
        
        if (!found) {
          setError('Witness not found');
          setLoading(false);
          return;
        }
        
        setWitness(found);
        
        // Find videos for this witness's sessions
        if (found.sessions && found.sessions.length > 0) {
          const uniqueVideos = new Map<string, SessionVideo>();
          for (const session of found.sessions) {
            const sessionVids = videosData.sessions[session.toString()];
            if (sessionVids && sessionVids.length > 0) {
              // Take first video for each session (avoid duplicates)
              const vid = sessionVids[0];
              if (!uniqueVideos.has(vid.videoId)) {
                uniqueVideos.set(vid.videoId, vid);
              }
            }
          }
          setSessionVideos(Array.from(uniqueVideos.values()));
        }
        
        // Find linked entities from consolidated edges
        const witnessId = found.id;
        const linkedEntityIds = new Set<string>();
        
        // Find all edges connected to this witness directly
        const edges = (consolidated as { edges?: Array<{ source: string; target: string; type?: string }> }).edges || [];
        edges.forEach(edge => {
          if (edge.source === witnessId) {
            linkedEntityIds.add(edge.target);
          } else if (edge.target === witnessId) {
            linkedEntityIds.add(edge.source);
          }
        });
        
        // Also find entities that are MENTIONED_IN the same sessions as this witness
        if (found.sessions && found.sessions.length > 0) {
          const sessionIds = new Set(found.sessions.map(s => `session-${s}`));
          
          // Find all entities mentioned in witness's sessions
          edges.forEach(edge => {
            if (edge.type === 'MENTIONED_IN') {
              // Check if this entity is mentioned in one of the witness's sessions
              if (sessionIds.has(edge.target)) {
                linkedEntityIds.add(edge.source);
              }
            }
          });
        }
        
        // Get the actual entity objects (excluding other witnesses)
        const linked = consolidated.nodes
          .filter(n => linkedEntityIds.has(n.id) && !n.isWitness)
          .sort((a, b) => (b.mentions || 0) - (a.mentions || 0))
          .slice(0, 50);
        
        setLinkedEntities(linked as LinkedEntity[]);
        
        // Load English testimony by default
        const safeName = found.name.replace(/ /g, '_').replace(/'/g, '').replace(/"/g, '').replace(/[^\w\-]/g, '');
        const enRes = await fetch(`/data/testimonies/en/${safeName}.md`);
        if (enRes.ok) {
          const enContent = await enRes.text();
          setTestimony(enContent);
          setContext('testimony', enContent, `${found.name}'s Testimony`);
        }
      } catch (err) {
        setError('Failed to load data');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    
    loadData();
  }, [witnessName, setContext]);

  // Load testimony when language changes
  useEffect(() => {
    if (!witness) return;
    const currentWitness = witness; // Capture non-null value for async function
    
    async function loadTestimony() {
      setLoadingTestimony(true);
      try {
        const safeName = currentWitness.name.replace(/ /g, '_').replace(/'/g, '').replace(/"/g, '').replace(/[^\w\-]/g, '');
        const folder = language === 'en' ? 'en' : 'he';
        const res = await fetch(`/data/testimonies/${folder}/${safeName}.md`);
        if (res.ok) {
          const content = await res.text();
          setTestimony(content);
          setContext('testimony', content, `${currentWitness.name}'s Testimony`);
        }
      } catch (err) {
        console.error('Failed to load testimony:', err);
      } finally {
        setLoadingTestimony(false);
      }
    }
    
    loadTestimony();
  }, [language, witness, setContext]);

  // Helper to render text with entity links (only for English)
  const renderTextWithEntities = (text: string, isEnglish: boolean, key: string) => {
    if (!isEnglish) {
      return text;
    }
    return parseEntityMarkers(text, key);
  };

  // Parse and render markdown
  const renderMarkdown = (content: string) => {
    const lines = content.split('\n');
    const elements: React.ReactElement[] = [];
    const isEnglish = language === 'en';
    const dir = isEnglish ? 'ltr' : 'rtl';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      if (!trimmed) {
        elements.push(<div key={i} className="h-2" />);
        continue;
      }
      
      // Skip metadata and headers
      if (trimmed.startsWith('---') && i > lines.length - 5) continue;
      if (trimmed.startsWith('*Extracted from')) continue;
      if (trimmed.startsWith('# ') && i < 5) continue;
      if (trimmed.startsWith('## ') && i < 7) continue;
      if (trimmed.startsWith('**Session:**')) continue;
      if (trimmed.startsWith('<!-- Part')) continue;
      
      // Horizontal rule (after header)
      if (trimmed === '---') {
        if (i < 10) continue;
        elements.push(<hr key={i} className="border-stone-800 my-6" />);
        continue;
      }
      
      // Sworn in marker (English)
      if (isEnglish && (trimmed.includes('is sworn') || trimmed.includes('was sworn'))) {
        elements.push(
          <div key={i} className="my-6 py-3 px-4 bg-stone-800/50 border-l-4 border-amber-600 text-center">
            <span className="text-amber-500 text-lg">{trimmed.replace(/\*\*/g, '').replace(/\[|\]/g, '')}</span>
          </div>
        );
        continue;
      }
      
      // Sworn in marker (Hebrew)
      if (!isEnglish && (trimmed.includes('הושבע') || trimmed.includes('הצהיר'))) {
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
            <div key={i} className="mt-4 mb-2" dir={dir}>
              <span className="text-amber-500 font-semibold">{speaker}:</span>
              {rest && <span className={`text-stone-300 ${isEnglish ? 'ml-2' : 'mr-2'}`}>{renderTextWithEntities(rest, isEnglish, `spk-${i}`)}</span>}
            </div>
          );
          continue;
        }
      }
      
      // English Question (**Q.**)
      if (isEnglish && trimmed.startsWith('**Q.**')) {
        const text = trimmed.replace(/^\*\*Q\.\*\*\s*/, '');
        elements.push(
          <div key={i} className="mt-3 mb-1 flex gap-3" dir="ltr">
            <span className="text-amber-500 font-bold shrink-0">Q.</span>
            <span className="text-stone-300">{renderTextWithEntities(text, isEnglish, `q-${i}`)}</span>
          </div>
        );
        continue;
      }
      
      // English Answer (**A.**)
      if (isEnglish && trimmed.startsWith('**A.**')) {
        const text = trimmed.replace(/^\*\*A\.\*\*\s*/, '');
        elements.push(
          <div key={i} className="mt-3 mb-1 flex gap-3" dir="ltr">
            <span className="text-amber-500 font-bold shrink-0">A.</span>
            <span className="text-stone-300">{renderTextWithEntities(text, isEnglish, `a-${i}`)}</span>
          </div>
        );
        continue;
      }
      
      // Hebrew Question (שאלה or ש.)
      if (!isEnglish && (trimmed.startsWith('**שאלה:**') || trimmed.startsWith('ש.'))) {
        const text = trimmed.replace(/^\*\*שאלה:\*\*\s*/, '').replace(/^ש\.\s*/, '');
        elements.push(
          <div key={i} className="mt-3 mb-1 flex gap-3" dir="rtl">
            <span className="text-amber-500 font-bold shrink-0">ש.</span>
            <span className="text-stone-300">{text}</span>
          </div>
        );
        continue;
      }
      
      // Hebrew Answer (תשובה or ת.)
      if (!isEnglish && (trimmed.startsWith('**תשובה:**') || trimmed.startsWith('ת.'))) {
        const text = trimmed.replace(/^\*\*תשובה:\*\*\s*/, '').replace(/^ת\.\s*/, '');
        elements.push(
          <div key={i} className="mt-3 mb-1 flex gap-3" dir="rtl">
            <span className="text-amber-500 font-bold shrink-0">ת.</span>
            <span className="text-stone-300">{text}</span>
          </div>
        );
        continue;
      }
      
      // End of testimony marker (English)
      if (isEnglish && trimmed.includes('concluded your testimony')) {
        elements.push(
          <div key={i} className="my-8 py-4 border-y border-stone-700 text-center">
            <span className="text-stone-400 text-lg">
              {trimmed.replace(/\*\*/g, '')}
            </span>
          </div>
        );
        continue;
      }
      
      // End of testimony marker (Hebrew)
      if (!isEnglish && (trimmed.includes('סיימת את עדותך') || trimmed.includes('גמרת את עדותך'))) {
        elements.push(
          <div key={i} className="my-8 py-4 border-y border-stone-700 text-center">
            <span className="text-stone-400 text-lg" dir="rtl">
              {trimmed.replace(/\*\*/g, '')}
            </span>
          </div>
        );
        continue;
      }
      
      // Regular text
      const cleanText = trimmed.replace(/\*\*/g, '');
      elements.push(
        <p key={i} className="text-stone-300 my-1 leading-relaxed" dir={dir}>
          {renderTextWithEntities(cleanText, isEnglish, `p-${i}`)}
        </p>
      );
    }
    
    return elements;
  };

  const hebrewInitial = witness?.hebrewName?.charAt(0) || witness?.name?.charAt(0) || '';

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center pt-20">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-2 border-stone-600 border-t-stone-300 rounded-full animate-spin mb-4" />
          <p className="text-stone-500">Loading testimony...</p>
        </div>
      </main>
    );
  }

  if (!witness) {
    return (
      <main className="min-h-screen flex items-center justify-center pt-20">
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
    <main className="min-h-screen pt-20">
      {/* Two Column Layout */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          
          {/* Left Column - Sidebar */}
          <div className="lg:w-80 flex-shrink-0">
            <div className="space-y-6">
              
            
              
              {/* Witness Photo or Initial */}
              <div className="relative w-full aspect-[3/4] bg-stone-900 border border-stone-800 overflow-hidden">
                {witness.image && !imageError ? (
                  <Image
                    src={witness.image}
                    alt={witness.name}
                    fill
                    className="object-cover"
                    sizes="320px"
                    onError={() => setImageError(true)}
                    priority
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-stone-900">
                    <span className="text-stone-600 text-8xl font-serif">
                      {hebrewInitial}
                    </span>
                  </div>
                )}
              </div>
              
              {/* Witness Name & Details */}
              <div>
                <p className="text-stone-600 text-xs tracking-[0.2em] uppercase mb-2">Witness</p>
                <h1 className="font-serif text-2xl font-light mb-1">
                  {witness.name}
                </h1>
                <p className="text-stone-400 text-xl" dir="rtl">
                  {witness.hebrewName}
                </p>
              </div>
              
              {/* Meta Info */}
              <div className="space-y-2 text-sm">
                {witness.sessions && witness.sessions.length > 0 && (
                  <div className="flex items-start gap-2">
                    <span className="text-stone-600 shrink-0">Sessions:</span>
                    <span className="text-stone-400">
                      {witness.sessions.slice(0, 5).join(', ')}{witness.sessions.length > 5 ? '...' : ''}
                    </span>
                  </div>
                )}
              </div>
              
              {/* Language Toggle */}
              <div className="pt-4 border-t border-stone-800">
                <h3 className="text-xs text-stone-500 uppercase tracking-wider mb-3">
                  Testimony Language
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => setLanguage('en')}
                    disabled={loadingTestimony}
                    className={`flex-1 px-3 py-2 text-sm border transition-colors ${
                      language === 'en'
                        ? 'bg-stone-700 border-stone-600 text-stone-200'
                        : 'bg-transparent border-stone-700 text-stone-500 hover:border-stone-600 hover:text-stone-400'
                    }`}
                  >
                    English
                  </button>
                  <button
                    onClick={() => setLanguage('he')}
                    disabled={loadingTestimony}
                    className={`flex-1 px-3 py-2 text-sm border transition-colors ${
                      language === 'he'
                        ? 'bg-stone-700 border-stone-600 text-stone-200'
                        : 'bg-transparent border-stone-700 text-stone-500 hover:border-stone-600 hover:text-stone-400'
                    }`}
                  >
                    עברית
                  </button>
                </div>
              </div>
              
              {/* Video Testimony */}
              {sessionVideos.length > 0 && (
                <div className="pt-4 border-t border-stone-800">
                  <h3 className="text-xs text-stone-500 uppercase tracking-wider mb-3">
                    Video Testimony
                  </h3>
                  <div className="space-y-3">
                    {sessionVideos.slice(0, 2).map((video, idx) => (
                      <div key={video.videoId + idx} className="relative aspect-video bg-stone-900 border border-stone-800 overflow-hidden">
                        <iframe
                          src={`https://www.youtube.com/embed/${video.videoId}`}
                          title={video.title}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          className="absolute inset-0 w-full h-full"
                        />
                      </div>
                    ))}
                    {sessionVideos.length > 2 && (
                      <a
                        href="https://www.youtube.com/playlist?list=PL8DE7D8BC03983637"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-center py-2 text-stone-500 hover:text-stone-300 text-xs transition-colors"
                      >
                        +{sessionVideos.length - 2} more videos on YouTube →
                      </a>
                    )}
                  </div>
                </div>
              )}
              
              {/* Linked Entities */}
              {linkedEntities.length > 0 && (
                <div className="pt-4 border-t border-stone-800">
                  <h3 className="text-xs text-stone-500 uppercase tracking-wider mb-3">
                    Related Entities ({linkedEntities.length})
                  </h3>
                  <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                    {/* Group by type */}
                    {(['SESSION', 'PERSON', 'LOCATION', 'ORGANIZATION', 'EVENT', 'DATE'] as const).map(type => {
                      const ofType = linkedEntities.filter(e => e.type === type);
                      if (ofType.length === 0) return null;
                      
                      const typeConfig: Record<string, { icon: string; color: string; label: string }> = {
                        'SESSION': { icon: '📋', color: 'text-cyan-400', label: 'Sessions' },
                        'PERSON': { icon: '👤', color: 'text-amber-400', label: 'People' },
                        'LOCATION': { icon: '📍', color: 'text-blue-400', label: 'Locations' },
                        'ORGANIZATION': { icon: '🏛️', color: 'text-purple-400', label: 'Organizations' },
                        'EVENT': { icon: '📅', color: 'text-emerald-400', label: 'Events' },
                        'DATE': { icon: '📆', color: 'text-rose-400', label: 'Dates' },
                      };
                      const config = typeConfig[type];
                      
                      return (
                        <div key={type}>
                          <p className={`text-xs ${config.color} mb-1.5 flex items-center gap-1`}>
                            <span>{config.icon}</span>
                            {config.label} ({ofType.length})
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {ofType.slice(0, 10).map(entity => (
                              <Link
                                key={entity.id}
                                href={type === 'SESSION' ? `/explore/${encodeURIComponent(entity.id)}` : `/explore/${encodeURIComponent(entity.id)}`}
                                className={`px-2 py-1 border text-xs hover:text-stone-200 transition-colors rounded ${
                                  type === 'SESSION' 
                                    ? 'bg-cyan-900/30 border-cyan-800/50 text-cyan-300 hover:bg-cyan-800/50 hover:border-cyan-700'
                                    : 'bg-stone-800/50 border-stone-700 text-stone-400 hover:bg-stone-700 hover:border-stone-600'
                                }`}
                              >
                                {entity.name.length > 25 ? entity.name.slice(0, 25) + '...' : entity.name}
                              </Link>
                            ))}
                            {ofType.length > 10 && (
                              <span className="px-2 py-1 text-stone-600 text-xs">
                                +{ofType.length - 10} more
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <Link 
                    href="/explore"
                    className="block text-center py-2 mt-3 text-stone-500 hover:text-stone-300 text-xs transition-colors"
                  >
                    Explore All Entities →
                  </Link>
                </div>
              )}
              
              {/* Explore Link (only if no linked entities) */}
              {linkedEntities.length === 0 && (
                <div className="pt-4 border-t border-stone-800">
                  <Link 
                    href="/explore"
                    className="block text-center py-3 border border-stone-700 text-stone-400 text-sm hover:bg-stone-800 hover:text-stone-200 transition-colors"
                  >
                    Explore All Entities →
                  </Link>
                </div>
              )}
            </div>
          </div>
          
          {/* Right Column - Testimony */}
          <div className="flex-1 min-w-0">
            {error && !testimony && (
              <div className="text-center py-16">
                <p className="text-stone-500 mb-4">{error}</p>
                <Link href="/witnesses" className="text-stone-400 hover:text-stone-200">
                  ← Back to witnesses
                </Link>
              </div>
            )}

            {testimony && (
              <>
                {/* AI Summary Invitation Box */}
                <button
                  onClick={openAssistant}
                  className="w-full mb-6 p-5 bg-gradient-to-r from-amber-900/30 to-amber-800/20 
                    border border-amber-700/50 rounded-lg
                    flex items-center gap-4 text-left
                    hover:from-amber-900/40 hover:to-amber-800/30 hover:border-amber-600/60
                    transition-all duration-200 group"
                >
                  <div className="w-12 h-12 rounded-full bg-amber-600/20 flex items-center justify-center flex-shrink-0
                    group-hover:bg-amber-600/30 transition-colors">
                    <svg 
                      className="w-6 h-6 text-amber-500" 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path 
                        strokeLinecap="round" 
                        strokeLinejoin="round" 
                        strokeWidth={2} 
                        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" 
                      />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-amber-400 font-medium text-sm mb-1">Get AI Summary</p>
                    <p className="text-stone-400 text-sm">
                      Let our AI guide explain this testimony and answer your questions
                    </p>
                  </div>
                  <svg 
                    className="w-5 h-5 text-stone-500 group-hover:text-amber-500 group-hover:translate-x-1 transition-all" 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                <div className="bg-stone-900/50 border border-stone-800 p-6 md:p-10 relative">
                  {loadingTestimony && (
                    <div className="absolute inset-0 bg-stone-900/80 flex items-center justify-center z-10">
                      <div className="text-center">
                        <div className="inline-block w-6 h-6 border-2 border-stone-600 border-t-stone-300 rounded-full animate-spin mb-2" />
                        <p className="text-stone-500 text-sm">Loading {language === 'en' ? 'English' : 'Hebrew'}...</p>
                      </div>
                    </div>
                  )}
                  <div className="text-base md:text-lg leading-loose">
                    {renderMarkdown(testimony)}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      </main>
  );
}
