'use client';

import React, { useRef, useEffect, useState } from 'react';
import { useAIAssistant } from './AIAssistantProvider';

// Simple markdown parser for chat messages
function parseMarkdown(text: string): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  const lines = text.split('\n');
  let inCodeBlock = false;
  let codeContent = '';
  let codeLanguage = '';
  let listItems: string[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const flushList = () => {
    if (listItems.length > 0 && listType) {
      const ListTag = listType;
      elements.push(
        <ListTag key={`list-${elements.length}`} className={listType === 'ul' ? 'list-disc list-inside space-y-1 my-2' : 'list-decimal list-inside space-y-1 my-2'}>
          {listItems.map((item, i) => (
            <li key={i} className="text-stone-300">{parseInline(item)}</li>
          ))}
        </ListTag>
      );
      listItems = [];
      listType = null;
    }
  };

  const parseInline = (text: string): React.ReactNode => {
    // Bold
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong class="text-stone-200 font-semibold">$1</strong>');
    // Italic
    text = text.replace(/\*(.+?)\*/g, '<em class="italic">$1</em>');
    // Code inline
    text = text.replace(/`([^`]+)`/g, '<code class="bg-stone-800 px-1.5 py-0.5 rounded text-amber-400 text-sm">$1</code>');
    
    return <span dangerouslySetInnerHTML={{ __html: text }} />;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Code blocks
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        flushList();
        inCodeBlock = true;
        codeLanguage = line.slice(3).trim();
        codeContent = '';
      } else {
        elements.push(
          <pre key={`code-${i}`} className="bg-stone-900 border border-stone-700 rounded p-3 my-2 overflow-x-auto">
            <code className="text-sm text-stone-300">{codeContent}</code>
          </pre>
        );
        inCodeBlock = false;
        codeContent = '';
      }
      continue;
    }
    
    if (inCodeBlock) {
      codeContent += (codeContent ? '\n' : '') + line;
      continue;
    }

    // Headers
    if (line.startsWith('### ')) {
      flushList();
      elements.push(
        <h4 key={`h4-${i}`} className="text-stone-200 font-semibold mt-4 mb-2 text-sm">
          {parseInline(line.slice(4))}
        </h4>
      );
      continue;
    }
    if (line.startsWith('## ')) {
      flushList();
      elements.push(
        <h3 key={`h3-${i}`} className="text-stone-100 font-semibold mt-4 mb-2">
          {parseInline(line.slice(3))}
        </h3>
      );
      continue;
    }
    if (line.startsWith('# ')) {
      flushList();
      elements.push(
        <h2 key={`h2-${i}`} className="text-stone-100 font-bold mt-4 mb-3 text-lg">
          {parseInline(line.slice(2))}
        </h2>
      );
      continue;
    }

    // Horizontal rule
    if (line.trim() === '---' || line.trim() === '***') {
      flushList();
      elements.push(<hr key={`hr-${i}`} className="border-stone-700 my-4" />);
      continue;
    }

    // Unordered list
    if (line.match(/^[\-\*]\s+/)) {
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
      }
      listItems.push(line.replace(/^[\-\*]\s+/, ''));
      continue;
    }

    // Ordered list
    if (line.match(/^\d+\.\s+/)) {
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
      }
      listItems.push(line.replace(/^\d+\.\s+/, ''));
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      flushList();
      elements.push(
        <blockquote key={`quote-${i}`} className="border-l-2 border-amber-600 pl-3 my-2 text-stone-400 italic">
          {parseInline(line.slice(2))}
        </blockquote>
      );
      continue;
    }

    // Empty line
    if (!line.trim()) {
      flushList();
      continue;
    }

    // Regular paragraph
    flushList();
    elements.push(
      <p key={`p-${i}`} className="text-stone-300 my-2 leading-relaxed">
        {parseInline(line)}
      </p>
    );
  }

  flushList();

  return elements;
}

export function AIAssistantChat() {
  const {
    contextType,
    contextTitle,
    messages,
    isLoading,
    streamingContent,
    sendMessage,
    clearMessages,
    closeAssistant
  } = useAIAssistant();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    
    sendMessage(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const getContextLabel = () => {
    switch (contextType) {
      case 'opening-statement':
        return 'Opening Statement';
      case 'testimony':
        return contextTitle || 'Witness Testimony';
      case 'verdict':
        return 'The Judgment';
      default:
        return 'Reading Assistant';
    }
  };

  return (
    <div className="flex flex-col h-full bg-stone-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-stone-800 border-b border-stone-700">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-full bg-amber-600/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-stone-500 uppercase tracking-wide">Reading</p>
            <p className="text-stone-200 text-sm font-medium truncate">{getContextLabel()}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              className="p-2 text-stone-500 hover:text-stone-300 transition-colors"
              title="Clear conversation"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
          <button
            onClick={closeAssistant}
            className="p-2 text-stone-500 hover:text-stone-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isLoading && (
          <div className="text-center py-8">
            <div className="w-12 h-12 rounded-full bg-stone-800 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-stone-400 text-sm">Loading summary...</p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                message.role === 'user'
                  ? 'bg-amber-600 text-white rounded-br-md'
                  : 'bg-stone-800 text-stone-200 rounded-bl-md'
              }`}
            >
              {message.role === 'user' ? (
                <p className="text-sm">{message.content}</p>
              ) : (
                <div className="text-sm prose-sm">{parseMarkdown(message.content)}</div>
              )}
            </div>
            {/* Follow-up questions */}
            {message.role === 'assistant' && message.followUpQuestions && message.followUpQuestions.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2 max-w-[85%]">
                {message.followUpQuestions.map((question, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      if (!isLoading) {
                        sendMessage(question);
                      }
                    }}
                    disabled={isLoading}
                    className="text-xs px-3 py-1.5 rounded-full bg-stone-800 border border-stone-700 text-stone-400 hover:text-amber-400 hover:border-amber-600/50 transition-all duration-200 text-left disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {question}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Streaming message */}
        {isLoading && streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-bl-md px-4 py-3 bg-stone-800 text-stone-200">
              <div className="text-sm prose-sm">{parseMarkdown(streamingContent)}</div>
            </div>
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && !streamingContent && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-stone-800">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-stone-500 text-sm">Thinking...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-stone-700 bg-stone-800/50">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about what you're reading..."
            className="flex-1 bg-stone-800 border border-stone-700 rounded-xl px-4 py-3 text-stone-200 text-sm placeholder-stone-500 focus:outline-none focus:border-amber-600 resize-none"
            rows={1}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="px-4 py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-stone-700 disabled:text-stone-500 text-white rounded-xl transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-stone-600 mt-2 text-center">
          Press Enter to send • Shift+Enter for new line
        </p>
      </form>
    </div>
  );
}
