'use client';

import { useEffect, useState } from 'react';
import { useAIAssistant } from '../components/AIAssistant';

type Language = 'en' | 'he';

export default function OpeningStatementClient() {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState<Language>('en');
  const { setContext, openAssistant } = useAIAssistant();

  useEffect(() => {
    async function loadContent() {
      setLoading(true);
      try {
        const file = language === 'en' ? '/data/opening-statement-en.md' : '/data/opening-statement.md';
        const res = await fetch(file);
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
  }, [language, setContext]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-stone-500">Loading...</div>
      </main>
    );
  }

  // Parse markdown content
  const lines = content.split('\n');
  // Find body start - skip header metadata
  const bodyStartIndex = language === 'en' 
    ? lines.findIndex(l => l.startsWith('## THE ATTORNEY') || l.includes('Introduction'))
    : lines.findIndex(l => l.startsWith('## הקדמה'));
  const bodyLines = bodyStartIndex > 0 ? lines.slice(bodyStartIndex) : lines.slice(12);

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
          <p className="text-stone-300 text-xs tracking-[0.3em] uppercase mb-4">April 17-18, 1961 • Sessions 6-8</p>
          <h1 className="font-serif text-4xl md:text-5xl font-light mb-6">
            The Opening Statement
          </h1>
          <p className="text-stone-300 text-lg max-w-3xl mx-auto leading-relaxed mb-8">
            Attorney General Gideon Hausner&apos;s historic address to the court
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
              <p className="text-amber-100/80 text-xs leading-tight">Get a summary of the opening statement</p>
            </div>
          </button>
        </div>
      </section>

      {/* Quote Section */}
      <section className="py-12 px-6 border-b border-stone-900 bg-stone-900/50">
        <div className="max-w-3xl mx-auto">
          {/* Language Toggle */}
          <div className="flex justify-center gap-2 mb-8">
            <button
              onClick={() => setLanguage('en')}
              className={`px-4 py-2 text-sm border transition-colors ${
                language === 'en'
                  ? 'bg-stone-700 border-stone-600 text-stone-200'
                  : 'bg-transparent border-stone-700 text-stone-500 hover:border-stone-600 hover:text-stone-400'
              }`}
            >
              English
            </button>
            <button
              onClick={() => setLanguage('he')}
              className={`px-4 py-2 text-sm border transition-colors ${
                language === 'he'
                  ? 'bg-stone-700 border-stone-600 text-stone-200'
                  : 'bg-transparent border-stone-700 text-stone-500 hover:border-stone-600 hover:text-stone-400'
              }`}
            >
              עברית
            </button>
          </div>
          
          <div className="border border-amber-800/50 bg-amber-900/20 px-8 py-8 text-center" dir={language === 'he' ? 'rtl' : 'ltr'}>
            {language === 'he' ? (
              <p className="text-amber-200/90 text-xl md:text-2xl leading-relaxed font-serif" dir="rtl">
                &ldquo;במקום זה, בו אני עומד לפניכם, שופטי ישראל, ללמד קטגוריה על אדולף אייכמן – 
                אין אני עומד יחידי; עמדי ניצבים כאן בשעה זו שישה מיליון קטגורים.&rdquo;
              </p>
            ) : (
              <p className="text-amber-200/90 text-xl md:text-2xl leading-relaxed font-serif">
                &ldquo;When I stand before you here, Judges of Israel, to lead the Prosecution of Adolf Eichmann, 
                I am not standing alone. With me are six million accusers.&rdquo;
              </p>
            )}
            <p className="text-amber-600 text-sm mt-6">— Gideon Hausner, Attorney General</p>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="py-16 px-6">
        <div className="max-w-3xl mx-auto">
          <div 
            className="space-y-6"
            dir={language === 'he' ? 'rtl' : 'ltr'}
            lang={language === 'he' ? 'he' : 'en'}
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
              
              // Part markers (skip)
              if (trimmed.startsWith('<!-- Part')) return null;
              if (trimmed.startsWith('(Part ')) return null;
              if (trimmed.startsWith('SESSION No.')) {
                return (
                  <p key={idx} className="text-stone-500 text-sm">
                    {trimmed}
                  </p>
                );
              }
              
              // Blockquotes
              if (trimmed.startsWith('> ')) {
                return (
                  <blockquote key={idx} className={`border-${language === 'he' ? 'r' : 'l'}-4 border-amber-700 ${language === 'he' ? 'pr-6' : 'pl-6'} py-2 text-stone-300 italic`}>
                    {trimmed.replace(/^>\s*/, '').replace(/^\*/, '').replace(/\*$/, '')}
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
            Source: {language === 'en' ? 'Nizkor Project (Wayback Machine Archive)' : 'Official Trial Transcripts, Volume 1'}
          </p>
        </div>
      </section>
    </main>
  );
}
