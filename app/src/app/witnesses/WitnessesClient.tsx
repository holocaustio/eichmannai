'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

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
  hasTestimony?: boolean;
  testimonyFile?: string;
  testimonyChars?: number;
  image?: string;
}

interface EntitiesData {
  metadata: {
    witnessesTotal?: number;
  };
  nodes: Witness[];
}

export default function WitnessesClient() {
  const [data, setData] = useState<EntitiesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    async function loadData() {
      try {
        const res = await fetch('/data/entities-consolidated.json');
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
    
    return matchesSearch;
  }) || [];

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-stone-500">Loading witnesses...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      {/* Hero */}
      <section className="min-h-[400px] flex flex-col justify-center items-center px-6 relative overflow-hidden">
        {/* Background Image */}
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: 'url(/herobg2.jpg)',
          }}
        />
        {/* Dark Overlay */}
        <div className="absolute inset-0 bg-stone-950/70" />
        {/* Inner Shadow / Vignette */}
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(12,10,8,0) 0%, rgba(12,10,8,0.3) 50%, rgba(12,10,8,1) 100%)'
          }}
        />
        
        <div className="max-w-4xl mx-auto text-center relative z-10 py-20" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>
          <p className="text-stone-300 text-xs tracking-[0.3em] uppercase mb-4">The Voices</p>
          <h1 className="font-serif text-4xl md:text-5xl font-light mb-6">
            Witnesses of the Trial
          </h1>
          <p className="text-stone-300 text-lg max-w-3xl mx-auto leading-relaxed mb-8">
            {allWitnesses.length} witnesses testified at the Eichmann trial.
            Click on any witness to read their full testimony.
          </p>
          
          {/* Search */}
          <div className="max-w-md mx-auto">
            <input
              type="text"
              placeholder="Search witnesses by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-stone-900/80 border border-stone-700 px-4 py-3 text-stone-200 placeholder-stone-500 focus:outline-none focus:border-stone-500 text-center backdrop-blur-sm"
            />
            
            {searchQuery && (
              <div className="mt-3 flex items-center justify-center gap-4">
                <p className="text-stone-400 text-sm">
                  Showing {filteredWitnesses.length} of {allWitnesses.length}
                </p>
                <button
                  onClick={() => setSearchQuery('')}
                  className="text-stone-300 text-sm hover:text-white"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        </div>
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

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-stone-900">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-stone-600 text-sm">
            Witnesses validated against the official Yad Vashem list of 108 trial witnesses.
          </p>
        </div>
      </footer>
    </main>
  );
}

// Witness Card Component
function WitnessCard({ witness }: { witness: Witness }) {
  const hebrewInitial = witness.hebrewName?.charAt(0) || witness.name.charAt(0);
  const [imageError, setImageError] = useState(false);
  
  return (
    <Link 
      href={`/witnesses/${encodeURIComponent(witness.name)}`}
      className="group block border border-stone-800 hover:border-stone-700 bg-stone-900/30 hover:bg-stone-900/50 transition-all duration-300 relative overflow-hidden"
    >
      {/* Witness Photo or Initial */}
      <div className="relative w-full aspect-[3/4] bg-stone-900 overflow-hidden">
        {witness.image && !imageError ? (
          <Image
            src={witness.image}
            alt={witness.name}
            fill
            className="object-cover grayscale group-hover:grayscale-0 transition-all duration-500 group-hover:scale-105"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-stone-900">
            <span className="text-stone-600 group-hover:text-stone-500 text-6xl font-serif">
              {hebrewInitial}
            </span>
          </div>
        )}
        
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        
        {/* Name overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <h3 className="font-serif text-lg text-white mb-0.5 group-hover:text-amber-100 transition-colors">
            {witness.name}
          </h3>
          <p className="text-stone-400 text-sm" dir="rtl">
            {witness.hebrewName}
          </p>
        </div>
      </div>

      {/* Metadata Footer */}
      <div className="p-4 border-t border-stone-800">
        <div className="flex items-center justify-between">
          <div className="flex flex-wrap gap-2 text-xs">
            {witness.sessions && witness.sessions.length > 0 && (
              <span className="border border-stone-800 px-2 py-1 text-stone-500">
                Session{witness.sessions.length > 1 ? 's' : ''} {witness.sessions.slice(0, 2).join(', ')}{witness.sessions.length > 2 ? '...' : ''}
              </span>
            )}
          </div>
          <span className="text-stone-500 text-xs group-hover:text-stone-400">
            {witness.hasTestimony ? 'Read →' : 'View →'}
          </span>
        </div>
      </div>
    </Link>
  );
}
