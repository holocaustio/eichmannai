'use client';

import React from 'react';
import EntityLink from './EntityLink';

/**
 * Parse text containing entity markers and return React elements.
 * 
 * Marker format: [[TYPE:entity-id|Display Text]]
 * Example: [[PERSON:person-adolf-eichmann|Adolf Eichmann]]
 * 
 * @param text - The text containing entity markers
 * @param key - Optional key prefix for React elements
 * @returns Array of React elements (strings and EntityLink components)
 */
export function parseEntityMarkers(text: string, key: string = ''): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  
  // Regex to match entity markers: [[TYPE:id|text]]
  const markerRegex = /\[\[([A-Z_]+):([^\]|]+)\|([^\]]+)\]\]/g;
  
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let matchIndex = 0;
  
  while ((match = markerRegex.exec(text)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index));
    }
    
    // Extract parts
    const [fullMatch, entityType, entityId, displayText] = match;
    
    // Add EntityLink component
    result.push(
      <EntityLink
        key={`${key}-entity-${matchIndex}`}
        entityId={entityId}
        entityType={entityType}
      >
        {displayText}
      </EntityLink>
    );
    
    lastIndex = match.index + fullMatch.length;
    matchIndex++;
  }
  
  // Add remaining text after last match
  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }
  
  return result;
}

/**
 * Component wrapper for parsing entity markers in text content.
 */
interface EntityTextProps {
  children: string;
  className?: string;
}

export function EntityText({ children, className }: EntityTextProps) {
  const parsed = parseEntityMarkers(children);
  
  return (
    <span className={className}>
      {parsed}
    </span>
  );
}
