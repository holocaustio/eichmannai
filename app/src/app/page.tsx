'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

interface Witness {
  id: string;
  name: string;
  hebrewName?: string;
  image?: string;
  isWitness: boolean;
}

interface EntitiesData {
  metadata: {
    totalNodes: number;
    totalEdges: number;
    totalSessions: number;
    witnessesTotal: number;
    locationsFound: number;
    organizationsFound: number;
    keyFiguresFound: number;
  };
}

export default function Home() {
  const [scrollY, setScrollY] = useState(0);
  const [graphStats, setGraphStats] = useState<{ entities: number; connections: number } | null>(null);

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    async function loadStats() {
      try {
        const consolidatedRes = await fetch('/data/entities-consolidated.json');
        const data: EntitiesData & { metadata: { totalNodes: number; totalEdges: number; witnesses: number } } = await consolidatedRes.json();
        
        setGraphStats({
          entities: data.metadata.totalNodes,
          connections: data.metadata.totalEdges
        });
      } catch (error) {
        console.error('Failed to load stats:', error);
      }
    }
    loadStats();
  }, []);

  return (
    <main className="bg-stone-950 text-stone-100">
      {/* Hero Section */}
      <section className="h-[700px] max-h-[600px] flex flex-col justify-center items-center px-6 relative overflow-hidden">
        {/* Background Image */}
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: 'url(/herobg.jpg)',
            transform: `translateY(${scrollY * 0.3}px)`
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
        
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <p className="text-stone-400 text-sm tracking-[0.3em] uppercase mb-8 font-light">
            Jerusalem, 1961
          </p>
          
          <h1 className="font-serif text-3xl md:text-5xl lg:text-6xl font-light leading-tight mb-8 tracking-tight">
            In 1961, the Holocaust was placed at the center of a courtroom.
          </h1>
          
          <p className="font-serif text-2xl md:text-3xl text-stone-400 font-light mb-6">
            Not through documents.
          </p>
          
          <p className="font-serif text-2xl md:text-3xl text-stone-300 font-light mb-16">
            Through voices.
          </p>
          <Link 
              href="#voices"
              className="inline-block border border-stone-500 px-8 py-4 text-sm tracking-widest uppercase hover:bg-stone-900/50 hover:border-stone-400 transition-all duration-500"
            >
              Enter the Voices
            </Link>
          
        </div>
        
      </section>

      {/* Before the Trial */}
      <section className="py-32 px-6 border-b border-stone-900">
        <div className="max-w-3xl mx-auto">
          <p className="text-stone-600 text-xs tracking-[0.3em] uppercase mb-6">Before the Trial</p>
          
          <h2 className="font-serif text-3xl md:text-5xl font-light mb-16 leading-tight">
            Silence and Fragments
          </h2>
          
          <div className="space-y-8 text-stone-400 text-lg leading-relaxed font-light">
            <p>
              The Holocaust was known, but not yet heard.
            </p>
            
            <p>
              Knowledge came from Nazi documents. Survivors rarely spoke publicly. Memory was fragmented, local, often private.
            </p>
            
            <p>
              Courts focused on perpetrators, not lived experience.
            </p>
            
            <p className="text-stone-500 italic">
              This was the world before Jerusalem.
            </p>
          </div>
        </div>
      </section>

      {/* The Trial */}
      <section className="py-32 px-6 bg-stone-900/50">
        <div className="max-w-3xl mx-auto">
          <p className="text-stone-600 text-xs tracking-[0.3em] uppercase mb-6">The Trial</p>
          
          <h2 className="font-serif text-3xl md:text-5xl font-light mb-16 leading-tight">
            A Courtroom Becomes a Stage for Memory
          </h2>
          
          <div className="space-y-8 text-stone-400 text-lg leading-relaxed font-light mb-20">
            <p>
              This was not just a legal proceeding. It was an act of collective testimony.
            </p>
            
            <p>
              More than one hundred witnesses testified before the court. Their testimonies addressed 
              events across ghettos, deportations, camps, and daily life under Nazi rule.
            </p>
            
            <p>
              The trial placed survivor testimony at the center of a major criminal proceeding, 
              presented publicly and recorded in full. The world listened in real time.
            </p>
          </div>
          
          {/* Statistics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 border-t border-stone-800 pt-16">
            <div className="text-center">
              <p className="font-serif text-4xl md:text-5xl text-stone-200 mb-2">110+</p>
              <p className="text-stone-500 text-sm tracking-wide">Witnesses</p>
            </div>
            <div className="text-center">
              <p className="font-serif text-4xl md:text-5xl text-stone-200 mb-2">121</p>
              <p className="text-stone-500 text-sm tracking-wide">Sessions</p>
            </div>
            <div className="text-center">
              <p className="font-serif text-4xl md:text-5xl text-stone-200 mb-2">275</p>
              <p className="text-stone-500 text-sm tracking-wide">Hours</p>
            </div>
            <div className="text-center">
              <p className="font-serif text-4xl md:text-5xl text-stone-200 mb-2">75</p>
              <p className="text-stone-500 text-sm tracking-wide">Volumes</p>
            </div>
          </div>
        </div>
      </section>

      {/* The Voices */}
      <section id="voices" className="py-32 px-6 border-t border-stone-900">
        <div className="max-w-3xl mx-auto">
          <p className="text-stone-600 text-xs tracking-[0.3em] uppercase mb-6">The Voices</p>
          
          <h2 className="font-serif text-3xl md:text-5xl font-light mb-16 leading-tight">
            Witnesses at the Center
          </h2>
          
          <div className="space-y-8 text-stone-400 text-lg leading-relaxed font-light mb-16">
            <p>
              History shifted when voices became primary.
            </p>
            
            <p>
              Witnesses came from different places—camps, ghettos, resistance movements. Many had never spoken publicly before. Their testimonies shaped how the Holocaust would be remembered.
            </p>
          </div>
          
          {/* Witness Preview Grid */}
          <WitnessPreviewGrid />
          
          <Link 
            href="/witnesses"
            className="inline-block border border-stone-700 px-6 py-3 text-sm tracking-widest uppercase hover:bg-stone-900 hover:border-stone-600 transition-all duration-300"
          >
            Meet the Witnesses
          </Link>
        </div>
      </section>

      {/* After the Trial */}
      <section className="py-32 px-6 bg-stone-900/30">
        <div className="max-w-3xl mx-auto">
          <p className="text-stone-600 text-xs tracking-[0.3em] uppercase mb-6">After the Trial</p>
          
          <h2 className="font-serif text-3xl md:text-5xl font-light mb-16 leading-tight">
            How Memory Changed
          </h2>
          
          <div className="space-y-8 text-stone-400 text-lg leading-relaxed font-light mb-16">
            <p>
              After the trial, testimony became central to education. Survivor voices entered classrooms, museums, archives. Memory shifted from documents to lived experience.
            </p>
          </div>
          
          <blockquote className="border-l-2 border-stone-700 pl-8 py-4">
            <p className="font-serif text-2xl md:text-3xl text-stone-300 font-light leading-relaxed">
              After 1961, the Holocaust was no longer only documented. It was spoken.
            </p>
          </blockquote>
        </div>
      </section>

      {/* The Digital Archive */}
      <section className="py-32 px-6 border-t border-stone-900">
        <div className="max-w-3xl mx-auto">
          <p className="text-stone-600 text-xs tracking-[0.3em] uppercase mb-6">The Digital Archive</p>
          
          <h2 className="font-serif text-3xl md:text-5xl font-light mb-16 leading-tight">
            Preserving What Was Spoken
          </h2>
          
          <div className="space-y-8 text-stone-400 text-lg leading-relaxed font-light mb-12">
            <p>
              This archive brings together trial transcripts, witness testimony, and supporting materials 
              from the 1961 proceedings—making them accessible through modern digital tools.
            </p>
            
            <p>
              Technology does not replace memory. It protects and connects it. AI here does not speak 
              for witnesses—it helps understand them.
            </p>
          </div>
          
          <div className="bg-stone-900/50 border border-stone-800 p-8">
            <p className="text-stone-300 text-base leading-relaxed">
              Primary sources remain central. Digital tools support access, navigation, and comprehension—not 
              interpretation or dramatization.
            </p>
          </div>
        </div>
      </section>

      {/* How to Explore */}
      <section className="py-32 px-6 bg-stone-900/50">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-stone-600 text-xs tracking-[0.3em] uppercase mb-6">Explore</p>
          
          <h2 className="font-serif text-3xl md:text-4xl font-light mb-12 leading-tight">
            An Invitation, Not an Instruction
          </h2>
          
          <div className="grid md:grid-cols-3 gap-8 text-left max-w-4xl mx-auto">
            <Link href="/witnesses" className="p-6 border border-stone-800 hover:border-stone-700 transition-colors group">
              <p className="text-stone-300 font-medium mb-2 group-hover:text-white">Explore through witnesses</p>
              <p className="text-stone-500 text-sm">Discover testimonies by those who lived it.</p>
            </Link>
            
            <Link href="/explore" className="p-6 border border-stone-800 hover:border-stone-700 transition-colors group">
              <p className="text-stone-300 font-medium mb-2 group-hover:text-white">Follow connections</p>
              <p className="text-stone-500 text-sm">Between people, places, and events.</p>
            </Link>
            
            <Link href="/about" className="p-6 border border-stone-800 hover:border-stone-700 transition-colors group">
              <p className="text-stone-300 font-medium mb-2 group-hover:text-white">Learn about the project</p>
              <p className="text-stone-500 text-sm">The process and work behind this archive.</p>
            </Link>
          </div>
        </div>
      </section>

      {/* Closing */}
      <section className="py-32 px-6 border-t border-stone-900">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="font-serif text-3xl md:text-4xl font-light mb-12 leading-tight text-stone-300">
            Why It Still Matters
          </h2>
          
          <p className="text-stone-400 text-lg leading-relaxed font-light mb-12">
            These voices were recorded so they would not fade. Listening is now the responsibility of those who come after.
          </p>
          
          <blockquote className="mb-16">
            <p className="font-serif text-xl md:text-2xl text-stone-200 font-light italic">
              &quot;Remembering through voices is not passive. It is an act.&quot;
            </p>
          </blockquote>
          
          <Link 
            href="/witnesses"
            className="inline-block bg-stone-100 text-stone-900 px-10 py-4 text-sm tracking-widest uppercase hover:bg-white transition-colors duration-300"
          >
            Begin
          </Link>
        </div>
      </section>

    </main>
  );
}

