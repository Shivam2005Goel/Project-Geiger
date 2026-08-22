'use client';

import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
const ForceGraph3D = dynamic(() => import('react-force-graph-3d'), { ssr: false });
import * as THREE from 'three';

import type { CitationEdge, PaperGraph, PaperNode } from '@/lib/types';
import { BAND, STATUS, nodeColours, nodeSize } from '@/lib/ui/presentation';

interface GraphCanvas3DProps {
  graph: PaperGraph;
  onSelect: (paper: PaperNode | null) => void;
  selectedId?: string | null;
  focusMode?: boolean;
  authorMode?: boolean;
}

export function GraphCanvas3D({
  graph,
  onSelect,
  selectedId,
  focusMode = false,
  authorMode = false,
}: GraphCanvas3DProps) {
  const fgRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const graphData = useMemo(() => {
    if (authorMode) {
      const authorNodes = new Map<string, any>();
      const authorLinks: any[] = [];
      const linkCounts = new Map<string, number>();

      graph.nodes.forEach(paper => {
        paper.authors.forEach(author => {
          const authId = author.id || author.name;
          if (!authorNodes.has(authId)) {
            authorNodes.set(authId, {
              id: authId,
              label: author.name,
              color: paper.retracted ? '#f43f5e' : (paper.contamination?.score ?? 0) > 0 ? '#f59e0b' : '#3b82f6',
              val: 1,
              isAuthor: true,
            });
          } else {
            const existing = authorNodes.get(authId);
            existing.val += 1;
            if (paper.retracted) existing.color = '#f43f5e';
            else if ((paper.contamination?.score ?? 0) > 0 && existing.color !== '#f43f5e') existing.color = '#f59e0b';
          }
        });
        
        // Co-authorship edges within the same paper
        for (let i = 0; i < paper.authors.length; i++) {
          for (let j = i + 1; j < paper.authors.length; j++) {
            const a1 = paper.authors[i].id || paper.authors[i].name;
            const a2 = paper.authors[j].id || paper.authors[j].name;
            const linkId = [a1, a2].sort().join('-');
            linkCounts.set(linkId, (linkCounts.get(linkId) || 0) + 1);
            if (linkCounts.get(linkId) === 1) {
               authorLinks.push({
                 source: a1,
                 target: a2,
                 color: '#334155',
                 width: 1,
               });
            }
          }
        }
      });

      return { nodes: Array.from(authorNodes.values()), links: authorLinks };
    }

    // Focus mode: pre-calculate neighborhood
    let highlightedNodes = new Set<string>();
    let highlightedLinks = new Set<string>();
    
    if (focusMode && selectedId) {
      highlightedNodes.add(selectedId);
      graph.edges.forEach(e => {
        if (e.source === selectedId || e.target === selectedId) {
          highlightedNodes.add(e.source);
          highlightedNodes.add(e.target);
          highlightedLinks.add(`${e.source}-${e.target}`);
        }
      });
    }

    const nodes = graph.nodes.map(n => {
      const { fill } = nodeColours(n.status, n.contamination);
      const isHighlighted = highlightedNodes.has(n.id);
      const isDimmed = focusMode && selectedId && !isHighlighted;
      
      return {
        id: n.id,
        paper: n,
        color: isDimmed ? '#1e293b' : fill,
        val: n.citedByCount ? Math.log(n.citedByCount + 2) : 1, // volume
        isRoot: n.id === graph.root.id,
        isDimmed,
      };
    });

    const links = graph.edges.map(e => {
      const id = `${e.source}-${e.target}`;
      const isHighlighted = highlightedLinks.has(id);
      const isDimmed = focusMode && selectedId && !isHighlighted;

      return {
        source: e.source,
        target: e.target,
        color: e.postRetraction ? '#f43f5e' : (isDimmed ? '#1e293b' : '#334155'),
        width: e.postRetraction ? 2 : 1,
        isDimmed,
      };
    });

    return { nodes, links };
  }, [graph, focusMode, selectedId]);

  const [selectedLink, setSelectedLink] = useState<any>(null);
  const [linkContext, setLinkContext] = useState<any>(null);

  const handleNodeClick = useCallback((node: any) => {
    if (node) {
      if (node.isAuthor) {
         // Do not select paper if it's an author node
      } else if (node.paper) {
        onSelect(node.paper);
      }
      // Aim at node from outside it
      if (fgRef.current) {
        const distance = 100;
        const distRatio = 1 + distance/Math.hypot(node.x, node.y, node.z);
        fgRef.current.cameraPosition(
          { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
          node, // lookAt
          2000  // ms transition
        );
      }
    }
  }, [onSelect]);

  const handleLinkClick = useCallback((link: any) => {
    setSelectedLink(link);
    setLinkContext(null);
    if (!authorMode) {
       // Fetch NLP context
       const targetTitle = graph.nodes.find(n => n.id === link.target.id)?.title;
       fetch('/api/nlp', {
         method: 'POST',
         body: JSON.stringify({ sourceId: link.source.id, targetId: link.target.id, title: targetTitle }),
         headers: { 'Content-Type': 'application/json' }
       })
       .then(r => r.json())
       .then(data => setLinkContext(data))
       .catch(e => console.error(e));
    }
  }, [graph.nodes, authorMode]);

  const handleBackgroundClick = useCallback(() => {
    onSelect(null);
    setSelectedLink(null);
  }, [onSelect]);

  return (
    <div className="relative h-full w-full" ref={containerRef}>
      {dimensions.width > 0 && (
        <ForceGraph3D
          ref={fgRef}
          width={dimensions.width}
          height={dimensions.height}
          graphData={graphData}
          backgroundColor="#020617" // slate-950 equivalent or dark bg
          nodeId="id"
          nodeColor="color"
          nodeRelSize={4}
          nodeVal="val"
          nodeLabel={(node: any) => {
             if (node.isAuthor) {
                return `<div style="background: rgba(0,0,0,0.8); color: white; padding: 4px 8px; border-radius: 4px; font-family: sans-serif; font-size: 12px; border: 1px solid rgba(255,255,255,0.2);">
                  ${node.label} (Papers: ${node.val})
               </div>`;
             }
             const title = node.paper.title ?? node.paper.doi ?? node.id;
             const year = node.paper.publicationYear ? ` (${node.paper.publicationYear})` : '';
             return `<div style="background: rgba(0,0,0,0.8); color: white; padding: 4px 8px; border-radius: 4px; font-family: sans-serif; font-size: 12px; border: 1px solid rgba(255,255,255,0.2);">
                ${title}${year}
             </div>`;
          }}
          nodeResolution={16}
          linkWidth="width"
          linkColor="color"
          linkDirectionalArrowLength={3}
          linkDirectionalArrowRelPos={1}
          onNodeClick={handleNodeClick}
          onLinkClick={handleLinkClick}
          onBackgroundClick={handleBackgroundClick}
          // Highlight selected node
          nodeThreeObject={(node: any) => {
            if (node.id === selectedId) {
              const geometry = new THREE.SphereGeometry(Math.cbrt(node.val)*5, 16, 16);
              const material = new THREE.MeshBasicMaterial({ color: '#38bdf8', wireframe: true });
              const mesh = new THREE.Mesh(geometry, material);
              
              // Inner solid sphere
              const innerGeo = new THREE.SphereGeometry(Math.cbrt(node.val)*4, 16, 16);
              const innerMat = new THREE.MeshLambertMaterial({ color: node.color });
              const innerMesh = new THREE.Mesh(innerGeo, innerMat);
              mesh.add(innerMesh);
              
              return mesh;
            }
            if (node.isRoot) {
               const geometry = new THREE.SphereGeometry(Math.cbrt(node.val)*4.5, 16, 16);
               const material = new THREE.MeshLambertMaterial({ color: node.color, emissive: node.color, emissiveIntensity: 0.5 });
               return new THREE.Mesh(geometry, material);
            }
            return false; // use default node renderer
          }}
          enableNodeDrag={false}
        />
      )}

      {selectedLink && !authorMode && (
        <div className="absolute top-4 left-4 z-50 w-80 rounded-lg border border-white/10 bg-black/80 p-4 text-sm text-white shadow-2xl backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold text-slate-200">AI Context Analysis</h3>
            <button onClick={() => setSelectedLink(null)} className="text-slate-400 hover:text-white">✕</button>
          </div>
          {!linkContext ? (
            <div className="flex items-center gap-2 text-sky-400">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
              Analyzing citation context...
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded bg-white/5 p-2 italic text-slate-300">
                "{linkContext.snippet}"
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Sentiment</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold
                  ${linkContext.sentiment === 'supporting' ? 'bg-emerald-500/20 text-emerald-400' : ''}
                  ${linkContext.sentiment === 'contrasting' ? 'bg-amber-500/20 text-amber-400' : ''}
                  ${linkContext.sentiment === 'mentioning' ? 'bg-slate-500/20 text-slate-300' : ''}
                `}>
                  {linkContext.sentiment.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">AI Confidence</span>
                <span className="text-xs text-slate-300">{(Number(linkContext.confidence) * 100).toFixed(0)}%</span>
              </div>
              {linkContext.isMock && (
                <div className="mt-2 text-[10px] text-slate-500">
                  Running in Mock Mode. Set OPENAI_API_KEY for live data.
                </div>
              )}
            </div>
          )}
        </div>
      )}
      
      <div className="pointer-events-none absolute bottom-3 right-3 rounded-md border border-white/10 bg-black/70 px-2.5 py-1.5 text-[11px] text-slate-400 backdrop-blur">
        {graph.nodes.length} papers · {graph.edges.length} citations
        <br />
        <span className="text-sky-400">Left-click: Rotate · Right-click: Pan · Scroll: Zoom</span>
      </div>
    </div>
  );
}
