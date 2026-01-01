'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';

interface EntityLinkProps {
  entityId: string;
  entityType: string;
  children: React.ReactNode;
}

interface Entity {
  id: string;
  name: string;
  englishName?: string;
  hebrewName?: string;
  type: string;
  role?: string;
  sessions?: number[];
  isWitness?: boolean;
  image?: string;
}

// Entity type configuration for colors and icons
const entityTypeConfig: Record<string, { icon: string; label: string }> = {
  PERSON: { icon: '👤', label: 'Person' },
  LOCATION: { icon: '📍', label: 'Location' },
  ORGANIZATION: { icon: '🏛️', label: 'Organization' },
  EVENT: { icon: '📅', label: 'Event' },
  DATE: { icon: '📆', label: 'Date' },
};

// Cache for entity data
const entityCache: Map<string, Entity | null> = new Map();

export default function EntityLink({ entityId, entityType, children }: EntityLinkProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [entity, setEntity] = useState<Entity | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<'above' | 'below'>('above');
  const linkRef = useRef<HTMLSpanElement>(null);

  // Load entity data when hovered
  useEffect(() => {
    if (!isHovered) return;
    
    // Check cache first
    if (entityCache.has(entityId)) {
      setEntity(entityCache.get(entityId) || null);
      return;
    }

    // Load entities data
    async function loadEntity() {
      try {
        const res = await fetch('/data/entities-consolidated.json');
        const data = await res.json();
        const found = data.nodes.find((n: Entity) => n.id === entityId);
        entityCache.set(entityId, found || null);
        setEntity(found || null);
      } catch (error) {
        console.error('Failed to load entity:', error);
        entityCache.set(entityId, null);
      }
    }

    loadEntity();
  }, [isHovered, entityId]);

  // Calculate tooltip position
  useEffect(() => {
    if (!isHovered || !linkRef.current) return;

    const rect = linkRef.current.getBoundingClientRect();
    const spaceAbove = rect.top;
    
    // If less than 200px above, show below
    setTooltipPosition(spaceAbove < 200 ? 'below' : 'above');
  }, [isHovered]);

  const config = entityTypeConfig[entityType] || { icon: '•', label: entityType };

  return (
    <span
      ref={linkRef}
      className="relative inline"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Highlighted text with dotted underline */}
      <Link
        href={`/explore/${encodeURIComponent(entityId)}`}
        className="cursor-pointer transition-colors duration-150"
        style={{
          textDecoration: 'underline',
          textDecorationStyle: 'dotted',
          textDecorationColor: '#e17100',
          textUnderlineOffset: '3px',
          textDecorationThickness: '2px',
          color: 'inherit',
        }}
      >
        {children}
      </Link>

      {/* Tooltip - using only inline/span elements to avoid hydration errors inside <p> */}
      {isHovered && (
        <span
          className={`absolute z-50 ${
            tooltipPosition === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'
          } left-1/2 -translate-x-1/2 pointer-events-none`}
          style={{ minWidth: '220px' }}
        >
          <span className="block bg-stone-900 border border-stone-700 rounded-lg shadow-xl p-4 text-left">
            {/* Arrow */}
            <span
              className={`absolute left-1/2 -translate-x-1/2 w-3 h-3 bg-stone-900 border-stone-700 transform rotate-45 ${
                tooltipPosition === 'above'
                  ? 'bottom-[-6px] border-r border-b'
                  : 'top-[-6px] border-l border-t'
              }`}
            />

            {/* Content */}
            <span className="block relative">
              {/* Type badge */}
              <span className="flex items-center gap-2 mb-2">
                <span className="text-base">{config.icon}</span>
                <span className="text-xs text-stone-500 uppercase tracking-wider">
                  {config.label}
                </span>
              </span>

              {/* Entity name */}
              <span className="block text-stone-100 font-medium text-sm mb-1">
                {entity?.name || children}
              </span>
              
              {/* Hebrew name */}
              {entity?.hebrewName && (
                <span className="block text-stone-400 text-sm mb-2" dir="rtl">
                  {entity.hebrewName}
                </span>
              )}

              {/* Role if available */}
              {entity?.role && (
                <span className="block text-stone-500 text-xs mb-2">
                  {entity.role}
                </span>
              )}

              {/* Sessions if available */}
              {entity?.sessions && entity.sessions.length > 0 && (
                <span className="block text-stone-500 text-xs mb-3">
                  Sessions: {entity.sessions.slice(0, 5).join(', ')}
                  {entity.sessions.length > 5 ? '...' : ''}
                </span>
              )}

              {/* Click hint */}
              <span className="block text-amber-500 text-xs font-medium">
                Click to explore →
              </span>
            </span>
          </span>
        </span>
      )}
    </span>
  );
}
