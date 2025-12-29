'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface FileData {
  name: string;
  content: string;
  size: number;
  lines: number;
}

export default function FileViewerPage() {
  const params = useParams();
  const fileName = decodeURIComponent(params.fileId as string);

  const [file, setFile] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showLines, setShowLines] = useState(true);
  const [visibleLines, setVisibleLines] = useState(500);

  useEffect(() => {
    async function loadFile() {
      try {
        const res = await fetch(`/api/files?file=${encodeURIComponent(fileName)}`);
        if (!res.ok) {
          throw new Error('File not found');
        }
        const data = await res.json();
        setFile(data);
      } catch (err) {
        setError('Failed to load file');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadFile();
  }, [fileName]);

  const handleDownload = useCallback(() => {
    if (!file) return;
    
    const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [file]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Filter and display content
  const getDisplayContent = () => {
    if (!file) return [];
    
    const lines = file.content.split('\n');
    
    if (searchQuery) {
      return lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => line.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    
    return lines.slice(0, visibleLines).map((line, index) => ({ line, index }));
  };

  const displayContent = getDisplayContent();
  const totalLines = file?.content.split('\n').length || 0;

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-2 border-stone-600 border-t-stone-300 rounded-full animate-spin mb-4" />
          <p className="text-stone-500">Loading file...</p>
        </div>
      </main>
    );
  }

  if (error || !file) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl mb-4">File Not Found</h1>
          <p className="text-stone-500 mb-6">Could not find file: {fileName}</p>
          <Link href="/explore/files" className="text-stone-400 hover:text-stone-200">
            ← Back to files
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      {/* Header */}
      <section className="py-8 px-6 border-b border-stone-900">
        <div className="max-w-7xl mx-auto">
          <Link href="/explore/files" className="text-stone-500 hover:text-stone-300 text-sm mb-4 inline-block">
            ← Back to Files
          </Link>
          
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="font-mono text-xl text-stone-200 mb-2">
                {file.name}
              </h1>
              <div className="flex flex-wrap gap-3 text-sm text-stone-500">
                <span>{formatBytes(file.size)}</span>
                <span>•</span>
                <span>{file.lines.toLocaleString()} lines</span>
              </div>
            </div>
            
            <button
              onClick={handleDownload}
              className="px-6 py-2 border border-stone-700 text-stone-300 hover:bg-stone-800 hover:border-stone-600 transition-colors text-sm"
            >
              Download .txt
            </button>
          </div>
        </div>
      </section>

      {/* Controls */}
      <section className="py-4 px-6 border-b border-stone-900 bg-stone-900/30">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search in file..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full max-w-md bg-stone-900 border border-stone-800 px-4 py-2 text-stone-200 placeholder-stone-600 focus:outline-none focus:border-stone-600"
            />
          </div>
          
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-stone-500 text-sm">
              <input
                type="checkbox"
                checked={showLines}
                onChange={(e) => setShowLines(e.target.checked)}
                className="accent-stone-500"
              />
              Show line numbers
            </label>
          </div>
        </div>
        
        {searchQuery && (
          <div className="max-w-7xl mx-auto mt-3">
            <p className="text-stone-500 text-sm">
              Found {displayContent.length} matches for &quot;{searchQuery}&quot;
            </p>
          </div>
        )}
      </section>

      {/* File Content */}
      <section className="py-8 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-stone-900/50 border border-stone-800 overflow-hidden">
            <pre className="p-6 overflow-x-auto text-sm leading-relaxed">
              <code>
                {displayContent.map(({ line, index }) => (
                  <div 
                    key={index} 
                    className="flex hover:bg-stone-800/50"
                    dir={/[\u0590-\u05FF]/.test(line) ? 'rtl' : 'ltr'}
                  >
                    {showLines && (
                      <span className="select-none text-stone-600 mr-4 min-w-[60px] text-right">
                        {index + 1}
                      </span>
                    )}
                    <span className={`flex-1 ${searchQuery && line.toLowerCase().includes(searchQuery.toLowerCase()) ? 'bg-amber-900/30' : ''}`}>
                      {searchQuery ? (
                        highlightMatches(line, searchQuery)
                      ) : (
                        <span className="text-stone-300">{line || ' '}</span>
                      )}
                    </span>
                  </div>
                ))}
              </code>
            </pre>
            
            {!searchQuery && visibleLines < totalLines && (
              <div className="p-4 border-t border-stone-800 text-center">
                <button
                  onClick={() => setVisibleLines(v => v + 500)}
                  className="text-stone-400 hover:text-stone-200 text-sm"
                >
                  Load more lines ({visibleLines.toLocaleString()} of {totalLines.toLocaleString()} shown)
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-stone-900">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <Link href="/explore/files" className="text-stone-500 hover:text-stone-300 text-sm">
            ← Back to all files
          </Link>
          <button
            onClick={handleDownload}
            className="text-stone-500 hover:text-stone-300 text-sm"
          >
            Download file
          </button>
        </div>
      </footer>
    </main>
  );
}

function highlightMatches(text: string, query: string): React.ReactNode[] {
  const parts = text.split(new RegExp(`(${escapeRegex(query)})`, 'gi'));
  
  return parts.map((part, i) => {
    if (part.toLowerCase() === query.toLowerCase()) {
      return <mark key={i} className="bg-amber-500 text-stone-900 px-0.5">{part}</mark>;
    }
    return <span key={i} className="text-stone-300">{part}</span>;
  });
}

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
