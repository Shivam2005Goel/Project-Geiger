'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';

import { Play, Pause, RotateCcw } from 'lucide-react';
import type { CitationEdge, PaperGraph, PaperNode } from '@/lib/types';
import { BAND, STATUS, bandFor, nodeColours, nodeSize } from '@/lib/ui/presentation';

cytoscape.use(dagre);

export type LayoutMode = 'timeline' | 'hierarchy' | 'organic' | '3d';

interface GraphCanvasProps {
  graph: PaperGraph;
  layout: LayoutMode;
  onSelect: (paper: PaperNode | null) => void;
  selectedId?: string | null;
  /** Dim everything not connected to the selection. */
  focusMode?: boolean;
  /** Trace the shortest path from the selected node to the root. */
  traceMode?: boolean;
}

/**
 * The citation graph.
 */
export function GraphCanvas({
  graph,
  layout,
  onSelect,
  selectedId,
  focusMode = false,
  traceMode = false,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  // Held in a ref so the cytoscape instance is not rebuilt whenever the
  // parent passes a new callback identity.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const [ready, setReady] = useState(false);
  const [playbackYear, setPlaybackYear] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const yearExtent = useMemo(() => {
    const years = graph.nodes
      .map((n) => n.publicationYear)
      .filter((y): y is number => typeof y === 'number');
    if (!years.length) return null;
    return { min: Math.min(...years), max: Math.max(...years) };
  }, [graph.nodes]);

  const elements = useMemo(() => {
    const nodeElements = graph.nodes.map((n) => {
      const { fill, stroke } = nodeColours(n.status, n.contamination);
      return {
        data: {
          id: n.id,
          label: shortLabel(n),
          fill,
          stroke,
          size: nodeSize(n.citedByCount),
          isRoot: n.id === graph.root.id,
          flagged: n.status !== 'clean',
          year: n.publicationYear ?? null,
          score: n.contamination?.score ?? 0,
        },
      };
    });

    const edgeElements = graph.edges.map((e: CitationEdge, i) => ({
      data: {
        id: `e${i}`,
        source: e.source,
        target: e.target,
        postRetraction: e.postRetraction === true,
      },
    }));

    return [...nodeElements, ...edgeElements];
  }, [graph]);

  // Build once per graph. Layout and selection are applied separately so
  // changing either does not pay for a full teardown.
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(fill)',
            'border-color': 'data(stroke)',
            'border-width': 2,
            width: 'data(size)',
            height: 'data(size)',
            label: 'data(label)',
            color: '#cbd5e1',
            'font-size': '9px',
            'font-family': 'var(--font-geist-sans), Inter, sans-serif',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 5,
            'text-wrap': 'ellipsis',
            'text-max-width': '110px',
            'text-background-color': '#020617',
            'text-background-opacity': 0.65,
            'text-background-padding': '2px',
            'transition-property': 'opacity, border-width',
            'transition-duration': 150,
          },
        },
        {
          // The paper being examined, so it never gets lost in its own graph.
          selector: 'node[?isRoot]',
          style: {
            'border-width': 4,
            'border-color': '#e2e8f0',
            'font-size': '11px',
            'font-weight': 'bold',
            color: '#f8fafc',
            'z-index': 100,
          },
        },
        {
          selector: 'node[?flagged]',
          style: { 'border-width': 3, 'border-style': 'double' },
        },
        {
          selector: 'edge',
          style: {
            width: 1,
            'line-color': '#334155',
            'target-arrow-color': '#334155',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.6,
            'curve-style': 'straight',
            opacity: 0.45,
          },
        },
        {
          // The headline signal: someone cited a paper after it was flagged.
          selector: 'edge[?postRetraction]',
          style: {
            width: 2,
            'line-color': '#f43f5e',
            'target-arrow-color': '#f43f5e',
            'line-style': 'dashed',
            opacity: 0.9,
            'z-index': 50,
          },
        },
        {
          selector: 'node:selected',
          style: { 'border-width': 5, 'border-color': '#38bdf8', 'z-index': 200 },
        },
        { selector: '.dimmed', style: { opacity: 0.08 } },
        { selector: '.highlighted', style: { opacity: 1, 'z-index': 150 } },
        { selector: '.future-hidden', style: { opacity: 0, 'events': 'no' } },
        { 
          selector: 'edge.trace-highlight', 
          style: { 
            width: 4, 
            'line-color': '#f59e0b', 
            'target-arrow-color': '#f59e0b', 
            opacity: 1, 
            'z-index': 999,
            'underlay-color': '#f59e0b',
            'underlay-padding': 2,
            'underlay-opacity': 0.5
          } 
        },
        { 
          selector: 'node.trace-highlight', 
          style: { 
            'border-width': 4,
            'border-color': '#f59e0b',
            'z-index': 999,
            'underlay-color': '#f59e0b',
            'underlay-padding': 4,
            'underlay-opacity': 0.5
          } 
        },
      ] as cytoscape.StylesheetJson,
      layout: { name: 'preset' },
      wheelSensitivity: 0.2,
      maxZoom: 4,
      minZoom: 0.05,
      // Interaction stays responsive on large graphs by skipping the
      // expensive style recalculation while panning.
      textureOnViewport: graph.nodes.length > 250,
      motionBlur: false,
      pixelRatio: 1,
    });

    cy.on('tap', 'node', (event) => {
      const id = event.target.id();
      onSelectRef.current(graph.nodes.find((n) => n.id === id) ?? null);
    });
    cy.on('tap', (event) => {
      if (event.target === cy) onSelectRef.current(null);
    });

    cyRef.current = cy;
    setReady(true);

    return () => {
      cy.destroy();
      cyRef.current = null;
      setReady(false);
    };
  }, [elements, graph.nodes, graph.root.id]);

  // Apply layout whenever the mode or the data changes.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !ready) return;

    if (layout === 'timeline' && yearExtent) {
      applyTimelineLayout(cy, yearExtent);
    } else if (layout === 'hierarchy') {
      cy.layout({
        name: 'dagre',
        rankDir: 'BT', // cited work at the bottom, citing work above it
        nodeSep: 45,
        rankSep: 110,
        animate: true,
        animationDuration: 400,
        fit: true,
        padding: 40,
      } as cytoscape.LayoutOptions).run();
    } else {
      cy.layout({
        name: 'cose',
        animate: true,
        animationDuration: 600,
        fit: true,
        padding: 40,
        nodeRepulsion: () => 12000,
        idealEdgeLength: () => 70,
      } as cytoscape.LayoutOptions).run();
    }
  }, [layout, ready, yearExtent, elements]);

  // Focus mode or Trace mode: highlight specific elements.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !ready) return;

    cy.batch(() => {
      cy.elements().removeClass('dimmed highlighted trace-highlight');
      if (!selectedId || (!focusMode && !traceMode)) return;

      const node = cy.getElementById(selectedId);
      if (!node.length) return;

      if (traceMode) {
        // Shortest Path Highlighting using Dijkstra
        // Dijkstra calculates the shortest path from the source node to all other nodes
        // Wait, Cytoscape dijkstra searches starting from the root node to the selected node, or vice versa?
        // Let's trace from the selected node to the root.
        // The edges might be directed (CITES -> target). If they are directed, we might need to use undirected search to find the path backwards.
        const dijkstra = cy.elements().dijkstra({ root: node, directed: false });
        const rootNode = cy.getElementById(graph.root.id);
        const path = dijkstra.pathTo(rootNode);
        
        cy.elements().difference(path).addClass('dimmed');
        path.addClass('highlighted trace-highlight');
      } else if (focusMode) {
        // Immediate neighborhood focus
        const neighbourhood = node.closedNeighborhood();
        cy.elements().difference(neighbourhood).addClass('dimmed');
        neighbourhood.addClass('highlighted');
      }
    });
  }, [selectedId, focusMode, traceMode, ready, graph.root.id]);

  // Keep the Cytoscape selection in sync with external state.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !ready) return;
    cy.batch(() => {
      cy.nodes().unselect();
      if (selectedId) {
        const node = cy.getElementById(selectedId);
        if (node.length) {
          node.select();
          // Center the camera on the node when selected externally (e.g. from command palette)
          cy.animate({
            center: { eles: node },
            zoom: Math.max(cy.zoom(), 1.5),
            duration: 500,
            easing: 'ease-in-out-cubic'
          });
        }
      }
    });
  }, [selectedId, ready]);

  // Handle playback animation
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying && yearExtent) {
      interval = setInterval(() => {
        setPlaybackYear((prev) => {
          if (prev === null) return yearExtent.min;
          if (prev >= yearExtent.max) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 1000); // 1 second per year
    }
    return () => clearInterval(interval);
  }, [isPlaying, yearExtent]);

  // Apply playback filter to Cytoscape
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !ready) return;

    cy.batch(() => {
      if (playbackYear === null) {
        cy.elements().removeClass('future-hidden');
      } else {
        cy.nodes().forEach(node => {
          const year = node.data('year');
          if (year !== null && year > playbackYear) {
            node.addClass('future-hidden');
            node.connectedEdges().addClass('future-hidden');
          } else {
            node.removeClass('future-hidden');
          }
        });
        
        // Restore edges if both connected nodes are visible
        cy.edges().forEach(edge => {
          const sourceHidden = edge.source().hasClass('future-hidden');
          const targetHidden = edge.target().hasClass('future-hidden');
          if (!sourceHidden && !targetHidden) {
            edge.removeClass('future-hidden');
          }
        });
      }
    });
  }, [playbackYear, ready]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {layout === 'timeline' && yearExtent && (
        <TimelineAxis min={yearExtent.min} max={yearExtent.max} />
      )}

      <Legend />

      <div className="pointer-events-none absolute bottom-3 right-3 rounded-md border border-white/10 bg-black/70 px-2.5 py-1.5 text-[11px] text-slate-400 backdrop-blur">
        {graph.nodes.length} papers · {graph.edges.length} citations
        {graph.meta.truncated && graph.meta.totalAvailable !== null && (
          <span className="ml-1 text-amber-400">
            (showing {graph.nodes.length} of {graph.meta.totalAvailable})
          </span>
        )}
      </div>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-full border border-white/10 bg-black/80 px-4 py-2 backdrop-blur-md">
        <button 
          onClick={() => {
            if (playbackYear === null) setPlaybackYear(yearExtent?.min ?? null);
            setIsPlaying(!isPlaying);
          }}
          className="text-slate-300 hover:text-white transition-colors"
        >
          {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </button>
        <button 
          onClick={() => { setIsPlaying(false); setPlaybackYear(null); }}
          className="text-slate-400 hover:text-white transition-colors"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <div className="text-sm font-mono text-slate-200 min-w-[60px] text-center">
          {playbackYear !== null ? playbackYear : 'All Time'}
        </div>
      </div>
    </div>
  );
}

