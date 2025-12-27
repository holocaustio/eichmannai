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
  name: string;
  englishName: string;
  hebrewVariants: string[];
  type: string;
  role: string;
  sources: Source[];
}

interface EntitiesData {
  metadata: {
    file: string;
    generatedAt: string;
    totalEntities: number;
  };
  entities: Witness[];
}

export default function WitnessesPage() {
  const [witnesses, setWitnesses] = useState<Witness[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    async function loadWitnesses() {
      try {
        const res = await fetch('/data/entities.json');
        const data: EntitiesData = await res.json();
        
        // Filter only WITNESS type entities
        const witnessEntities = data.entities.filter(e => e.type === 'WITNESS');
        setWitnesses(witnessEntities);
      } catch (error) {
        console.error('Failed to load witnesses:', error);
      } finally {
        setLoading(false);
      }
    }
    
    loadWitnesses();
  }, []);

  // Filter witnesses by search query
  const filteredWitnesses = witnesses.filter(w => {
    const query = searchQuery.toLowerCase();
    return (
      w.englishName.toLowerCase().includes(query) ||
      w.name.toLowerCase().includes(query) ||
      w.hebrewVariants.some(v => v.includes(searchQuery))
    );
  });

  // Get unique sessions for a witness
  const getSessions = (sources: Source[]) => {
    return [...new Set(sources.map(s => s.session).filter(Boolean))].sort((a, b) => a - b);
  };

  // Get primary Hebrew name
  const getHebrewName = (witness: Witness) => {
    const hebrew = witness.hebrewVariants.find(v => /[\u0590-\u05FF]/.test(v));
    return hebrew || witness.hebrewVariants[0] || '';
  };

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
          <div className="w-24" /> {/* Spacer for alignment */}
        </div>
      </header>

      {/* Hero */}
      <section className="py-16 px-6 border-b border-stone-900">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-stone-600 text-xs tracking-[0.3em] uppercase mb-4">The Voices</p>
          <h2 className="font-serif text-4xl md:text-5xl font-light mb-6">
            Witnesses of the Trial
          </h2>
          <p className="text-stone-400 text-lg max-w-2xl mx-auto">
            {witnesses.length} witnesses testified during the Eichmann Trial. 
            Their voices shaped how the Holocaust would be remembered.
          </p>
        </div>
      </section>

      {/* Search */}
      <section className="py-8 px-6 border-b border-stone-900">
        <div className="max-w-4xl mx-auto">
          <div className="relative">
            <input
              type="text"
              placeholder="Search witnesses by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-stone-900 border border-stone-800 rounded-none px-4 py-3 text-stone-200 placeholder-stone-600 focus:outline-none focus:border-stone-600 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300"
              >
                ✕
              </button>
            )}
          </div>
          {searchQuery && (
            <p className="text-stone-500 text-sm mt-2">
              Found {filteredWitnesses.length} witness{filteredWitnesses.length !== 1 ? 'es' : ''}
            </p>
          )}
        </div>
      </section>

      {/* Witnesses Grid */}
      <section className="py-12 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredWitnesses.map((witness, index) => (
              <WitnessCard 
                key={`${witness.name}-${index}`}
                witness={witness}
                hebrewName={getHebrewName(witness)}
                sessions={getSessions(witness.sources)}
                mentionCount={witness.sources.length}
              />
            ))}
          </div>

          {filteredWitnesses.length === 0 && (
            <div className="text-center py-16">
              <p className="text-stone-500">No witnesses found matching "{searchQuery}"</p>
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-stone-900">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-stone-600 text-sm">
            Data extracted from trial transcripts using AI-assisted analysis.
          </p>
        </div>
      </footer>
    </main>
  );
}

// Witness Card Component
function WitnessCard({ 
  witness, 
  hebrewName, 
  sessions, 
  mentionCount 
}: { 
  witness: Witness; 
  hebrewName: string;
  sessions: number[];
  mentionCount: number;
}) {
  return (
    <Link 
      href={`/witnesses/${encodeURIComponent(witness.englishName)}`}
      className="group block border border-stone-800 hover:border-stone-700 bg-stone-900/30 hover:bg-stone-900/50 transition-all duration-300 p-6"
    >
      {/* Hebrew Initial */}
      <div className="w-12 h-12 border border-stone-700 flex items-center justify-center mb-4 group-hover:border-stone-600 transition-colors">
        <span className="text-stone-400 group-hover:text-stone-300 text-xl font-serif">
          {hebrewName ? hebrewName.charAt(0) : witness.englishName.charAt(0)}
        </span>
      </div>

      {/* Name */}
      <h3 className="font-serif text-xl text-stone-200 mb-1 group-hover:text-white transition-colors">
        {witness.englishName}
      </h3>
      
      {/* Hebrew Name */}
      {hebrewName && (
        <p className="text-stone-500 text-sm mb-4" dir="rtl">
          {hebrewName}
        </p>
      )}

      {/* Metadata */}
      <div className="flex flex-wrap gap-3 text-xs text-stone-500">
        {sessions.length > 0 && (
          <span className="border border-stone-800 px-2 py-1">
            Session{sessions.length > 1 ? 's' : ''} {sessions.join(', ')}
          </span>
        )}
        <span className="border border-stone-800 px-2 py-1">
          {mentionCount} mention{mentionCount !== 1 ? 's' : ''}
        </span>
      </div>
    </Link>
  );
}

