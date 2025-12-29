'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface FileInfo {
  name: string;
  size: number;
  sizeFormatted: string;
  sessions: string[];
  description: string;
}

export default function FilesPage() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'testimonies' | 'other'>('all');

  useEffect(() => {
    async function loadFiles() {
      try {
        const res = await fetch('/api/files');
        const data = await res.json();
        setFiles(data.files || []);
      } catch (error) {
        console.error('Failed to load files:', error);
      } finally {
        setLoading(false);
      }
    }
    loadFiles();
  }, []);

  // Filter files
  const filteredFiles = files.filter(file => {
    if (filter === 'all') return true;
    if (filter === 'testimonies') {
      return file.name.startsWith('Vol') || file.name.startsWith('vol');
    }
    return !file.name.startsWith('Vol') && !file.name.startsWith('vol');
  });

  // Separate main volumes from other documents
  const mainVolumes = filteredFiles.filter(f => 
    (f.name.startsWith('Vol') || f.name.startsWith('vol')) && 
    !f.name.includes('summary') && 
    !f.name.includes('test')
  );
  
  const otherDocs = filteredFiles.filter(f => 
    (!f.name.startsWith('Vol') && !f.name.startsWith('vol')) ||
    f.name.includes('summary')
  );

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-stone-500">Loading files...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      {/* Hero */}
      <section className="py-16 px-6 border-b border-stone-900">
        <div className="max-w-7xl mx-auto">
          <Link href="/explore" className="text-stone-500 hover:text-stone-300 text-sm mb-6 inline-block">
            ← Back to Explore
          </Link>
          
          <h1 className="font-serif text-4xl md:text-5xl font-light mb-6">
            Source Files
          </h1>
          <p className="text-stone-400 text-lg max-w-2xl">
            The raw text files extracted from the trial transcript PDFs. 
            Click any file to view its contents or download.
          </p>
        </div>
      </section>

      {/* Filter */}
      <section className="py-6 px-6 border-b border-stone-900 bg-stone-900/30">
        <div className="max-w-7xl mx-auto">
          <div className="flex gap-3">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 text-sm border transition-colors ${
                filter === 'all' 
                  ? 'border-stone-500 text-stone-200 bg-stone-800' 
                  : 'border-stone-800 text-stone-500 hover:border-stone-700'
              }`}
            >
              All Files ({files.length})
            </button>
            <button
              onClick={() => setFilter('testimonies')}
              className={`px-4 py-2 text-sm border transition-colors ${
                filter === 'testimonies' 
                  ? 'border-stone-500 text-stone-200 bg-stone-800' 
                  : 'border-stone-800 text-stone-500 hover:border-stone-700'
              }`}
            >
              Trial Transcripts
            </button>
            <button
              onClick={() => setFilter('other')}
              className={`px-4 py-2 text-sm border transition-colors ${
                filter === 'other' 
                  ? 'border-stone-500 text-stone-200 bg-stone-800' 
                  : 'border-stone-800 text-stone-500 hover:border-stone-700'
              }`}
            >
              Other Documents
            </button>
          </div>
        </div>
      </section>

      {/* Main Volumes */}
      {mainVolumes.length > 0 && (filter === 'all' || filter === 'testimonies') && (
        <section className="py-12 px-6 border-b border-stone-900">
          <div className="max-w-7xl mx-auto">
            <h2 className="font-serif text-2xl mb-6">Trial Transcripts</h2>
            <p className="text-stone-500 text-sm mb-8">
              The main trial transcript volumes containing witness testimonies.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {mainVolumes.map((file) => (
                <Link
                  key={file.name}
                  href={`/explore/files/${encodeURIComponent(file.name)}`}
                  className="block border border-stone-800 hover:border-stone-700 bg-stone-900/30 hover:bg-stone-900/50 transition-all p-6"
                >
                  <div className="flex items-start justify-between mb-3">
                    <span className="text-lg">📄</span>
                    <span className="text-stone-600 text-xs font-mono">{file.sizeFormatted}</span>
                  </div>
                  
                  <h3 className="text-stone-200 font-medium mb-2 font-mono text-sm">
                    {file.name}
                  </h3>
                  
                  <p className="text-stone-500 text-sm mb-3">
                    {file.description}
                  </p>
                  
                  {file.sessions.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {file.sessions.map((s, i) => (
                        <span 
                          key={i}
                          className="px-2 py-0.5 bg-stone-800 text-stone-400 text-xs"
                        >
                          Sessions {s}
                        </span>
                      ))}
                    </div>
                  )}
                  
                  <div className="mt-4 pt-4 border-t border-stone-800">
                    <span className="text-stone-500 text-xs">
                      View file →
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Other Documents */}
      {otherDocs.length > 0 && (filter === 'all' || filter === 'other') && (
        <section className="py-12 px-6">
          <div className="max-w-7xl mx-auto">
            <h2 className="font-serif text-2xl mb-6">Other Documents</h2>
            <p className="text-stone-500 text-sm mb-8">
              Summaries, claims, judgements, and other trial-related documents.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {otherDocs.map((file) => (
                <Link
                  key={file.name}
                  href={`/explore/files/${encodeURIComponent(file.name)}`}
                  className="block border border-stone-800 hover:border-stone-700 bg-stone-900/30 hover:bg-stone-900/50 transition-all p-4"
                >
                  <div className="flex items-start justify-between mb-2">
                    <span>📄</span>
                    <span className="text-stone-600 text-xs font-mono">{file.sizeFormatted}</span>
                  </div>
                  
                  <h3 className="text-stone-300 text-sm font-mono mb-1 truncate">
                    {file.name}
                  </h3>
                  
                  <p className="text-stone-600 text-xs">
                    {file.description}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-stone-900">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-stone-600 text-sm">
            Files extracted from the official Israel State Archives trial transcripts.
          </p>
        </div>
      </footer>
    </main>
  );
}
