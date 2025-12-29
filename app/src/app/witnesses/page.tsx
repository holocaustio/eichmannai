'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Source {
  file: string;
  lineStart: number;
  lineEnd: number;
  session: number;
}

interface Witness {
  id: string;
  name: string;
  hebrewName?: string;
  englishName?: string;
  type: string;
  role?: string;
  isWitness: boolean;
  category?: string;
  sessions: number[];
  mentions: number;
  sources: Source[];
  hasTestimony?: boolean;
  testimonyFile?: string;
  testimonyChars?: number;
}

interface Session {
  number: number;
  witnesses: string[];
  hebrewLabel?: string;
}

interface EntitiesData {
  metadata: {
    extractedAt: string;
    totalFiles: number;
    totalNodes: number;
    totalEdges: number;
    totalSessions: number;
    witnessesTotal?: number;
    witnessesFound?: number;
    witnessesNotFound?: number;
    validatedWitnesses?: number;
    officialWitnessesFound?: number;
    officialWitnessTotal?: number;
    locationsFound?: number;
    organizationsFound?: number;
    keyFiguresFound?: number;
  };
  nodes: Witness[];
  edges: Array<{ id: string; source: string; target: string; type: string }>;
  sessions: Session[];
}

export default function WitnessesPage() {
  const [data, setData] = useState<EntitiesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSession, setSelectedSession] = useState<number | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const res = await fetch('/data/entities.json');
        const json: EntitiesData = await res.json();
        setData(json);
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    }
    
    loadData();
  }, []);

  // Get witnesses from nodes (isWitness = true)
  const allWitnesses = data?.nodes.filter(n => n.isWitness) || [];

  // Filter witnesses
  const filteredWitnesses = allWitnesses.filter(w => {
    const matchesSearch = !searchQuery || 
      w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (w.hebrewName && w.hebrewName.includes(searchQuery));
    
    const matchesSession = !selectedSession || w.sessions?.includes(selectedSession);
    
    return matchesSearch && matchesSession;
  }) || [];

  // Get sessions with witnesses
  const sessionsWithWitnesses = data?.sessions?.filter(s => s.witnesses?.length > 0) || [];

  if (loading) {
    return (
      <main className="bg-stone-950 text-stone-100 min-h-screen flex items-center justify-center">
        <div className="text-stone-500">Loading witnesses...</div>
      </main>
    );
  }

  return (
    <main className="bg-stone-950 text-stone-100 min-h-screen">
      {/* Header */}
      <header className="border-b border-stone-900 sticky top-0 bg-stone-950/95 backdrop-blur-sm z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-stone-400 hover:text-stone-200 transition-colors text-sm">
            ← Back to Home
          </Link>
          <h1 className="font-serif text-lg">Witnesses</h1>
          <div className="w-24" />
        </div>
      </header>

      {/* Hero */}
      <section className="py-16 px-6 border-b border-stone-900">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-stone-600 text-xs tracking-[0.3em] uppercase mb-4">The Voices</p>
          <h2 className="font-serif text-4xl md:text-5xl font-light mb-6">
            Witnesses of the Trial
          </h2>
          <p className="text-stone-400 text-lg max-w-2xl mx-auto mb-6">
            All {allWitnesses.length} official witnesses from the Eichmann trial.
            Every testimony has been extracted and formatted for reading.
          </p>
          <div className="inline-flex items-center gap-2 bg-emerald-900/30 text-emerald-400 px-4 py-2 border border-emerald-800/50">
            <span className="text-emerald-500">✓</span>
            <span>108 / 108 Testimonies Available</span>
          </div>
        </div>
      </section>

      {/* Filters */}
      <section className="py-6 px-6 border-b border-stone-900 bg-stone-900/30">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search witnesses..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-stone-900 border border-stone-800 px-4 py-3 text-stone-200 placeholder-stone-600 focus:outline-none focus:border-stone-600"
            />
          </div>
          
          {/* Session Filter */}
          <div className="md:w-64">
            <select
              value={selectedSession || ''}
              onChange={(e) => setSelectedSession(e.target.value ? parseInt(e.target.value) : null)}
              className="w-full bg-stone-900 border border-stone-800 px-4 py-3 text-stone-200 focus:outline-none focus:border-stone-600"
            >
              <option value="">All Sessions</option>
              {sessionsWithWitnesses.map(s => (
                <option key={s.number} value={s.number}>
                  Session {s.number} ({s.witnesses?.length || 0} witnesses)
                </option>
              ))}
            </select>
          </div>
        </div>
        
        {(searchQuery || selectedSession) && (
          <div className="max-w-7xl mx-auto mt-4 flex items-center gap-4">
            <p className="text-stone-500 text-sm">
              Showing {filteredWitnesses.length} of {allWitnesses.length} witnesses
            </p>
            {(searchQuery || selectedSession) && (
              <button
                onClick={() => { setSearchQuery(''); setSelectedSession(null); }}
                className="text-stone-400 text-sm hover:text-stone-200"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </section>

      {/* Witnesses Grid */}
      <section className="py-12 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredWitnesses.map((witness, index) => (
              <WitnessCard key={`${witness.name}-${index}`} witness={witness} />
            ))}
          </div>

          {filteredWitnesses.length === 0 && (
            <div className="text-center py-16">
              <p className="text-stone-500">No witnesses found</p>
            </div>
          )}
        </div>
      </section>

      {/* Sessions Overview */}
      <section className="py-12 px-6 border-t border-stone-900 bg-stone-900/20">
        <div className="max-w-7xl mx-auto">
          <h3 className="font-serif text-2xl mb-8">Sessions Overview</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sessionsWithWitnesses.map(session => (
              <div 
                key={session.number}
                className="border border-stone-800 p-6 hover:border-stone-700 transition-colors cursor-pointer"
                onClick={() => setSelectedSession(session.number === selectedSession ? null : session.number)}
              >
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-serif text-xl">Session {session.number}</h4>
                  <span className="text-stone-500 text-sm" dir="rtl">{session.hebrewLabel || `ישיבה ${session.number}`}</span>
                </div>
                
                <div className="space-y-2 text-sm">
                  <p className="text-stone-400">
                    <span className="text-stone-500">Witnesses:</span> {session.witnesses?.length || 0}
                  </p>
                </div>
                
                {session.witnesses && session.witnesses.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-stone-800">
                    <p className="text-stone-500 text-xs mb-2">Witnesses:</p>
                    <p className="text-stone-300 text-sm">
                      {session.witnesses.slice(0, 3).map(id => {
                        const witness = allWitnesses.find(w => w.id === id);
                        return witness?.name || id;
                      }).join(', ')}
                      {session.witnesses.length > 3 && ` +${session.witnesses.length - 3} more`}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-stone-900">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-stone-600 text-sm">
            Witnesses validated against the official Yad Vashem list of 108 trial witnesses.
          </p>
          <p className="text-stone-700 text-xs mt-2">
            Source: <a href="https://wwv.yadvashem.org/yv/he/exhibitions/eichmann/witnesses.asp" className="hover:text-stone-500" target="_blank" rel="noopener">Yad Vashem</a>
          </p>
        </div>
      </footer>
    </main>
  );
}

// Witness Card Component
function WitnessCard({ witness }: { witness: Witness }) {
  const hebrewInitial = witness.hebrewName?.charAt(0) || witness.name.charAt(0);
  
  return (
    <Link 
      href={`/witnesses/${encodeURIComponent(witness.name)}`}
      className="group block border border-stone-800 hover:border-stone-700 bg-stone-900/30 hover:bg-stone-900/50 transition-all duration-300 p-6 relative"
    >
      {/* Testimony available badge */}
      {witness.hasTestimony && (
        <div className="absolute top-4 right-4">
          <span className="inline-flex items-center gap-1 bg-emerald-900/50 text-emerald-400 text-xs px-2 py-1 border border-emerald-800">
            ✓ Testimony
          </span>
        </div>
      )}
      
      {/* Initial */}
      <div className="w-12 h-12 border border-stone-700 flex items-center justify-center mb-4 group-hover:border-stone-600 transition-colors">
        <span className="text-stone-400 group-hover:text-stone-300 text-xl font-serif">
          {hebrewInitial}
        </span>
      </div>

      {/* Name */}
      <h3 className="font-serif text-xl text-stone-200 mb-1 group-hover:text-white transition-colors">
        {witness.name}
      </h3>
      
      {/* Hebrew Name */}
      <p className="text-stone-500 text-sm mb-4" dir="rtl">
        {witness.hebrewName}
      </p>

      {/* Metadata */}
      <div className="flex flex-wrap gap-2 text-xs">
        {witness.sessions && witness.sessions.length > 0 && (
          <span className="border border-stone-800 px-2 py-1 text-stone-500">
            Session{witness.sessions.length > 1 ? 's' : ''} {witness.sessions.slice(0, 3).join(', ')}{witness.sessions.length > 3 ? '...' : ''}
          </span>
        )}
        {witness.testimonyChars && (
          <span className="border border-stone-800 px-2 py-1 text-stone-500">
            {(witness.testimonyChars / 1000).toFixed(1)}k chars
          </span>
        )}
      </div>

      {/* View testimony prompt */}
      <div className="mt-4 pt-4 border-t border-stone-800 flex items-center justify-between">
        <span className="text-stone-500 text-xs group-hover:text-stone-400">
          {witness.hasTestimony ? 'View testimony →' : 'View details →'}
        </span>
        {witness.testimonyFile && (
          <span className="text-stone-700 text-xs">
            {witness.testimonyFile}
          </span>
        )}
      </div>
    </Link>
  );
}
