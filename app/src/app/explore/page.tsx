'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import Link from 'next/link';

interface Entity {
  id: string;
  name: string;
  englishName?: string;
  hebrewName?: string;
  type: string;
  variants?: string[];
  mentions: number;
  sessions?: number[];
  isWitness?: boolean;
  // SESSION entity fields
  number?: number;
  date?: string;
  day?: string;
  phase?: string;
}

interface Edge {
  id: string;
  source: string;
  target: string;
  type: string;
}

interface GraphData {
  nodes: Entity[];
  edges: Edge[];
}

interface Session {
  number: number;
  witnesses: string[];
  hebrewLabel?: string;
}

interface TimelineSession {
  number: number;
  date: string;
  day: string;
  hebrewDate: string;
  topics: string[];
  witnesses: string[];
  milestone?: string;
}

interface TimelinePhase {
  id: string;
  name: string;
  hebrewName: string;
  startDate: string;
  endDate: string;
  sessions: number[];
  description: string;
}

interface TimelineMilestone {
  id: string;
  type: string;
  date: string;
  hebrewDate: string;
  title: string;
  hebrewTitle: string;
  description: string;
  sessions: number[];
}

interface TimelineData {
  metadata: {
    totalSessions: number;
    trialDuration: {
      start: string;
      testimoniesEnd: string;
      verdictDate: string;
      sentencingDate: string;
    };
  };
  phases: TimelinePhase[];
  sessions: TimelineSession[];
  milestones: TimelineMilestone[];
}

interface EntitiesData {
  metadata: {
    totalNodes: number;
    totalEdges: number;
    typeCounts?: {
      SESSION?: number;
      LOCATION?: number;
      ORGANIZATION?: number;
      PERSON?: number;
      EVENT?: number;
      DATE?: number;
    };
    locationsFound?: number;
    organizationsFound?: number;
  };
  nodes: Entity[];
  edges: Edge[];
  sessions: Session[];
}

type ViewMode = 'entities' | 'graph' | 'files' | 'timeline';

