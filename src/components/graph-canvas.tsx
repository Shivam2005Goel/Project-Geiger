'use client';

import React, { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
// @ts-ignore
import dagre from 'cytoscape-dagre';

cytoscape.use(dagre);

interface GraphCanvasProps {
  data: {
    nodes: any[];
    edges: any[];
  };
}

export function GraphCanvas({ data }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Transform our internal data format to Cytoscape's elements format
    const elements = [
      ...data.nodes.map((n) => ({
        data: {
          id: n.id,
          label: n.title ? (n.title.length > 30 ? n.title.substring(0, 30) + '...' : n.title) : n.doi,
          retracted: n.retracted,
          score: n.contaminationScore,
          fullTitle: n.title,
        },
      })),
      ...data.edges.map((e, idx) => ({
        data: {
          id: `e${idx}`,
          source: e.source,
          target: e.target,
        },
      })),
    ];

    cyRef.current = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': (ele) => ele.data('retracted') ? '#ef4444' : '#3b82f6',
            'label': 'data(label)',
            'color': '#fff',
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': '10px',
            'width': '60px',
            'height': '60px',
            'text-wrap': 'wrap',
            'text-max-width': '50px',
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 2,
            'line-color': '#94a3b8',
            'target-arrow-color': '#94a3b8',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
          },
        },
      ],
      layout: {
        name: 'dagre',
        rankDir: 'TB', // Top-to-bottom for generations of papers
        nodeSep: 50,
        rankSep: 100,
      } as any,
    });

    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
      }
    };
  }, [data]);

  return <div ref={containerRef} className="w-full h-full bg-slate-50 rounded-xl border border-slate-200" />;
}
