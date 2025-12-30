'use client';

import React from 'react';
import { useAIAssistant } from './AIAssistantProvider';
import { AIAssistantChat } from './AIAssistantChat';

// Context-specific labels and descriptions
const BUBBLE_LABELS: Record<string, { title: string; subtitle: string }> = {
  'opening-statement': {
    title: 'AI Guide',
    subtitle: 'Get a summary of the opening statement'
  },
  'testimony': {
    title: 'AI Guide', 
    subtitle: 'Understand this testimony'
  },
  'verdict': {
    title: 'AI Guide',
    subtitle: 'Explain the judgment'
  }
};

export function AIAssistantBubble() {
  const { isOpen, contextType, toggleAssistant } = useAIAssistant();

  // Only show on relevant pages
  if (!contextType) {
    return null;
  }

  const labels = BUBBLE_LABELS[contextType] || { title: 'AI Guide', subtitle: 'Get help understanding' };

  return (
    <>
      {/* Backdrop for mobile */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={toggleAssistant}
        />
      )}

      {/* Chat Panel - Full height side panel */}
      {isOpen && (
        <div className="fixed z-50 
          inset-0 h-full w-full
          md:inset-y-0 md:right-0 md:left-auto md:w-[480px]
          shadow-2xl shadow-black/50 border-l border-stone-800
        ">
          <AIAssistantChat />
        </div>
      )}

      {/* Bubble Button - Pill shaped with text */}
      {!isOpen && (
        <button
          onClick={toggleAssistant}
          className="fixed bottom-6 right-6 z-50 
            flex items-center gap-3
            bg-amber-600 hover:bg-amber-500 
            rounded-full shadow-lg shadow-black/30
            pl-4 pr-5 py-3
            transition-all duration-200 hover:scale-105
            group"
          aria-label="Open reading assistant"
        >
          {/* Sparkle/AI icon */}
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
          
          {/* Text labels */}
          <div className="text-left">
            <p className="text-white font-medium text-sm leading-tight">{labels.title}</p>
            <p className="text-amber-100/80 text-xs leading-tight">{labels.subtitle}</p>
          </div>
        </button>
      )}
    </>
  );
}
