'use client';

import { useEffect, useState } from 'react';
import { useAIAssistant } from '../components/AIAssistant';

interface ParsedSection {
  type: 'heading' | 'paragraph' | 'major-heading';
  content: string;
  number?: string;
}

export default function VerdictClient() {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const { setContext, openAssistant } = useAIAssistant();

  useEffect(() => {
    async function loadContent() {
      try {
        const res = await fetch('/data/verdict.md');
        const text = await res.text();
        setContent(text);
        
        // Register content with AI assistant
        setContext('verdict', text, 'The Judgment');
      } catch (error) {
        console.error('Failed to load verdict:', error);
      } finally {
        setLoading(false);
      }
    }
    loadContent();
  }, [setContext]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-stone-500">Loading...</div>
      </main>
    );
  }

  // Parse the content into proper paragraphs
  // The text has numbered sections like "2. " that start new paragraphs
  const parseContent = (text: string): ParsedSection[] => {
    const lines = text.split('\n');
    const sections: ParsedSection[] = [];
    
    // Find where the body starts
    const bodyStartIndex = lines.findIndex(l => l.includes('Adolf Eichmann has been brought'));
    if (bodyStartIndex === -1) return sections;
    
    // Join all lines from body start into one string, preserving line breaks
    let currentParagraph = '';
    
    for (let i = bodyStartIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip empty lines - they might indicate paragraph breaks
      if (!line) {
        if (currentParagraph.trim()) {
          sections.push({ type: 'paragraph', content: currentParagraph.trim() });
          currentParagraph = '';
        }
        continue;
      }
      
      // Check for major headings
      if (line === 'JUDGMENT' || line === 'SENTENCE') {
        if (currentParagraph.trim()) {
          sections.push({ type: 'paragraph', content: currentParagraph.trim() });
          currentParagraph = '';
        }
        sections.push({ type: 'major-heading', content: line });
        continue;
      }
      
      // Check for numbered section starts (e.g., "2. In this maze...")
      const numberedMatch = line.match(/^(\d+)\.\s+([A-Z].*)/);
      if (numberedMatch) {
        // Save any accumulated paragraph
        if (currentParagraph.trim()) {
          sections.push({ type: 'paragraph', content: currentParagraph.trim() });
          currentParagraph = '';
        }
        // Start a new section - the number is the heading, rest starts the paragraph
        sections.push({ 
          type: 'heading', 
          content: `Section ${numberedMatch[1]}`,
          number: numberedMatch[1]
        });
        currentParagraph = numberedMatch[2] + ' ';
        continue;
      }
      
      // Regular line - append to current paragraph
      currentParagraph += line + ' ';
    }
    
    // Don't forget the last paragraph
    if (currentParagraph.trim()) {
      sections.push({ type: 'paragraph', content: currentParagraph.trim() });
    }
    
    return sections;
  };
  
  const sections = parseContent(content);

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
          <p className="text-stone-300 text-xs tracking-[0.3em] uppercase mb-4">December 11-12, 1961</p>
          <h1 className="font-serif text-4xl md:text-5xl font-light mb-6">
            The Judgment
          </h1>
          <p className="text-stone-300 text-lg max-w-3xl mx-auto leading-relaxed mb-8">
            The verdict rendered by the District Court of Jerusalem in Criminal Case No. 40/61
          </p>
          
          {/* AI Guide Button */}
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
                  d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" 
                />
              </svg>
            </div>
            <div className="text-left">
              <p className="text-white font-medium text-sm leading-tight">AI Guide</p>
              <p className="text-amber-100/80 text-xs leading-tight">Explain the judgment</p>
            </div>
          </button>
        </div>
      </section>

      {/* Judges Panel */}
      <section className="py-10 px-6 border-b border-stone-900 bg-stone-900/50">
        <div className="max-w-3xl mx-auto">
          <p className="text-stone-500 text-xs tracking-[0.2em] uppercase text-center mb-6">The Court</p>
          <div className="flex justify-center gap-12 text-sm">
            <div className="text-center">
              <p className="text-stone-500 text-xs mb-1">Presiding</p>
              <p className="text-stone-200 font-medium">Judge Moshe Landau</p>
            </div>
            <div className="text-center">
              <p className="text-stone-500 text-xs mb-1">Judge</p>
              <p className="text-stone-200 font-medium">Benjamin Halevi</p>
            </div>
            <div className="text-center">
              <p className="text-stone-500 text-xs mb-1">Judge</p>
              <p className="text-stone-200 font-medium">Yitzchak Raveh</p>
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="py-16 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="space-y-6">
            {sections.map((section, idx) => {
              if (section.type === 'major-heading') {
                return (
                  <h2 key={idx} className="font-serif text-2xl text-stone-100 mt-16 mb-8 text-center">
                    {section.content}
                  </h2>
                );
              }
              
              if (section.type === 'heading') {
                return (
                  <div key={idx} className="mt-12 mb-6 border-b border-stone-800 pb-3">
                    <h2 className="font-serif text-xl text-stone-200 flex items-center gap-3">
                      <span className="text-amber-600 font-mono text-lg">{section.number}.</span>
                    </h2>
                  </div>
                );
              }
              
              // Paragraph
              return (
                <p key={idx} className="text-stone-400 leading-relaxed text-lg">
                  {section.content}
                </p>
              );
            })}
          </div>
        </div>
      </section>

      {/* Footer note */}
      <section className="py-12 px-6 border-t border-stone-900 bg-stone-900/30">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-stone-500 text-sm">
            The judgment was delivered on December 11-12, 1961.
          </p>
          <p className="text-stone-600 text-xs mt-2">
            Adolf Eichmann was found guilty on all counts and sentenced to death.
            The sentence was carried out on May 31, 1962.
          </p>
        </div>
      </section>
    </main>
  );
}