// Witness Preview Grid Component
function WitnessPreviewGrid() {
  const [witnesses, setWitnesses] = useState<Witness[]>([]);

  useEffect(() => {
    async function loadWitnesses() {
      try {
        const res = await fetch('/data/entities-consolidated.json');
        const data = await res.json();
        // Get 6 random witnesses that have images
        const allWitnesses = data.nodes.filter((n: Witness) => n.isWitness && n.image);
        const shuffled = allWitnesses.sort(() => Math.random() - 0.5);
        setWitnesses(shuffled.slice(0, 6));
      } catch (error) {
        console.error('Failed to load witnesses:', error);
      }
    }
    loadWitnesses();
  }, []);

  if (witnesses.length === 0) {
    return (
      <div className="grid grid-cols-3 md:grid-cols-6 gap-4 mb-12">
        {[...Array(6)].map((_, i) => (
          <div 
            key={i}
            className="aspect-[3/4] bg-stone-800/50 border border-stone-800 flex items-center justify-center"
          >
            <span className="text-stone-600 text-2xl font-serif">ע</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-4 mb-12">
      {witnesses.map((witness) => (
        <Link
          key={witness.id}
          href={`/witnesses/${encodeURIComponent(witness.name)}`}
          className="group relative aspect-[3/4] bg-stone-900 border border-stone-800 overflow-hidden hover:border-stone-600 transition-all"
        >
          {witness.image && (
            <Image
              src={witness.image}
              alt={witness.name}
              fill
              className="object-cover grayscale group-hover:grayscale-0 transition-all duration-500"
              sizes="(max-width: 768px) 33vw, 16vw"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-2">
            <p className="text-white text-xs truncate group-hover:text-amber-100 transition-colors">
              {witness.name}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}
