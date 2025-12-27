'use client';

import { useEffect, useState } from 'react';

export default function Home() {
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <main className="bg-stone-950 text-stone-100 min-h-screen">
      {/* Hero Section */}
      <section className="min-h-screen flex flex-col justify-center items-center px-6 relative overflow-hidden">
        <div 
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(circle at 50% 50%, #78716c 0%, transparent 50%)',
            transform: `translateY(${scrollY * 0.3}px)`
          }}
        />
        
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <p className="text-stone-500 text-sm tracking-[0.3em] uppercase mb-8 font-light">
            Jerusalem, 1961
          </p>
          
          <h1 className="font-serif text-4xl md:text-6xl lg:text-7xl font-light leading-tight mb-8 tracking-tight">
            In 1961, the Holocaust was placed at the center of a courtroom.
          </h1>
          
          <p className="font-serif text-2xl md:text-3xl text-stone-400 font-light mb-6">
            Not through documents.
          </p>
          
          <p className="font-serif text-2xl md:text-3xl text-stone-300 font-light mb-16">
            Through voices.
          </p>
          
          <div className="border-t border-stone-800 pt-12 max-w-2xl mx-auto">
            <p className="text-stone-400 text-lg md:text-xl font-light leading-relaxed mb-12">
              The Eichmann Trial marked the moment when survivor testimony became history.
            </p>
            
            <a 
              href="#voices"
              className="inline-block border border-stone-600 px-8 py-4 text-sm tracking-widest uppercase hover:bg-stone-900 hover:border-stone-500 transition-all duration-500"
            >
              Enter the Voices
            </a>
          </div>
        </div>
        
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 animate-bounce">
          <svg className="w-6 h-6 text-stone-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>
      </section>

      {/* Before the Trial */}
      <section className="py-32 px-6 border-t border-stone-900">
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
              Survivors were invited to speak at length. Testimony became central evidence. The world listened in real time.
            </p>
          </div>
          
          {/* Statistics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 border-t border-stone-800 pt-16">
            <div className="text-center">
              <p className="font-serif text-4xl md:text-5xl text-stone-200 mb-2">110</p>
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
              <p className="font-serif text-4xl md:text-5xl text-stone-200 mb-2">3,564</p>
              <p className="text-stone-500 text-sm tracking-wide">Pages</p>
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
          <div className="grid grid-cols-3 md:grid-cols-6 gap-4 mb-12">
            {[...Array(6)].map((_, i) => (
              <div 
                key={i}
                className="aspect-square bg-stone-800/50 border border-stone-800 flex items-center justify-center group hover:border-stone-700 transition-colors cursor-pointer"
              >
                <span className="text-stone-600 group-hover:text-stone-500 transition-colors text-2xl font-serif">
                  ע
                </span>
              </div>
            ))}
          </div>
          
          <a 
            href="/witnesses"
            className="inline-block border border-stone-700 px-6 py-3 text-sm tracking-widest uppercase hover:bg-stone-900 hover:border-stone-600 transition-all duration-300"
          >
            Meet the Witnesses
          </a>
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

      {/* Technology Section */}
      <section className="py-32 px-6 border-t border-stone-900">
        <div className="max-w-3xl mx-auto">
          <p className="text-stone-600 text-xs tracking-[0.3em] uppercase mb-6">Preservation</p>
          
          <h2 className="font-serif text-3xl md:text-5xl font-light mb-16 leading-tight">
            Why This Experience Exists Now
          </h2>
          
          <div className="space-y-8 text-stone-400 text-lg leading-relaxed font-light mb-12">
            <p>
              Technology does not replace memory. It protects and connects it.
            </p>
            
            <p>
              Testimonies were recorded using the technology of their time. Today's tools allow voices to remain accessible. AI here does not speak for witnesses—it helps understand them.
            </p>
          </div>
          
          <div className="bg-stone-900/50 border border-stone-800 p-8">
            <p className="text-stone-300 text-base leading-relaxed">
              This experience uses technology to preserve, connect, and contextualize testimony—not to reinterpret it.
            </p>
          </div>
        </div>
      </section>

      {/* How to Explore */}
      <section className="py-32 px-6 bg-stone-900/50">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-stone-600 text-xs tracking-[0.3em] uppercase mb-6">Explore</p>
          
          <h2 className="font-serif text-3xl md:text-4xl font-light mb-12 leading-tight">
            An Invitation, Not an Instruction
          </h2>
          
          <div className="grid md:grid-cols-3 gap-8 text-left">
            <div className="p-6 border border-stone-800 hover:border-stone-700 transition-colors">
              <p className="text-stone-300 font-medium mb-2">Explore through witnesses</p>
              <p className="text-stone-500 text-sm">Discover testimonies by those who lived it.</p>
            </div>
            
            <div className="p-6 border border-stone-800 hover:border-stone-700 transition-colors">
              <p className="text-stone-300 font-medium mb-2">Follow connections</p>
              <p className="text-stone-500 text-sm">Between people, places, and events.</p>
            </div>
            
            <div className="p-6 border border-stone-800 hover:border-stone-700 transition-colors">
              <p className="text-stone-300 font-medium mb-2">Ask questions</p>
              <p className="text-stone-500 text-sm">Guided by historical context.</p>
            </div>
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
              "Remembering through voices is not passive. It is an act."
            </p>
          </blockquote>
          
          <a 
            href="/witnesses"
            className="inline-block bg-stone-100 text-stone-900 px-10 py-4 text-sm tracking-widest uppercase hover:bg-white transition-colors duration-300"
          >
            Begin
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16 px-6 border-t border-stone-900">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="text-center md:text-left">
            <p className="text-stone-500 text-sm">The Eichmann Trial Archive</p>
            <p className="text-stone-600 text-xs mt-1">Preserving testimony for future generations</p>
          </div>
          
          <div className="flex gap-8 text-stone-600 text-sm">
            <a href="/about" className="hover:text-stone-400 transition-colors">About</a>
            <a href="/methodology" className="hover:text-stone-400 transition-colors">Methodology</a>
            <a href="/sources" className="hover:text-stone-400 transition-colors">Sources</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
