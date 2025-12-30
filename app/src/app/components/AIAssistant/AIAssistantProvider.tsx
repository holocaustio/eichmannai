'use client';

import React, { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react';
import { usePathname } from 'next/navigation';

export type AssistantContextType = 'opening-statement' | 'testimony' | 'verdict' | null;

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface AIAssistantContextValue {
  // State
  isOpen: boolean;
  contextType: AssistantContextType;
  contextContent: string;
  contextTitle: string;
  messages: Message[];
  isLoading: boolean;
  streamingContent: string;
  
  // Actions
  openAssistant: () => void;
  closeAssistant: () => void;
  toggleAssistant: () => void;
  setContext: (type: AssistantContextType, content: string, title: string) => void;
  clearContext: () => void;
  sendMessage: (message: string) => Promise<void>;
  clearMessages: () => void;
}

const AIAssistantContext = createContext<AIAssistantContextValue | null>(null);

export function useAIAssistant() {
  const context = useContext(AIAssistantContext);
  if (!context) {
    throw new Error('useAIAssistant must be used within AIAssistantProvider');
  }
  return context;
}

// System prompts for each context type
const SYSTEM_PROMPTS: Record<string, string> = {
  'opening-statement': `You are a historical guide assisting a reader who is viewing the opening statement of the Eichmann Trial.

Your role is to help the reader understand the structure, purpose, and content of the opening statement as it appears in the historical record.

The full opening statement transcript is available to you in context. You must rely only on this material and on well established procedural facts about criminal trials. Do not introduce information that does not appear in the transcript or is not directly implied by it.

IMPORTANT: Keep your responses concise and focused. Provide brief summaries, not lengthy essays. Aim for clear, digestible paragraphs that a reader can quickly understand.

Your responsibilities:
- Provide concise summaries of the opening statement
- Briefly explain the main claims presented by the prosecution
- Clarify the structure and flow of the argument
- Identify key themes that the prosecution introduces
- Explain legal or procedural terms when needed

Your constraints:
- Keep responses short and to the point
- Do not dramatize or emotionalize the material
- Do not speculate about intent beyond what is stated
- Do not moralize or judge
- Do not speak in the voice of any historical figure

When answering follow up questions, always:
- Give brief, focused answers
- Quote sparingly and only when essential
- Indicate uncertainty if the transcript does not provide a clear answer

Format your responses in clear markdown. Keep it concise.`,

  'testimony': `You are a historical guide assisting a reader who is viewing the testimony of a witness in the Eichmann Trial.

The full testimony of the witness is available to you in context. You must treat this testimony as a primary historical source.

IMPORTANT: Keep your responses concise and focused. Provide brief summaries, not lengthy essays. Aim for clear, digestible paragraphs that a reader can quickly understand.

Your role is to help the reader understand:
- Who the witness was in relation to the trial
- What the witness testified about
- Key factual information from the testimony

Your responsibilities:
- Provide concise summaries of the testimony
- Briefly identify key events, places, and people mentioned
- Clarify references that may be unclear to a general reader

Your constraints:
- Keep responses short and to the point
- Never speak in the first person as the witness
- Never add emotional interpretation or narrative embellishment
- Never speculate beyond what the witness states
- Do not rank, compare, or generalize suffering

When answering questions:
- Give brief, focused answers
- Quote sparingly and only when essential
- State clearly when the testimony does not address a question

Format your responses in clear markdown. Keep it concise.`,

  'verdict': `You are a historical guide assisting a reader who is viewing the verdict and judgment of the Eichmann Trial.

The full verdict text is available to you in context. You must rely exclusively on this document and on basic procedural knowledge of criminal verdicts.

IMPORTANT: Keep your responses concise and focused. Provide brief summaries, not lengthy essays. Aim for clear, digestible paragraphs that a reader can quickly understand.

Your role is to help the reader understand:
- What the court decided
- How the decision is structured
- What the judgment establishes

Your responsibilities:
- Provide concise summaries of the verdict
- Briefly explain the legal reasoning as presented by the court
- Clarify legal terminology when needed

Your constraints:
- Keep responses short and to the point
- Do not add moral commentary
- Do not speculate about broader historical consequences unless directly stated
- Do not reinterpret the judgment beyond its text
- Do not simplify the verdict to conclusions not supported by the document

When answering follow up questions:
- Give brief, focused answers
- Indicate when the document is silent on an issue

Format your responses in clear markdown. Keep it concise.`
};

const INITIAL_PROMPTS: Record<string, string> = {
  'opening-statement': 'Give me a brief summary of this opening statement in a few paragraphs.',
  'testimony': 'Give me a brief summary of this testimony: who is the witness and what are the key points?',
  'verdict': 'Give me a brief summary of this judgment and its key conclusions.'
};

interface AIAssistantProviderProps {
  children: ReactNode;
}

// Pages where the AI assistant should be available
const READING_PAGES = ['/opening-statement', '/verdict'];
const READING_PAGE_PREFIXES = ['/witnesses/'];

function isReadingPage(pathname: string): boolean {
  if (READING_PAGES.includes(pathname)) return true;
  if (READING_PAGE_PREFIXES.some(prefix => pathname.startsWith(prefix) && pathname !== '/witnesses')) return true;
  return false;
}

export function AIAssistantProvider({ children }: AIAssistantProviderProps) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [contextType, setContextType] = useState<AssistantContextType>(null);
  const [contextContent, setContextContent] = useState('');
  const [contextTitle, setContextTitle] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [hasAutoExplained, setHasAutoExplained] = useState(false);

  // Use refs to track current values for stable callbacks
  const contextTypeRef = useRef<AssistantContextType>(null);
  const contextContentRef = useRef('');
  const contextTitleRef = useRef('');
  const messagesRef = useRef<Message[]>([]);
  const isLoadingRef = useRef(false);
  const hasAutoExplainedRef = useRef(false);

  // Keep refs in sync
  contextTypeRef.current = contextType;
  contextContentRef.current = contextContent;
  contextTitleRef.current = contextTitle;
  messagesRef.current = messages;
  isLoadingRef.current = isLoading;
  hasAutoExplainedRef.current = hasAutoExplained;

  // Clear context when navigating to non-reading pages
  useEffect(() => {
    if (!isReadingPage(pathname)) {
      setContextType(null);
      setContextContent('');
      setContextTitle('');
      setMessages([]);
      setHasAutoExplained(false);
      setIsOpen(false);
      setStreamingContent('');
    }
  }, [pathname]);

  const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const sendMessage = useCallback(async (userMessage: string) => {
    const currentContextType = contextTypeRef.current;
    const currentContextContent = contextContentRef.current;
    const currentMessages = messagesRef.current;
    
    if (!currentContextType || !currentContextContent || isLoadingRef.current) return;

    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content: userMessage
    };

    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setStreamingContent('');

    try {
      const response = await fetch('/api/ai-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contextType: currentContextType,
          contextContent: currentContextContent,
          contextTitle,
          messages: [...currentMessages, userMsg].map(m => ({ role: m.role, content: m.content })),
          systemPrompt: SYSTEM_PROMPTS[currentContextType]
        })
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          fullContent += chunk;
          setStreamingContent(fullContent);
        }
      }

      const assistantMsg: Message = {
        id: generateId(),
        role: 'assistant',
        content: fullContent
      };

      setMessages(prev => [...prev, assistantMsg]);
      setStreamingContent('');
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMsg: Message = {
        id: generateId(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.'
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [contextTitle]);

  const openAssistant = useCallback(() => {
    setIsOpen(true);
    
    // Auto-explain on first open if we have context and haven't explained yet
    const currentContextType = contextTypeRef.current;
    const currentContextContent = contextContentRef.current;
    const currentMessages = messagesRef.current;
    const currentHasAutoExplained = hasAutoExplainedRef.current;
    
    if (currentContextType && currentContextContent && !currentHasAutoExplained && currentMessages.length === 0) {
      setHasAutoExplained(true);
      const initialPrompt = INITIAL_PROMPTS[currentContextType];
      if (initialPrompt) {
        // Slight delay to allow UI to render first
        setTimeout(() => {
          sendMessage(initialPrompt);
        }, 100);
      }
    }
  }, [sendMessage]);

  const closeAssistant = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggleAssistant = useCallback(() => {
    if (isOpen) {
      closeAssistant();
    } else {
      openAssistant();
    }
  }, [isOpen, openAssistant, closeAssistant]);

  const setContext = useCallback((type: AssistantContextType, content: string, title: string) => {
    // Check if context actually changed (by type or title)
    const contextChanged = type !== contextTypeRef.current || title !== contextTitleRef.current;
    
    if (contextChanged) {
      // Close assistant and reset when navigating to different content
      setIsOpen(false);
      setContextType(type);
      setContextContent(content);
      setContextTitle(title);
      setMessages([]);
      setHasAutoExplained(false);
      setStreamingContent('');
    } else if (content !== contextContentRef.current) {
      // Just update content if only content changed (same page refresh)
      setContextContent(content);
    }
  }, []);

  const clearContext = useCallback(() => {
    setContextType(null);
    setContextContent('');
    setContextTitle('');
    setMessages([]);
    setHasAutoExplained(false);
    setIsOpen(false);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setHasAutoExplained(false);
  }, []);

  const value: AIAssistantContextValue = {
    isOpen,
    contextType,
    contextContent,
    contextTitle,
    messages,
    isLoading,
    streamingContent,
    openAssistant,
    closeAssistant,
    toggleAssistant,
    setContext,
    clearContext,
    sendMessage,
    clearMessages
  };

  return (
    <AIAssistantContext.Provider value={value}>
      {children}
    </AIAssistantContext.Provider>
  );
}