/**
 * Position nodes with y fixed to publication year.
 *
 * x is spread by a stable hash of the node id rather than at random, so the
 * layout does not jump between renders, and nodes in the same year form a band
 * instead of a single unreadable column.
 */
function applyTimelineLayout(
  cy: cytoscape.Core,
  extent: { min: number; max: number },
): void {
  const height = Math.max(600, cy.container()?.clientHeight ?? 600);
  const width = Math.max(800, cy.container()?.clientWidth ?? 800);
  const span = Math.max(1, extent.max - extent.min);

  // Count per year so a crowded year can be spread across the full width.
  const perYear = new Map<number, number>();
  cy.nodes().forEach((n) => {
    const year = (n.data('year') as number | null) ?? extent.min;
    perYear.set(year, (perYear.get(year) ?? 0) + 1);
  });
  const seen = new Map<number, number>();

  cy.batch(() => {
    cy.nodes().forEach((node) => {
      const year = (node.data('year') as number | null) ?? extent.min;
      // Older at the top, newer at the bottom: contamination flows downward.
      const y = ((year - extent.min) / span) * (height - 120) + 60;

      const total = perYear.get(year) ?? 1;
      const index = seen.get(year) ?? 0;
      seen.set(year, index + 1);

      const usable = width - 160;
      const x = total === 1 ? width / 2 : 80 + (usable * (index + 0.5)) / total;

      node.position({ x, y });
    });
  });

  cy.fit(undefined, 50);
}

