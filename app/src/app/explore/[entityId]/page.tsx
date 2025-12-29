'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Entity {
  id: string;
  name: string;
  englishName?: string;
  type: string;
  variants?: string[];
  mentions: number;
  sessions?: number[];
  isWitness?: boolean;
  hebrewName?: string;
}

interface Edge {
  id: string;
  source: string;
  target: string;
  type: string;
}

interface EntitiesData {
  nodes: Entity[];
  edges: Edge[];
}

export default function EntityDetailPage() {
  const params = useParams();
  const entityId = decodeURIComponent(params.entityId as string);

  const [entity, setEntity] = useState<Entity | null>(null);
  const [linkedEntities, setLinkedEntities] = useState<Entity[]>([]);
  const [linkedWitnesses, setLinkedWitnesses] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        // Load consolidated entities file
        const consolidatedRes = await fetch('/data/entities-consolidated.json');
        const data: EntitiesData = await consolidatedRes.json();

        // Find the entity
        let found = data.nodes.find(n => 
          n.id === entityId || 
          n.name === entityId ||
          n.name.toLowerCase() === entityId.toLowerCase()
        );

        // If it's a witness, redirect to witness page
        if (found && found.isWitness) {
          window.location.href = `/witnesses/${encodeURIComponent(found.name)}`;
          return;
        }

        if (!found) {
          setError('Entity not found');
          setLoading(false);
          return;
        }

        setEntity(found);

        // Find linked entities and witnesses from edges
        const linkedEntityIds = new Set<string>();
        
        data.edges?.forEach((edge: Edge) => {
          if (edge.source === found.id || edge.source === found.name) {
            linkedEntityIds.add(edge.target);
          } else if (edge.target === found.id || edge.target === found.name) {
            linkedEntityIds.add(edge.source);
          }
        });

        // Separate into entities and witnesses
        const linked: Entity[] = [];
        const witnesses: Entity[] = [];
        
        data.nodes.forEach(n => {
          if (linkedEntityIds.has(n.id)) {
            if (n.isWitness) {
              witnesses.push(n);
            } else {
              linked.push(n);
            }
          }
        });

        setLinkedEntities(linked);
        setLinkedWitnesses(witnesses);
      } catch (err) {
        setError('Failed to load data');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [entityId]);

  const typeLabels: Record<string, { label: string; icon: string; color: string }> = {
    'LOCATION': { label: 'Location', icon: '📍', color: 'text-blue-400' },
    'ORGANIZATION': { label: 'Organization', icon: '🏛️', color: 'text-purple-400' },
    'PERSON': { label: 'Person', icon: '👤', color: 'text-amber-400' },
    'EVENT': { label: 'Event', icon: '📅', color: 'text-emerald-400' },
    'DATE': { label: 'Date', icon: '📆', color: 'text-rose-400' },
  };

  // Group linked entities by type
  const groupedLinked = linkedEntities.reduce((acc, e) => {
    const type = e.type || 'OTHER';
    if (!acc[type]) acc[type] = [];
    acc[type].push(e);
    return acc;
  }, {} as Record<string, Entity[]>);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-2 border-stone-600 border-t-stone-300 rounded-full animate-spin mb-4" />
          <p className="text-stone-500">Loading entity...</p>
        </div>
      </main>
    );
  }

  if (error || !entity) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl mb-4">Entity Not Found</h1>
          <p className="text-stone-500 mb-6">Could not find entity: {entityId}</p>
          <Link href="/explore" className="text-stone-400 hover:text-stone-200">
            ← Back to Explore
          </Link>
        </div>
      </main>
    );
  }

  const typeInfo = typeLabels[entity.type] || { label: entity.type, icon: '•', color: 'text-stone-400' };

  return (
    <main className="min-h-screen">
      {/* Entity Header */}
      <section className="py-12 px-6 border-b border-stone-900">
        <div className="max-w-7xl mx-auto">
          <Link href="/explore" className="text-stone-500 hover:text-stone-300 text-sm mb-6 inline-block">
            ← Back to Explore
          </Link>
          
          <div className="flex items-center gap-3 mb-4">
            <span className={`text-2xl ${typeInfo.color}`}>{typeInfo.icon}</span>
            <span className="text-stone-500 uppercase tracking-wider text-sm">{typeInfo.label}</span>
          </div>
          
          <h1 className="font-serif text-4xl md:text-5xl font-light mb-4">
            {entity.name}
          </h1>
          
          {entity.variants && entity.variants.length > 0 && (
            <div className="mb-6">
              <p className="text-stone-500 text-sm mb-2">Also known as:</p>
              <div className="flex flex-wrap gap-2">
                {entity.variants.map((variant, i) => (
                  <span 
                    key={i}
                    className="px-3 py-1 bg-stone-900 border border-stone-800 text-stone-400 text-sm"
                    dir={/[\u0590-\u05FF]/.test(variant) ? 'rtl' : 'ltr'}
                  >
                    {variant}
                  </span>
                ))}
              </div>
            </div>
          )}
          
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="border border-stone-800 px-3 py-1 text-stone-400">
              {entity.mentions} mentions in trial
            </span>
            {entity.sessions && entity.sessions.length > 0 && (
              <span className="border border-stone-800 px-3 py-1 text-stone-400">
                {entity.sessions.length} sessions
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Sessions */}
      {entity.sessions && entity.sessions.length > 0 && (
        <section className="py-8 px-6 border-b border-stone-900 bg-stone-900/30">
          <div className="max-w-7xl mx-auto">
            <h3 className="text-sm text-stone-500 uppercase tracking-wider mb-4">
              Mentioned in Sessions
            </h3>
            <div className="flex flex-wrap gap-2">
              {entity.sessions.map((session) => (
                <span 
                  key={session}
                  className="px-3 py-1 border border-stone-700 text-stone-400 text-sm"
                >
                  Session {session}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Linked Witnesses */}
      {linkedWitnesses.length > 0 && (
        <section className="py-12 px-6 border-b border-stone-900">
          <div className="max-w-7xl mx-auto">
            <h3 className="font-serif text-2xl mb-6">
              Witnesses who mentioned this {typeInfo.label.toLowerCase()}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {linkedWitnesses.map((witness) => (
                <Link
                  key={witness.id}
                  href={`/witnesses/${encodeURIComponent(witness.name)}`}
                  className="block border border-stone-800 hover:border-stone-700 bg-stone-900/30 hover:bg-stone-900/50 transition-all p-4"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-amber-400">👤</span>
                    <span className="text-xs text-stone-600 uppercase">Witness</span>
                  </div>
                  <p className="text-stone-200 font-medium">{witness.name}</p>
                  {witness.hebrewName && (
                    <p className="text-stone-500 text-sm" dir="rtl">{witness.hebrewName}</p>
                  )}
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Linked Entities */}
      {linkedEntities.length > 0 && (
        <section className="py-12 px-6 border-b border-stone-900 bg-stone-900/20">
          <div className="max-w-7xl mx-auto">
            <h3 className="font-serif text-2xl mb-6">
              Related Entities
            </h3>
            
            {Object.entries(groupedLinked).map(([type, entities]) => {
              const info = typeLabels[type] || { label: type, icon: '•', color: 'text-stone-400' };
              return (
                <div key={type} className="mb-8 last:mb-0">
                  <div className="flex items-center gap-2 mb-4">
                    <span className={info.color}>{info.icon}</span>
                    <span className="text-stone-500 text-sm uppercase tracking-wider">
                      {info.label}s
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {entities.map((e) => (
                      <Link
                        key={e.id}
                        href={`/explore/${encodeURIComponent(e.id)}`}
                        className="px-4 py-2 border border-stone-700 bg-stone-800/50 text-stone-300 hover:border-stone-600 hover:bg-stone-800 transition-colors"
                      >
                        {e.name}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* No connections message */}
      {linkedEntities.length === 0 && linkedWitnesses.length === 0 && (
        <section className="py-12 px-6">
          <div className="max-w-7xl mx-auto text-center">
            <p className="text-stone-500">
              No direct connections found for this entity.
            </p>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-stone-900">
        <div className="max-w-7xl mx-auto text-center">
          <Link href="/explore" className="text-stone-500 hover:text-stone-300 text-sm">
            ← Explore more entities
          </Link>
        </div>
      </footer>
    </main>
  );
}
