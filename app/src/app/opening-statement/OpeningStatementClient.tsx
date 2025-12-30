'use client';

import { useEffect, useState } from 'react';
import { useAIAssistant } from '../components/AIAssistant';

export default function OpeningStatementClient() {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const { setContext } = useAIAssistant();

  useEffect(() => {
    async function loadContent() {
      try {
        const res = await fetch('/data/opening-statement.md');
        const text = await res.text();
        setContent(text);
        
        // Register content with AI assistant
        setContext('opening-statement', text, 'The Opening Statement');
      } catch (error) {
        console.error('Failed to load opening statement:', error);
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

  // Parse the markdown content - skip header section up to first "## הקדמה"
  const lines = content.split('\n');
  const bodyStartIndex = lines.findIndex(l => l.startsWith('## הקדמה'));
  const bodyLines = bodyStartIndex > 0 ? lines.slice(bodyStartIndex) : lines.slice(12);

  return (
    <main className="min-h-screen">
      {/* Hero */}
      <section className="py-20 px-6 border-b border-stone-900 bg-gradient-to-b from-stone-900/50 to-transparent">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-stone-600 text-xs tracking-[0.3em] uppercase mb-4">April 17-18, 1961 • Sessions 6-8</p>
          <h1 className="text-4xl md:text-5xl font-light mb-4">
            נאום הפתיחה
          </h1>
          <h2 className="font-serif text-2xl md:text-3xl font-light text-stone-400 mb-8">
            The Opening Statement
          </h2>
          <p className="text-stone-500 text-lg max-w-2xl mx-auto mb-10">
            Attorney General Gideon Hausner&apos;s historic address to the court
          </p>
          
          <div className="inline-block border border-amber-800/50 bg-amber-900/20 px-8 py-6 text-right max-w-2xl" dir="rtl">
            <p className="text-amber-200/90 text-lg leading-relaxed">
              &ldquo;במקום זה, בו אני עומד לפניכם, שופטי ישראל, ללמד קטגוריה על אדולף אייכמן – 
              אין אני עומד יחידי; עמדי ניצבים כאן בשעה זו שישה מיליון קטגורים.&rdquo;
            </p>
            <p className="text-amber-600 text-sm mt-4 text-left" dir="ltr">— Gideon Hausner, Attorney General</p>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="py-16 px-6">
        <div className="max-w-3xl mx-auto">
          <div 
            className="space-y-6"
            dir="rtl"
            lang="he"
          >
            {bodyLines.map((line, idx) => {
              const trimmed = line.trim();
              if (!trimmed) return null;
              
              // Section headers (## in markdown)
              if (trimmed.startsWith('## ')) {
                const headerText = trimmed.replace('## ', '');
                return (
                  <h2 key={idx} className="text-2xl text-stone-200 mt-16 mb-8 border-b border-stone-800 pb-4 first:mt-0">
                    {headerText}
                  </h2>
                );
              }
              
              // Blockquotes
              if (trimmed.startsWith('> ')) {
                return (
                  <blockquote key={idx} className="border-r-4 border-amber-700 pr-6 py-2 text-stone-300 italic">
                    {trimmed.replace('> ', '').replace(/^\*/, '').replace(/\*$/, '')}
                  </blockquote>
                );
              }
              
              // Bold text (already in **)
              if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
                return (
                  <p key={idx} className="text-stone-300 font-medium">
                    {trimmed.replace(/\*\*/g, '')}
                  </p>
                );
              }
              
              // Horizontal rules
              if (trimmed === '---') {
                return <hr key={idx} className="border-stone-800 my-12" />;
              }
              
              // End markers
              if (trimmed.startsWith('*סוף') || trimmed.startsWith('*End')) {
                return (
                  <p key={idx} className="text-stone-600 text-center italic mt-16">
                    {trimmed.replace(/^\*/, '').replace(/\*$/, '')}
                  </p>
                );
              }
              
              // Regular paragraphs
              return (
                <p key={idx} className="text-stone-400 leading-relaxed text-lg">
                  {trimmed}
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
            The opening statement was delivered over Sessions 6, 7, and 8 of the trial.
          </p>
          <p className="text-stone-600 text-xs mt-2">
            Source: Official Trial Transcripts, Volume 1
          </p>
        </div>
      </section>
    </main>
  );
}