function TimelineAxis({ min, max }: { min: number; max: number }) {
  const ticks = useMemo(() => {
    const span = max - min;
    if (span <= 0) return [min];
    const step = span <= 10 ? 2 : span <= 30 ? 5 : 10;
    const out: number[] = [];
    for (let y = Math.ceil(min / step) * step; y <= max; y += step) out.push(y);
    return out;
  }, [min, max]);

  return (
    <div className="pointer-events-none absolute left-0 top-0 h-full w-14 border-r border-white/5">
      {ticks.map((year) => {
        const top = ((year - min) / Math.max(1, max - min)) * 100;
        return (
          <div
            key={year}
            className="absolute left-2 -translate-y-1/2 text-[10px] tabular-nums text-slate-500"
            style={{ top: `calc(${top}% * 0.82 + 8%)` }}
          >
            {year}
          </div>
        );
      })}
    </div>
  );
}

function Legend() {
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute left-16 top-3 rounded-md border border-white/10 bg-black/70 px-2.5 py-1.5 text-[11px] text-slate-300 backdrop-blur hover:bg-black/85"
      >
        Show legend
      </button>
    );
  }

  return (
    <div className="absolute left-16 top-3 w-56 rounded-lg border border-white/10 bg-black/75 p-3 text-[11px] backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-slate-200">Legend</span>
        <button
          onClick={() => setOpen(false)}
          className="text-slate-500 hover:text-slate-300"
          aria-label="Hide legend"
        >
          ×
        </button>
      </div>

      <ul className="space-y-1.5">
        {(['retracted', 'concerned', 'corrected'] as const).map((status) => (
          <li key={status} className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-full border-2"
              style={{
                backgroundColor: STATUS[status].fill,
                borderColor: STATUS[status].stroke,
              }}
            />
            <span className="text-slate-300">{STATUS[status].label}</span>
          </li>
        ))}
        {(['high', 'moderate', 'none'] as const).map((band) => (
          <li key={band} className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-full border-2"
              style={{ backgroundColor: BAND[band].fill, borderColor: BAND[band].stroke }}
            />
            <span className="text-slate-400">
              {band === 'none' ? 'No contamination' : `${BAND[band].label} contamination`}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-2.5 space-y-1.5 border-t border-white/10 pt-2.5 text-slate-400">
        <div className="flex items-center gap-2">
          <svg width="22" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="22" y2="4" stroke="#f43f5e" strokeWidth="2" strokeDasharray="4 3" />
          </svg>
          <span>Cited after the notice</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-end gap-0.5" aria-hidden="true">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
            <span className="h-3 w-3 rounded-full bg-slate-600" />
          </span>
          <span>Size = citations received</span>
        </div>
      </div>
    </div>
  );
}

function shortLabel(node: PaperNode): string {
  const text = node.title ?? node.doi ?? node.id;
  return text.length > 44 ? `${text.slice(0, 44)}…` : text;
}

export { bandFor };
