'use client';

import { useEffect, useState } from 'react';
import { useAIAssistant } from '../components/AIAssistant';

export default function VerdictClient() {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const { setContext } = useAIAssistant();

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

  // Parse the content - skip header lines
  const lines = content.split('\n');
  const bodyStartIndex = lines.findIndex(l => l.includes('Adolf Eichmann has been brought'));
  const bodyLines = bodyStartIndex > 0 ? lines.slice(bodyStartIndex) : lines.slice(10);

  return (
    <main className="min-h-screen">
      {/* Hero */}
      <section className="py-20 px-6 border-b border-stone-900 bg-gradient-to-b from-stone-900/50 to-transparent">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-stone-600 text-xs tracking-[0.3em] uppercase mb-4">December 11-12, 1961</p>
          <h1 className="font-serif text-4xl md:text-5xl font-light mb-6">
            The Judgment
          </h1>
          <p className="text-stone-400 text-lg max-w-2xl mx-auto mb-8">
            The verdict rendered by the District Court of Jerusalem in Criminal Case No. 40/61
          </p>
          
          <div className="flex justify-center gap-8 text-sm text-stone-500">
            <div>
              <p className="text-stone-400">Presiding</p>
              <p className="text-stone-300">Judge Moshe Landau</p>
            </div>
            <div>
              <p className="text-stone-400">Judge</p>
              <p className="text-stone-300">Benjamin Halevi</p>
            </div>
            <div>
              <p className="text-stone-400">Judge</p>
              <p className="text-stone-300">Yitzchak Raveh</p>
            </div>
          </div>
        </div>
      </section>

      {/* Table of Contents */}
      <section className="py-12 px-6 border-b border-stone-900 bg-stone-900/30">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-xl text-stone-300 mb-6 text-center">Contents</h2>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div className="space-y-2">
              <p className="text-stone-400">• Introduction and Jurisdiction</p>
              <p className="text-stone-400">• The Legal Framework</p>
              <p className="text-stone-400">• Historical Background</p>
              <p className="text-stone-400">• The Accused&apos;s Role</p>
            </div>
            <div className="space-y-2">
              <p className="text-stone-400">• Evidence and Findings</p>
              <p className="text-stone-400">• Legal Analysis</p>
              <p className="text-stone-400">• Verdict on Each Count</p>
              <p className="text-stone-400">• Sentence</p>
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="py-16 px-6">
        <div className="max-w-3xl mx-auto">
          <div 
            className="prose prose-invert prose-stone max-w-none
              prose-p:text-stone-400 prose-p:leading-relaxed prose-p:mb-6
              prose-headings:font-serif prose-headings:font-light prose-headings:text-stone-200
              prose-h2:text-2xl prose-h2:mt-16 prose-h2:mb-8 prose-h2:border-b prose-h2:border-stone-800 prose-h2:pb-4
              prose-strong:text-stone-300"
          >
            {bodyLines.map((line, idx) => {
              const trimmed = line.trim();
              if (!trimmed) return <br key={idx} />;
              
              // Check for numbered sections (e.g., "2. ", "10. ")
              if (trimmed.match(/^\d+\.\s+[A-Z]/)) {
                return (
                  <h2 key={idx} className="font-serif text-xl text-stone-200 mt-12 mb-6 border-b border-stone-800 pb-3">
                    {trimmed}
                  </h2>
                );
              }
              
              // Check for "JUDGMENT" or major section headers
              if (trimmed === 'JUDGMENT' || trimmed === 'SENTENCE') {
                return (
                  <h2 key={idx} className="font-serif text-2xl text-stone-100 mt-16 mb-8 text-center">
                    {trimmed}
                  </h2>
                );
              }
              
              // Regular paragraph
              return <p key={idx}>{trimmed}</p>;
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
