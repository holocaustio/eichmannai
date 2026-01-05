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
  const [excerpt, setExcerpt] = useState<string | null>(null);
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
        const [consolidatedRes, testimonyIndexRes, videosRes] = await Promise.all([
          fetch('/data/entities-consolidated.json'),
          fetch('/data/testimonies/_index.json'),
          fetch('/data/session-videos.json')
        ]);
        const consolidated: EntityGraphData & { nodes: Witness[] } = await consolidatedRes.json();
        const testimonyIndex = await testimonyIndexRes.json();
        const videosData: SessionVideosData = await videosRes.json();
        
        let found = consolidated.nodes.find((n: Witness) => 
          n.isWitness && (
            n.name === witnessName ||
            n.name.toLowerCase() === witnessName.toLowerCase() ||
            n.name.replace(/ /g, '_') === witnessName ||
            n.name.replace(/ /g, '_').toLowerCase() === witnessName.toLowerCase()
          )
        );
        
        if (!found) {
          const testimonyInfo = testimonyIndex.testimonies?.find((t: TestimonyIndex) => 
            t.witness === witnessName ||
            t.witness.toLowerCase() === witnessName.toLowerCase() ||
            t.witness.replace(/ /g, '_') === witnessName ||
            t.witness.replace(/ /g, '_').toLowerCase() === witnessName.toLowerCase()
          );
          
          if (testimonyInfo) {
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
        
        if (found.sessions && found.sessions.length > 0) {
          const uniqueVideos = new Map<string, SessionVideo>();
          for (const session of found.sessions) {
            const sessionVids = videosData.sessions[session.toString()];
            if (sessionVids && sessionVids.length > 0) {
              const vid = sessionVids[0];
              if (!uniqueVideos.has(vid.videoId)) {
                uniqueVideos.set(vid.videoId, vid);
              }
            }
          }
          setSessionVideos(Array.from(uniqueVideos.values()));
        }
        
        const witnessId = found.id;
        const linkedEntityIds = new Set<string>();
        
        const edges = (consolidated as { edges?: Array<{ source: string; target: string; type?: string }> }).edges || [];
        edges.forEach(edge => {
          if (edge.source === witnessId) {
            linkedEntityIds.add(edge.target);
          } else if (edge.target === witnessId) {
            linkedEntityIds.add(edge.source);
          }
        });
        
        if (found.sessions && found.sessions.length > 0) {
          const sessionIds = new Set(found.sessions.map(s => `session-${s}`));
          edges.forEach(edge => {
            if (edge.type === 'MENTIONED_IN') {
              if (sessionIds.has(edge.target)) {
                linkedEntityIds.add(edge.source);
              }
            }
          });
        }
        
        const linked = consolidated.nodes
          .filter(n => linkedEntityIds.has(n.id) && !n.isWitness)
          .sort((a, b) => (b.mentions || 0) - (a.mentions || 0))
          .slice(0, 30);
        
        setLinkedEntities(linked as LinkedEntity[]);
        
        const safeName = found.name.replace(/ /g, '_').replace(/'/g, '').replace(/"/g, '').replace(/[^\w\-]/g, '');
        const enRes = await fetch(`/data/testimonies/en/${safeName}.md`);
        if (enRes.ok) {
          const enContent = await enRes.text();
          setTestimony(enContent);
          setContext('testimony', enContent, `${found.name}'s Testimony`);
        }
        
        const excerptRes = await fetch(`/data/testimonies/en/${safeName}_excerpt.md`);
        if (excerptRes.ok) {
          const excerptContent = await excerptRes.text();
          setExcerpt(excerptContent);
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

  useEffect(() => {
    if (!witness) return;
    const currentWitness = witness;
    
    async function loadTestimony() {
      setLoadingTestimony(true);
      try {
        const safeName = currentWitness.name.replace(/ /g, '_').replace(/'/g, '').replace(/"/g, '').replace(/[^\w\-]/g, '');
        const folder = language === 'en' ? 'en' : 'he';
        
        const [testimonyRes, excerptRes] = await Promise.all([
          fetch(`/data/testimonies/${folder}/${safeName}.md`),
          fetch(`/data/testimonies/${folder}/${safeName}_excerpt.md`)
        ]);
        
        if (testimonyRes.ok) {
          const content = await testimonyRes.text();
          setTestimony(content);
          setContext('testimony', content, `${currentWitness.name}'s Testimony`);
        }
        
        if (excerptRes.ok) {
          const excerptContent = await excerptRes.text();
          setExcerpt(excerptContent);
        }
      } catch (err) {
        console.error('Failed to load testimony:', err);
      } finally {
        setLoadingTestimony(false);
      }
    }
    
    loadTestimony();
  }, [language, witness, setContext]);

  const renderTextWithEntities = (text: string, isEnglish: boolean, key: string) => {
    if (!isEnglish) {
      return text;
    }
    return parseEntityMarkers(text, key);
  };

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
      
      if (trimmed.startsWith('---') && i > lines.length - 5) continue;
      if (trimmed.startsWith('*Extracted from')) continue;
      if (trimmed.startsWith('# ') && i < 5) continue;
      if (trimmed.startsWith('## ') && i < 7) continue;
      if (trimmed.startsWith('**Session:**')) continue;
      if (trimmed.startsWith('<!-- Part')) continue;
      
      if (trimmed === '---') {
        if (i < 10) continue;
        elements.push(<hr key={i} className="border-stone-800 my-6" />);
        continue;
      }
      
      if (isEnglish && (trimmed.includes('is sworn') || trimmed.includes('was sworn'))) {
        elements.push(
          <div key={i} className="my-6 py-3 px-4 bg-stone-800/50 border-l-4 border-amber-600 text-center">
            <span className="text-amber-500 text-base">{trimmed.replace(/\*\*/g, '').replace(/\[|\]/g, '')}</span>
          </div>
        );
        continue;
      }
      
      if (!isEnglish && (trimmed.includes('הושבע') || trimmed.includes('הצהיר'))) {
        elements.push(
          <div key={i} className="my-6 py-3 px-4 bg-stone-800/50 border-r-4 border-amber-600 text-center">
            <span className="text-amber-500 text-base" dir="rtl">{trimmed.replace(/\*\*/g, '')}</span>
          </div>
        );
        continue;
      }
      
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
      
      if (isEnglish && trimmed.includes('concluded your testimony')) {
        elements.push(
          <div key={i} className="my-8 py-4 border-y border-stone-700 text-center">
            <span className="text-stone-400 text-base">{trimmed.replace(/\*\*/g, '')}</span>
          </div>
        );
        continue;
      }
      
      if (!isEnglish && (trimmed.includes('סיימת את עדותך') || trimmed.includes('גמרת את עדותך'))) {
        elements.push(
          <div key={i} className="my-8 py-4 border-y border-stone-700 text-center">
            <span className="text-stone-400 text-base" dir="rtl">{trimmed.replace(/\*\*/g, '')}</span>
          </div>
        );
        continue;
      }
      
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
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-2 border-stone-600 border-t-stone-300 rounded-full animate-spin mb-4" />
          <p className="text-stone-500">Loading testimony...</p>
        </div>
      </main>
    );
  }

  if (!witness) {
    return (
      <main className="min-h-screen flex items-center justify-center">
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
    <main className="min-h-screen">
      {/* Hero - matches other pages */}
      <section className="min-h-[400px] flex flex-col justify-center items-center px-6 relative overflow-hidden">
        {/* Background Image */}
        <div className="absolute inset-0">
          {witness.image && !imageError ? (
            <Image
              src={witness.image}
              alt={witness.name}
              fill
              className="object-cover animate-slow-pan"
              sizes="100vw"
              onError={() => setImageError(true)}
              priority
              style={{
                animation: 'slowPan 60s ease-out forwards'
              }}
            />
          ) : (
            <div 
              className="absolute inset-0 bg-cover bg-center bg-no-repeat"
              style={{ backgroundImage: 'url(/herobg2.jpg)' }}
            />
          )}
        </div>
        
        {/* Dark Overlay */}
        <div className="absolute inset-0 bg-stone-950/70" />
        {/* Inner Shadow / Vignette */}
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(12,10,8,0) 0%, rgba(12,10,8,0.3) 50%, rgba(12,10,8,1) 100%)'
          }}
        />
        
        {/* Content */}
        <div className="max-w-4xl mx-auto text-center relative z-10 pt-32 pb-20" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>
          <p className="text-stone-300 text-xs tracking-[0.3em] uppercase mb-4">
            Witness Testimony {witness.sessions && witness.sessions.length > 0 && (
              <>
                <span className="mx-2">•</span>
                {witness.sessions.length === 1 
                  ? `Session ${witness.sessions[0]}`
                  : `Sessions ${witness.sessions[0]}-${witness.sessions[witness.sessions.length - 1]}`
                }
              </>
            )}
          </p>
          <h1 className="font-serif text-4xl md:text-5xl font-light mb-3">
            {witness.name}
          </h1>
          <p className="text-stone-300 text-2xl font-light mb-8">
            {witness.hebrewName}
          </p>
          
          {/* AI Guide Button - same style as verdict page */}
          <button
            onClick={openAssistant}
            className="inline-flex items-center gap-3 bg-amber-600 hover:bg-amber-500 
              rounded-full shadow-lg shadow-black/30 pl-4 pr-5 py-3
              transition-all duration-200 hover:scale-105"
          >
            <div className="w-8 h-8 rounded-full bg-amber-500/30 flex items-center justify-center flex-shrink-0">
              <svg 
                className="w-5 h-5 text-white" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" 
                />
              </svg>
            </div>
            <div className="text-left">
              <p className="text-white font-medium text-sm leading-tight">AI Guide</p>
              <p className="text-amber-100/80 text-xs leading-tight">Understand this testimony</p>
            </div>
          </button>
        </div>
      </section>

      {/* Two Column Layout */}
      <section className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          
          {/* Left Column - Testimony */}
          <div className="flex-1 min-w-0 order-2 lg:order-1">
            {/* Excerpt */}
            {excerpt && (
              <div className="bg-stone-900/30 border border-stone-800 p-5 mb-6">
                <h3 className="text-xs text-amber-500/80 tracking-[0.2em] uppercase mb-3">
                  Overview
                </h3>
                <p className="text-stone-300 leading-relaxed" dir={language === 'he' ? 'rtl' : 'ltr'}>
                  {excerpt}
                </p>
              </div>
            )}
            
            {/* Testimony Content */}
            {error && !testimony && (
              <div className="text-center py-16">
                <p className="text-stone-500 mb-4">{error}</p>
                <Link href="/witnesses" className="text-stone-400 hover:text-stone-200">
                  ← Back to witnesses
                </Link>
              </div>
            )}

            {testimony && (
              <div className="relative">
                {loadingTestimony && (
                  <div className="absolute inset-0 bg-stone-950/80 flex items-center justify-center z-10 rounded">
                    <div className="text-center">
                      <div className="inline-block w-6 h-6 border-2 border-stone-600 border-t-stone-300 rounded-full animate-spin mb-2" />
                      <p className="text-stone-500 text-sm">Loading {language === 'en' ? 'English' : 'Hebrew'}...</p>
                    </div>
                  </div>
                )}
                
                <div className="bg-stone-900/30 border border-stone-800">
                  {/* Language Toggle Header */}
                  <div className="flex items-center justify-between px-6 md:px-8 py-4 border-b border-stone-800">
                    <h3 className="text-xs text-stone-500 uppercase tracking-wider">
                      Testimony Transcript
                    </h3>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setLanguage('en')}
                        disabled={loadingTestimony}
                        className={`px-4 py-1.5 text-sm border transition-colors ${
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
                        className={`px-4 py-1.5 text-sm border transition-colors ${
                          language === 'he'
                            ? 'bg-stone-700 border-stone-600 text-stone-200'
                            : 'bg-transparent border-stone-700 text-stone-500 hover:border-stone-600 hover:text-stone-400'
                        }`}
                      >
                        עברית
                      </button>
                    </div>
                  </div>
                  
                  {/* Testimony Content */}
                  <div className="p-6 md:p-8">
                    <div className="text-base leading-loose">
                      {renderMarkdown(testimony)}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          {/* Right Sidebar */}
          <div className="lg:w-72 xl:w-80 flex-shrink-0 order-1 lg:order-2">
            <div className="space-y-5">
              
              {/* Video */}
              {sessionVideos.length > 0 && (
                <div className="bg-stone-900/30 border border-stone-800 p-4">
                  <h3 className="text-xs text-stone-500 uppercase tracking-wider mb-3">
                    Video Recording
                  </h3>
                  <div className="aspect-video bg-stone-900 overflow-hidden">
                    <iframe
                      src={`https://www.youtube.com/embed/${sessionVideos[0].videoId}`}
                      title={sessionVideos[0].title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="w-full h-full"
                    />
                  </div>
                  {sessionVideos.length > 1 && (
                    <p className="text-stone-600 text-xs mt-2 text-center">
                      +{sessionVideos.length - 1} more videos available
                    </p>
                  )}
                </div>
              )}
              
              {/* Related Entities */}
              {linkedEntities.length > 0 && (
                <div className="bg-stone-900/30 border border-stone-800 p-4">
                  <h3 className="text-xs text-stone-500 uppercase tracking-wider mb-3">
                    Mentioned
                  </h3>
                  <div className="space-y-3">
                    {(['PERSON', 'LOCATION', 'ORGANIZATION', 'EVENT'] as const).map(type => {
                      const ofType = linkedEntities.filter(e => e.type === type);
                      if (ofType.length === 0) return null;
                      
                      const config: Record<string, { icon: string; color: string; label: string }> = {
                        'PERSON': { icon: '👤', color: 'text-amber-400', label: 'People' },
                        'LOCATION': { icon: '📍', color: 'text-blue-400', label: 'Places' },
                        'ORGANIZATION': { icon: '🏛️', color: 'text-purple-400', label: 'Organizations' },
                        'EVENT': { icon: '📅', color: 'text-emerald-400', label: 'Events' },
                      };
                      const cfg = config[type];
                      
                      return (
                        <div key={type}>
                          <p className={`text-xs ${cfg.color} mb-1.5 flex items-center gap-1`}>
                            <span>{cfg.icon}</span>
                            {cfg.label}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {ofType.slice(0, 4).map(entity => (
                              <Link
                                key={entity.id}
                                href={`/explore/${encodeURIComponent(entity.id)}`}
                                className="px-2 py-0.5 bg-stone-800/50 border border-stone-700 text-stone-400 text-xs 
                                  hover:bg-stone-700 hover:text-stone-200 transition-colors"
                              >
                                {entity.name.length > 15 ? entity.name.slice(0, 15) + '…' : entity.name}
                              </Link>
                            ))}
                            {ofType.length > 4 && (
                              <span className="px-2 py-0.5 text-stone-600 text-xs">
                                +{ofType.length - 4}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <Link 
                    href="/explore"
                    className="block text-center py-2 mt-3 border-t border-stone-800 text-stone-500 hover:text-stone-300 text-xs transition-colors"
                  >
                    Explore All →
                  </Link>
                </div>
              )}
              
              {/* Back Link */}
              <Link 
                href="/witnesses"
                className="block text-center py-3 border border-stone-800 text-stone-500 hover:text-stone-300 hover:border-stone-700 text-sm transition-colors"
              >
                ← All Witnesses
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