export default function ExplorePage() {
  const [data, setData] = useState<EntitiesData | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [timelineData, setTimelineData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('entities');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        // Load consolidated entities file
        const consolidatedRes = await fetch('/data/entities-consolidated.json');
        const consolidated: GraphData & { metadata: EntitiesData['metadata'] } = await consolidatedRes.json();
        
        // Transform witnesses to have type 'WITNESS' for proper filtering
        const transformedNodes = consolidated.nodes.map(node => ({
          ...node,
          type: node.isWitness ? 'WITNESS' : node.type
        }));
        
        // Filter edges for graph - exclude CO_OCCURRENCE (too many, 35k+)
        // Keep only meaningful relationship edges
        const graphEdges = consolidated.edges.filter(e => 
          e.type !== 'CO_OCCURRENCE'
        );
        
        setData({
          metadata: consolidated.metadata,
          nodes: transformedNodes,
          edges: consolidated.edges, // Keep all edges for data
          sessions: []
        });
        
        setGraphData({
          nodes: transformedNodes,
          edges: graphEdges // Use filtered edges for graph
        });
        
        // Build timeline data from SESSION entities
        const sessionEntities = consolidated.nodes.filter(n => n.type === 'SESSION' && n.date);
        const witnesses = consolidated.nodes.filter(n => n.isWitness);
        
        // Build session data with witnesses linked from entity data
        const timelineSessions: TimelineSession[] = sessionEntities
          .sort((a, b) => (a.number || 0) - (b.number || 0))
          .map(session => {
            // Find witnesses who testified in this session
            const sessionWitnesses = witnesses
              .filter(w => w.sessions?.includes(session.number || 0))
              .map(w => w.name);
            
            return {
              number: session.number || 0,
              date: session.date || '',
              day: session.day || '',
              hebrewDate: '', // Could be computed if needed
              topics: [],
              witnesses: sessionWitnesses,
              milestone: session.number === 1 ? 'Trial Opens' : 
                         session.number === 6 ? 'Opening Statement begins' :
                         session.number === 100 ? 'Defense case begins' :
                         session.number === 112 ? 'Closing arguments begin' :
                         session.number === 121 ? 'Testimony phase ends' : undefined
            };
          });
        
        // Build phases
        const phases: TimelinePhase[] = [
          { id: 'trial-opening', name: 'Trial Opening', hebrewName: 'פתיחת המשפט', startDate: '1961-04-11', endDate: '1961-04-16', sessions: [1,2,3,4,5], description: '' },
          { id: 'opening-statement', name: 'Opening Statement', hebrewName: 'נאום הפתיחה', startDate: '1961-04-17', endDate: '1961-04-18', sessions: [6,7,8], description: '' },
          { id: 'prosecution', name: 'Prosecution Witnesses', hebrewName: 'עדי התביעה', startDate: '1961-04-19', endDate: '1961-08-03', sessions: Array.from({length: 91}, (_, i) => i + 9), description: '' },
          { id: 'defense', name: 'Defense Case', hebrewName: 'פרשת ההגנה', startDate: '1961-08-04', endDate: '1961-08-17', sessions: [100,101,102,103,104,105,106,107,108,109,110,111], description: '' },
          { id: 'closing', name: 'Closing Arguments', hebrewName: 'סיכומים', startDate: '1961-08-18', endDate: '1961-08-30', sessions: [112,113,114,115,116,117,118,119,120,121], description: '' },
          { id: 'verdict', name: 'Verdict', hebrewName: 'הכרעת הדין', startDate: '1961-12-11', endDate: '1961-12-12', sessions: [], description: '' },
          { id: 'sentencing', name: 'Sentencing', hebrewName: 'גזר הדין', startDate: '1961-12-15', endDate: '1961-12-15', sessions: [], description: '' },
        ];
        
        // Build milestones
        const milestones: TimelineMilestone[] = [
          { id: 'trial-begins', type: 'opening', date: '1961-04-11', hebrewDate: '', title: 'Trial Opens', hebrewTitle: '', description: '', sessions: [1] },
          { id: 'opening-statement', type: 'opening-statement', date: '1961-04-17', hebrewDate: '', title: 'Opening Statement', hebrewTitle: '', description: '', sessions: [6,7,8] },
          { id: 'defense-begins', type: 'defense', date: '1961-08-04', hebrewDate: '', title: 'Defense Case Opens', hebrewTitle: '', description: '', sessions: [100] },
          { id: 'verdict', type: 'verdict', date: '1961-12-11', hebrewDate: '', title: 'Verdict Delivered', hebrewTitle: '', description: '', sessions: [] },
          { id: 'sentencing', type: 'sentencing', date: '1961-12-15', hebrewDate: '', title: 'Death Sentence', hebrewTitle: '', description: '', sessions: [] },
        ];
        
        setTimelineData({
          metadata: {
            totalSessions: sessionEntities.length,
            trialDuration: {
              start: '1961-04-11',
              testimoniesEnd: '1961-08-30',
              verdictDate: '1961-12-11',
              sentencingDate: '1961-12-15'
            }
          },
          phases,
          sessions: timelineSessions,
          milestones
        });
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    }
    
    loadData();
  }, []);

  // Combined entities including witnesses
  const allEntities = graphData?.nodes || [];
  
  // Group by type
  const groupedEntities = allEntities.reduce((acc, entity) => {
    const type = entity.type || 'OTHER';
    if (!acc[type]) acc[type] = [];
    acc[type].push(entity);
    return acc;
  }, {} as Record<string, Entity[]>);

  // Filter entities
  const filteredEntities = selectedType 
    ? (groupedEntities[selectedType] || [])
    : allEntities;

  const searchedEntities = filteredEntities.filter(e => 
    !searchQuery || 
    e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    e.englishName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Get unique source files
  const sourceFiles = [...new Set(
    data?.nodes
      .filter(n => n.isWitness)
      .flatMap(n => {
        // Extract file info from the witness
        const sessions = n.sessions || [];
        return sessions.map(s => `Session ${s}`);
      }) || []
  )].sort((a, b) => {
    const numA = parseInt(a.replace('Session ', ''));
    const numB = parseInt(b.replace('Session ', ''));
    return numA - numB;
  });

  const typeLabels: Record<string, { label: string; icon: string; color: string }> = {
    'SESSION': { label: 'Sessions', icon: '⚖️', color: 'text-yellow-400' },
    'LOCATION': { label: 'Locations', icon: '📍', color: 'text-blue-400' },
    'ORGANIZATION': { label: 'Organizations', icon: '🏛️', color: 'text-purple-400' },
    'PERSON': { label: 'People', icon: '👤', color: 'text-amber-400' },
    'EVENT': { label: 'Events', icon: '📅', color: 'text-emerald-400' },
    'DATE': { label: 'Dates', icon: '📆', color: 'text-rose-400' },
    'WITNESS': { label: 'Witnesses', icon: '🎤', color: 'text-cyan-400' },
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-stone-500">Loading data...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      {/* Hero */}
      <section className="py-16 px-6 border-b border-stone-900">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-stone-600 text-xs tracking-[0.3em] uppercase mb-4">Explore</p>
          <h1 className="font-serif text-4xl md:text-5xl font-light mb-6">
            Explore the Trial
          </h1>
          <p className="text-stone-400 text-lg max-w-2xl mx-auto">
            {graphData?.nodes.length || 0} entities, {graphData?.edges.length || 0} connections, 
            {' '}{data?.metadata.typeCounts?.SESSION || 0} court sessions.
          </p>
        </div>
      </section>

      {/* View Mode Tabs */}
      <section className="border-b border-stone-900 bg-stone-900/30">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex gap-0">
            <button
              onClick={() => setViewMode('entities')}
              className={`px-6 py-4 text-sm tracking-wide border-b-2 transition-colors ${
                viewMode === 'entities' 
                  ? 'border-stone-300 text-stone-200' 
                  : 'border-transparent text-stone-500 hover:text-stone-300'
              }`}
            >
              Entities
            </button>
            <button
              onClick={() => setViewMode('graph')}
              className={`px-6 py-4 text-sm tracking-wide border-b-2 transition-colors ${
                viewMode === 'graph' 
                  ? 'border-stone-300 text-stone-200' 
                  : 'border-transparent text-stone-500 hover:text-stone-300'
              }`}
            >
              Graph View
            </button>
            <button
              onClick={() => setViewMode('files')}
              className={`px-6 py-4 text-sm tracking-wide border-b-2 transition-colors ${
                viewMode === 'files' 
                  ? 'border-stone-300 text-stone-200' 
                  : 'border-transparent text-stone-500 hover:text-stone-300'
              }`}
            >
              Source Files
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={`px-6 py-4 text-sm tracking-wide border-b-2 transition-colors ${
                viewMode === 'timeline' 
                  ? 'border-stone-300 text-stone-200' 
                  : 'border-transparent text-stone-500 hover:text-stone-300'
              }`}
            >
              📅 Timeline
            </button>
          </div>
        </div>
      </section>

      {/* Entities View */}
      {viewMode === 'entities' && (
        <>
          {/* Type Filter */}
          <section className="py-6 px-6 border-b border-stone-900">
            <div className="max-w-7xl mx-auto">
              <div className="flex flex-wrap gap-3 mb-4">
                <button
                  onClick={() => setSelectedType(null)}
                  className={`px-4 py-2 text-sm border transition-colors ${
                    !selectedType 
                      ? 'border-stone-500 text-stone-200 bg-stone-800' 
                      : 'border-stone-800 text-stone-500 hover:border-stone-700'
                  }`}
                >
                  All ({allEntities.length})
                </button>
                {Object.entries(groupedEntities).map(([type, entities]) => {
                  const typeInfo = typeLabels[type] || { label: type, icon: '•', color: 'text-stone-400' };
                  return (
                    <button
                      key={type}
                      onClick={() => setSelectedType(type)}
                      className={`px-4 py-2 text-sm border transition-colors flex items-center gap-2 ${
                        selectedType === type 
                          ? 'border-stone-500 text-stone-200 bg-stone-800' 
                          : 'border-stone-800 text-stone-500 hover:border-stone-700'
                      }`}
                    >
                      <span>{typeInfo.icon}</span>
                      {typeInfo.label} ({entities.length})
                    </button>
                  );
                })}
              </div>
              
              <input
                type="text"
                placeholder="Search entities..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full max-w-md bg-stone-900 border border-stone-800 px-4 py-2 text-stone-200 placeholder-stone-600 focus:outline-none focus:border-stone-600"
              />
            </div>
          </section>

          {/* Entities Grid */}
          <section className="py-12 px-6">
            <div className="max-w-7xl mx-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {searchedEntities.map((entity, idx) => {
                  const typeInfo = typeLabels[entity.type] || { label: entity.type, icon: '•', color: 'text-stone-400' };
                  // Witnesses should link to their witness page, not entity page
                  const href = entity.type === 'WITNESS' || entity.isWitness
                    ? `/witnesses/${encodeURIComponent(entity.name)}`
                    : `/explore/${encodeURIComponent(entity.id)}`;
                  return (
                    <Link
                      key={`${entity.id}-${idx}`}
                      href={href}
                      className="group block border border-stone-800 hover:border-stone-700 bg-stone-900/30 hover:bg-stone-900/50 transition-all duration-300 p-6"
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <span className={typeInfo.color}>{typeInfo.icon}</span>
                        <span className="text-xs text-stone-600 uppercase tracking-wider">{typeInfo.label}</span>
                      </div>
                      
                      <h3 className="font-serif text-lg text-stone-200 mb-1 group-hover:text-white transition-colors">
                        {entity.name}
                      </h3>
                      
                      {entity.variants && entity.variants.length > 0 && (
                        <p className="text-stone-500 text-sm mb-3" dir="rtl">
                          {entity.variants[0]}
                        </p>
                      )}
                      
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="text-stone-600">
                          {entity.mentions} mentions
                        </span>
                        {entity.sessions && entity.sessions.length > 0 && (
                          <span className="text-stone-600">
                            • {entity.sessions.length} sessions
                          </span>
                        )}
                      </div>
                      
                      <div className="mt-4 pt-4 border-t border-stone-800">
                        <span className="text-stone-500 text-xs group-hover:text-stone-400">
                          View details →
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
              
              {searchedEntities.length === 0 && (
                <div className="text-center py-16">
                  <p className="text-stone-500">No entities found</p>
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {/* Graph View */}
      {viewMode === 'graph' && graphData && (
        <section className="py-12 px-6">
          <div className="max-w-7xl mx-auto">
            <div className="bg-stone-900/50 border border-stone-800 rounded-lg overflow-hidden">
              <div className="p-4 border-b border-stone-800">
                <h3 className="font-serif text-lg">Entity Relationship Graph</h3>
                <p className="text-stone-500 text-sm mt-1">
                  Showing connections between {graphData.nodes.length} entities
                </p>
              </div>
              <div className="h-[600px]">
                <GraphVisualization nodes={graphData.nodes} edges={graphData.edges} />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Files View */}
      {viewMode === 'files' && (
        <section className="py-12 px-6">
          <div className="max-w-7xl mx-auto">
            <div className="mb-8">
              <h3 className="font-serif text-2xl mb-4">Source Files</h3>
              <p className="text-stone-400 mb-6">
                The trial transcripts were extracted from PDF files hosted by the Israel State Archives.
                View and download the raw text files.
              </p>
              <Link
                href="/explore/files"
                className="inline-block px-6 py-3 border border-stone-700 text-stone-300 hover:bg-stone-800 hover:border-stone-600 transition-colors"
              >
                Browse All Files →
              </Link>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { name: 'Vol1_p114.txt', sessions: '1-14', desc: 'Volume 1, Part 1' },
                { name: 'Vol1_p15291.txt', sessions: '15-29', desc: 'Volume 1, Part 2' },
                { name: 'vol1_part3.txt', sessions: '30-40', desc: 'Volume 1, Part 3' },
                { name: 'Vol2_p4155.txt', sessions: '41-54', desc: 'Volume 2, Part 1' },
                { name: 'Vol2_p5564.txt', sessions: '55-64', desc: 'Volume 2, Part 2' },
                { name: 'Vol2_p6575.txt', sessions: '65-75', desc: 'Volume 2, Part 3' },
                { name: 'vol3_p7689.txt', sessions: '76-89', desc: 'Volume 3, Part 1' },
                { name: 'vol3_p90100.txt', sessions: '90-100', desc: 'Volume 3, Part 2' },
                { name: 'vol3_p101111.txt', sessions: '101-111', desc: 'Volume 3, Part 3' },
                { name: 'vol3_p112121.txt', sessions: '112-121', desc: 'Volume 3, Part 4' },
              ].map((vol) => (
                <Link
                  key={vol.name}
                  href={`/explore/files/${encodeURIComponent(vol.name)}`}
                  className="block border border-stone-800 hover:border-stone-700 bg-stone-900/30 hover:bg-stone-900/50 transition-all p-6"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-lg">📄</span>
                    <span className="px-2 py-0.5 bg-stone-800 text-stone-400 text-xs">
                      Sessions {vol.sessions}
                    </span>
                  </div>
                  
                  <h4 className="text-stone-200 font-mono text-sm mb-1">{vol.name}</h4>
                  <p className="text-stone-500 text-sm">{vol.desc}</p>
                  
                  <div className="mt-4 pt-4 border-t border-stone-800">
                    <span className="text-stone-500 text-xs">View file →</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Timeline View */}
      {viewMode === 'timeline' && timelineData && (
        <TimelineView 
          timelineData={timelineData} 
          selectedPhase={selectedPhase}
          setSelectedPhase={setSelectedPhase}
        />
      )}

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-stone-900">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-stone-600 text-sm">
            Data extracted from the official Eichmann trial transcripts.
          </p>
        </div>
      </footer>
    </main>
  );
}

// Graph Visualization Component using vis-network (like the original HTML viewer)
function GraphVisualization({ nodes, edges }: { nodes: Entity[]; edges: Edge[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<InstanceType<typeof import('vis-network').Network> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<Entity | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set(['SESSION', 'LOCATION', 'ORGANIZATION', 'PERSON', 'EVENT', 'DATE', 'WITNESS']));
  
  const typeColors: Record<string, { bg: string; border: string }> = {
    'SESSION': { bg: '#eab308', border: '#facc15' },
    'LOCATION': { bg: '#3b82f6', border: '#60a5fa' },
    'ORGANIZATION': { bg: '#a855f7', border: '#c084fc' },
    'PERSON': { bg: '#f59e0b', border: '#fbbf24' },
    'EVENT': { bg: '#22c55e', border: '#4ade80' },
    'DATE': { bg: '#ef4444', border: '#f87171' },
    'WITNESS': { bg: '#06b6d4', border: '#22d3ee' },
  };

  // Calculate node degrees
  const nodeDegrees = useMemo(() => {
    const degrees: Record<string, number> = {};
    edges.forEach(edge => {
      degrees[edge.source] = (degrees[edge.source] || 0) + 1;
      degrees[edge.target] = (degrees[edge.target] || 0) + 1;
    });
    return degrees;
  }, [edges]);

  // Initialize vis-network
  useEffect(() => {
    if (!containerRef.current) return;

    // Dynamically import vis-network (client-side only)
    import('vis-network/standalone').then(({ Network, DataSet }) => {
      const container = containerRef.current;
      if (!container) return;

      const maxDegree = Math.max(...Object.values(nodeDegrees), 1);

      // Filter nodes based on active filters and deduplicate by ID
      const seenIds = new Set<string>();
      const filteredNodes = nodes.filter(n => {
        if (!activeFilters.has(n.type)) return false;
        if (seenIds.has(n.id)) return false;
        seenIds.add(n.id);
        return true;
      });
      
      // Create vis DataSet for nodes
      const visNodes = new DataSet(
        filteredNodes.map(node => {
          const degree = nodeDegrees[node.id] || 0;
          const minSize = 15;
          const maxSize = 70;
          const logDegree = Math.log(degree + 1);
          const logMax = Math.log(maxDegree + 1);
          const normalizedSize = logMax > 0 ? logDegree / logMax : 0;
          const size = minSize + normalizedSize * (maxSize - minSize);
          const colors = typeColors[node.type] || { bg: '#666', border: '#888' };

          return {
            id: node.id,
            label: node.name,
            title: `${node.name}\n${node.type}\nConnections: ${degree}`,
            size: size,
            color: {
              background: colors.bg,
              border: colors.border,
              highlight: {
                background: colors.border,
                border: '#fff'
              },
              hover: {
                background: colors.border,
                border: '#fff'
              }
            },
            font: { 
              color: '#fff',
              size: 12,
              face: 'Arial, sans-serif'
            }
          };
        })
      );

      // Create vis DataSet for edges
      const nodeIdSet = new Set(visNodes.getIds());
      const visEdges = new DataSet(
        edges
          .filter(e => nodeIdSet.has(e.source) && nodeIdSet.has(e.target))
          .map((edge, i) => ({
            id: i,
            from: edge.source,
            to: edge.target,
            width: 1,
            color: { 
              color: '#3a3a4a', 
              highlight: '#6366f1',
              hover: '#6366f1'
            },
            smooth: { enabled: true, type: 'continuous', roundness: 0.5 }
          }))
      );

      const data = { nodes: visNodes, edges: visEdges };

      const options = {
        nodes: {
          shape: 'dot',
          font: {
            color: '#fff',
            face: 'Arial, sans-serif',
            strokeWidth: 0
          },
          borderWidth: 2
        },
        edges: {
          smooth: {
            enabled: true,
            type: 'continuous',
            roundness: 0.5
          }
        },
        physics: {
          stabilization: { 
            iterations: 150,
            fit: true
          },
          barnesHut: {
            gravitationalConstant: -8000,
            springLength: 250,
            springConstant: 0.015,
            damping: 0.3
          }
        },
        interaction: {
          hover: true,
          tooltipDelay: 200,
          zoomView: true,
          dragView: true,
          dragNodes: true
        }
      };

      // Destroy existing network if any
      if (networkRef.current) {
        networkRef.current.destroy();
      }

      // Create network
      const network = new Network(container, data, options);
      networkRef.current = network;

      // Event handlers
      network.on('stabilizationIterationsDone', () => {
        setIsLoading(false);
      });

      network.on('click', (params: { nodes: string[] }) => {
        if (params.nodes.length > 0) {
          const nodeId = params.nodes[0];
          const node = nodes.find(n => n.id === nodeId);
          if (node) {
            setSelectedNode(node);
          }
        } else {
          setSelectedNode(null);
        }
      });

      network.on('doubleClick', (params: { nodes: string[] }) => {
        if (params.nodes.length > 0) {
          const nodeId = params.nodes[0];
          const node = nodes.find(n => n.id === nodeId);
          if (node) {
            // Navigate to entity page
            const href = node.type === 'WITNESS' || node.isWitness
              ? `/witnesses/${encodeURIComponent(node.name)}`
              : `/explore/${encodeURIComponent(node.id)}`;
            window.location.href = href;
          }
        }
      });

      // Set loading to false after short delay if stabilization takes too long
      setTimeout(() => setIsLoading(false), 3000);
    });

    return () => {
      if (networkRef.current) {
        networkRef.current.destroy();
        networkRef.current = null;
      }
    };
  }, [nodes, edges, nodeDegrees, activeFilters]);

  // Toggle filter
  const toggleFilter = (type: string) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  // Count by type
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    nodes.forEach(n => {
      counts[n.type] = (counts[n.type] || 0) + 1;
    });
    return counts;
  }, [nodes]);

  return (
    <div className="relative w-full h-full bg-[#0a0a0f]">
      {/* Graph container */}
      <div ref={containerRef} className="w-full h-full" />
      
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0f]/80">
          <div className="text-center">
            <div className="w-10 h-10 border-3 border-stone-700 border-t-indigo-500 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-stone-400">Computing layout...</p>
          </div>
        </div>
      )}
      
      {/* Filter chips */}
      <div className="absolute top-4 left-4 flex flex-wrap gap-2 max-w-xs">
        {Object.entries(typeColors).map(([type, colors]) => {
          const count = typeCounts[type] || 0;
          if (count === 0) return null;
          const isActive = activeFilters.has(type);
          return (
            <button
              key={type}
              onClick={() => toggleFilter(type)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                isActive ? 'opacity-100' : 'opacity-40'
              }`}
              style={{
                backgroundColor: `${colors.bg}40`,
                borderColor: colors.border,
                color: colors.border
              }}
            >
              {type} ({count})
            </button>
          );
        })}
      </div>
      
      {/* Instructions */}
      <div className="absolute bottom-4 left-4 text-xs text-stone-500">
        Scroll to zoom • Drag to pan • Drag nodes to move • Double-click to view details
      </div>
      
      {/* Selected node info */}
      {selectedNode && (
        <div className="absolute top-4 right-4 bg-stone-900/95 border border-stone-700 p-4 max-w-xs rounded-lg">
          <p className="text-white font-medium text-lg">{selectedNode.name}</p>
          {selectedNode.variants && selectedNode.variants[0] && (
            <p className="text-stone-400 text-sm mt-1" dir="rtl">{selectedNode.variants[0]}</p>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            <span 
              className="px-2 py-1 rounded text-xs"
              style={{
                backgroundColor: `${typeColors[selectedNode.type]?.bg}40`,
                color: typeColors[selectedNode.type]?.border
              }}
            >
              {selectedNode.type}
            </span>
            <span className="px-2 py-1 rounded text-xs bg-stone-800 text-stone-400">
              {nodeDegrees[selectedNode.id] || 0} connections
            </span>
            <span className="px-2 py-1 rounded text-xs bg-stone-800 text-stone-400">
              {selectedNode.mentions} mentions
            </span>
          </div>
          <button
            onClick={() => {
              const href = selectedNode.type === 'WITNESS' || selectedNode.isWitness
                ? `/witnesses/${encodeURIComponent(selectedNode.name)}`
                : `/explore/${encodeURIComponent(selectedNode.id)}`;
              window.location.href = href;
            }}
            className="mt-4 w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded transition-colors"
          >
            View Details →
          </button>
        </div>
      )}
    </div>
  );
}

// Timeline View Component
function TimelineView({ 
  timelineData, 
  selectedPhase, 
  setSelectedPhase 
}: { 
  timelineData: TimelineData;
  selectedPhase: string | null;
  setSelectedPhase: (phase: string | null) => void;
}) {
  const [expandedSession, setExpandedSession] = useState<number | null>(null);
  
  // Format date for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      month: 'long', 
      day: 'numeric', 
      year: 'numeric' 
    });
  };

  // Format date short
  const formatDateShort = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric'
    });
  };

  // Get phase color
  const getPhaseColor = (phaseId: string) => {
    const colors: Record<string, { bg: string; border: string; text: string }> = {
      'opening': { bg: 'bg-blue-900/30', border: 'border-blue-600', text: 'text-blue-400' },
      'opening-statement': { bg: 'bg-amber-900/30', border: 'border-amber-600', text: 'text-amber-400' },
      'prosecution-witnesses': { bg: 'bg-emerald-900/30', border: 'border-emerald-600', text: 'text-emerald-400' },
      'defense': { bg: 'bg-purple-900/30', border: 'border-purple-600', text: 'text-purple-400' },
      'closing': { bg: 'bg-orange-900/30', border: 'border-orange-600', text: 'text-orange-400' },
      'verdict': { bg: 'bg-red-900/30', border: 'border-red-600', text: 'text-red-400' },
      'sentencing': { bg: 'bg-red-900/30', border: 'border-red-700', text: 'text-red-500' },
    };
    return colors[phaseId] || { bg: 'bg-stone-900/30', border: 'border-stone-600', text: 'text-stone-400' };
  };

  // Get milestone icon
  const getMilestoneIcon = (type: string) => {
    const icons: Record<string, string> = {
      'opening': '⚖️',
      'opening-statement': '📜',
      'testimony': '🎤',
      'dramatic': '💔',
      'defense': '🛡️',
      'closing': '📝',
      'verdict': '⚖️',
      'sentencing': '🔨',
    };
    return icons[type] || '📌';
  };

  // Filter sessions by phase
  const filteredSessions = selectedPhase
    ? timelineData.sessions.filter(s => {
        const phase = timelineData.phases.find(p => p.id === selectedPhase);
        return phase?.sessions.includes(s.number);
      })
    : timelineData.sessions;

  // Group sessions by month
  const sessionsByMonth = filteredSessions.reduce((acc, session) => {
    const date = new Date(session.date);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const monthName = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (!acc[monthKey]) {
      acc[monthKey] = { name: monthName, sessions: [] };
    }
    acc[monthKey].sessions.push(session);
    return acc;
  }, {} as Record<string, { name: string; sessions: TimelineSession[] }>);

  // Calculate trial duration
  const trialStart = new Date(timelineData.metadata.trialDuration.start);
  const verdictDate = new Date(timelineData.metadata.trialDuration.verdictDate);
  const totalDays = Math.ceil((verdictDate.getTime() - trialStart.getTime()) / (1000 * 60 * 60 * 24));

  return (
    <section className="py-12 px-6">
      <div className="max-w-5xl mx-auto">
        {/* Timeline Header */}
        <div className="text-center mb-12">
          <h2 className="font-serif text-3xl mb-4">The Eichmann Trial Timeline</h2>
          <p className="text-stone-400 mb-6">
            {formatDate(timelineData.metadata.trialDuration.start)} — {formatDate(timelineData.metadata.trialDuration.sentencingDate)}
          </p>
          <div className="flex justify-center gap-8 text-sm">
            <div className="text-center">
              <div className="text-2xl font-serif text-stone-200">{totalDays}</div>
              <div className="text-stone-500">Days</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-serif text-stone-200">{timelineData.metadata.totalSessions}</div>
              <div className="text-stone-500">Sessions</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-serif text-stone-200">112</div>
              <div className="text-stone-500">Witnesses</div>
            </div>
          </div>
        </div>

        {/* Phase Filter */}
        <div className="mb-8">
          <div className="flex flex-wrap gap-2 justify-center">
            <button
              onClick={() => setSelectedPhase(null)}
              className={`px-4 py-2 text-sm border transition-colors ${
                !selectedPhase 
                  ? 'border-stone-500 text-stone-200 bg-stone-800' 
                  : 'border-stone-800 text-stone-500 hover:border-stone-700'
              }`}
            >
              All Phases
            </button>
            {timelineData.phases.map(phase => {
              const colors = getPhaseColor(phase.id);
              return (
                <button
                  key={phase.id}
                  onClick={() => setSelectedPhase(phase.id === selectedPhase ? null : phase.id)}
                  className={`px-4 py-2 text-sm border transition-colors ${
                    selectedPhase === phase.id 
                      ? `${colors.border} ${colors.text} ${colors.bg}` 
                      : 'border-stone-800 text-stone-500 hover:border-stone-700'
                  }`}
                >
                  {phase.name} ({phase.sessions.length || (phase.id === 'verdict' || phase.id === 'sentencing' ? '—' : 0)})
                </button>
              );
            })}
          </div>
        </div>

        {/* Milestones Overview */}
        <div className="mb-12 p-6 bg-stone-900/50 border border-stone-800">
          <h3 className="font-serif text-lg mb-4 text-center">Key Milestones</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {timelineData.milestones.map(milestone => (
              <div 
                key={milestone.id}
                className="text-center p-3 border border-stone-800 hover:border-stone-700 transition-colors cursor-pointer"
                onClick={() => {
                  if (milestone.sessions.length > 0) {
                    setExpandedSession(milestone.sessions[0]);
                    // Scroll to session
                    document.getElementById(`session-${milestone.sessions[0]}`)?.scrollIntoView({ behavior: 'smooth' });
                  }
                }}
              >
                <div className="text-2xl mb-2">{getMilestoneIcon(milestone.type)}</div>
                <div className="text-stone-200 text-sm font-medium">{milestone.title}</div>
                <div className="text-stone-500 text-xs mt-1">{formatDateShort(milestone.date)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Timeline */}
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-8 md:left-1/2 top-0 bottom-0 w-px bg-stone-800 transform md:-translate-x-px" />

          {/* Sessions grouped by month */}
          {Object.entries(sessionsByMonth).map(([monthKey, { name, sessions }]) => (
            <div key={monthKey} className="mb-8">
              {/* Month label */}
              <div className="sticky top-0 z-10 py-2 mb-4">
                <div className="flex items-center justify-center">
                  <div className="bg-stone-950 border border-stone-800 px-4 py-2">
                    <span className="text-stone-300 font-serif">{name}</span>
                  </div>
                </div>
              </div>

              {/* Sessions */}
              {sessions.map((session, idx) => {
                const phase = timelineData.phases.find(p => p.sessions.includes(session.number));
                const colors = phase ? getPhaseColor(phase.id) : getPhaseColor('');
                const isMilestone = session.milestone || timelineData.milestones.some(m => m.sessions.includes(session.number));
                const isExpanded = expandedSession === session.number;

                return (
                  <div 
                    key={session.number}
                    id={`session-${session.number}`}
                    className={`relative flex items-start mb-4 ${idx % 2 === 0 ? 'md:flex-row-reverse' : ''}`}
                  >
                    {/* Timeline dot */}
                    <div className={`absolute left-8 md:left-1/2 w-4 h-4 rounded-full border-2 transform -translate-x-1/2 z-10 ${
                      isMilestone 
                        ? 'bg-amber-500 border-amber-400' 
                        : `bg-stone-900 ${colors.border}`
                    }`} />

                    {/* Session card */}
                    <div 
                      className={`ml-16 md:ml-0 md:w-[calc(50%-2rem)] ${idx % 2 === 0 ? 'md:mr-8' : 'md:ml-8'}`}
                    >
                      <button
                        onClick={() => setExpandedSession(isExpanded ? null : session.number)}
                        className={`w-full text-left p-4 border transition-all hover:bg-stone-900/70 ${colors.bg} ${colors.border} ${
                          isExpanded ? 'ring-1 ring-stone-600' : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-lg font-serif ${colors.text}`}>
                                Session {session.number}
                              </span>
                              {isMilestone && <span className="text-amber-400">★</span>}
                            </div>
                            <div className="text-stone-500 text-sm">
                              {session.day}, {formatDateShort(session.date)}
                            </div>
                            {session.topics.length > 0 && (
                              <div className="mt-2 text-stone-400 text-sm">
                                {session.topics[0]}
                              </div>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="text-stone-600 text-xs" dir="rtl">
                              {session.hebrewDate}
                            </div>
                            {session.witnesses.length > 0 && (
                              <div className="text-stone-500 text-xs mt-1">
                                {session.witnesses.length} witness{session.witnesses.length > 1 ? 'es' : ''}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Expanded content */}
                        {isExpanded && (
                          <div className="mt-4 pt-4 border-t border-stone-800">
                            {session.topics.length > 1 && (
                              <div className="mb-3">
                                <div className="text-stone-500 text-xs uppercase tracking-wide mb-1">Topics</div>
                                <ul className="text-stone-300 text-sm space-y-1">
                                  {session.topics.map((topic, i) => (
                                    <li key={i}>• {topic}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {session.witnesses.length > 0 && (
                              <div className="mb-3">
                                <div className="text-stone-500 text-xs uppercase tracking-wide mb-1">Witnesses</div>
                                <div className="flex flex-wrap gap-2">
                                  {session.witnesses.map((witness, i) => (
                                    <Link
                                      key={i}
                                      href={`/witnesses/${encodeURIComponent(witness)}`}
                                      className="text-cyan-400 text-sm hover:text-cyan-300 underline underline-offset-2"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {witness}
                                    </Link>
                                  ))}
                                </div>
                              </div>
                            )}
                            {session.milestone && (
                              <div className="text-amber-400 text-sm">
                                ★ {session.milestone}
                              </div>
                            )}
                            {phase && (
                              <div className="mt-2 text-stone-500 text-xs">
                                Phase: {phase.name}
                              </div>
                            )}
                          </div>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {/* Verdict and Sentencing (if not filtered out) */}
          {!selectedPhase || selectedPhase === 'verdict' || selectedPhase === 'sentencing' ? (
            <div className="mb-8">
              <div className="sticky top-0 z-10 py-2 mb-4">
                <div className="flex items-center justify-center">
                  <div className="bg-stone-950 border border-red-900 px-4 py-2">
                    <span className="text-red-400 font-serif">December 1961</span>
                  </div>
                </div>
              </div>

              {/* Verdict */}
              <div className="relative flex items-start mb-4">
                <div className="absolute left-8 md:left-1/2 w-6 h-6 rounded-full bg-red-600 border-2 border-red-400 transform -translate-x-1/2 z-10 flex items-center justify-center">
                  <span className="text-xs">⚖️</span>
                </div>
                <div className="ml-16 md:ml-0 md:w-[calc(50%-2rem)] md:ml-8">
                  <Link
                    href="/verdict"
                    className="block p-6 bg-red-900/20 border border-red-800 hover:border-red-600 transition-all"
                  >
                    <div className="text-2xl font-serif text-red-400 mb-2">The Verdict</div>
                    <div className="text-stone-400 mb-2">{formatDate(timelineData.metadata.trialDuration.verdictDate)}</div>
                    <div className="text-stone-300">
                      Adolf Eichmann found guilty on all 15 counts of crimes against the Jewish people, crimes against humanity, and war crimes.
                    </div>
                    <div className="mt-4 text-red-400 text-sm">Read the full verdict →</div>
                  </Link>
                </div>
              </div>

              {/* Sentencing */}
              <div className="relative flex items-start mb-4 md:flex-row-reverse">
                <div className="absolute left-8 md:left-1/2 w-6 h-6 rounded-full bg-red-700 border-2 border-red-500 transform -translate-x-1/2 z-10 flex items-center justify-center">
                  <span className="text-xs">🔨</span>
                </div>
                <div className="ml-16 md:ml-0 md:w-[calc(50%-2rem)] md:mr-8">
                  <div className="p-6 bg-red-900/20 border border-red-800">
                    <div className="text-2xl font-serif text-red-500 mb-2">Death Sentence</div>
                    <div className="text-stone-400 mb-2">{formatDate(timelineData.metadata.trialDuration.sentencingDate)}</div>
                    <div className="text-stone-300">
                      Adolf Eichmann sentenced to death by hanging. The sentence was carried out on June 1, 1962.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Timeline Legend */}
        <div className="mt-12 p-6 bg-stone-900/30 border border-stone-800">
          <h4 className="text-stone-400 text-sm uppercase tracking-wide mb-4 text-center">Timeline Legend</h4>
          <div className="flex flex-wrap justify-center gap-4">
            {timelineData.phases.map(phase => {
              const colors = getPhaseColor(phase.id);
              return (
                <div key={phase.id} className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${colors.border} border-2 bg-stone-900`} />
                  <span className={`text-sm ${colors.text}`}>{phase.name}</span>
                </div>
              );
            })}
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-amber-500" />
              <span className="text-sm text-amber-400">Key Milestone</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
