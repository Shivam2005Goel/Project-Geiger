'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertTriangle, ArrowLeft, Calendar, Download, ExternalLink,
  Filter, Info, Loader2, Network, Table as TableIcon, Users,
} from 'lucide-react';

import { GraphCanvas, type LayoutMode } from '@/components/graph-canvas';
import { PaperDetail } from '@/components/paper-detail';
import { GlobalSearch } from '@/components/global-search';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EXPORT_META, type ExportFormat } from '@/lib/export/formats';
import { BAND, STATUS, bandFor, explainScore, formatScore } from '@/lib/ui/presentation';
import type { PaperGraph, PaperNode, TraversalDirection } from '@/lib/types';

interface Filters {
  direction: TraversalDirection;
  depth: number;
  limit: number;
  minScore: number;
  statuses: string[];
}

const DEFAULT_FILTERS: Filters = {
  direction: 'downstream',
  depth: 2,
  limit: 250,
  minScore: 0,
  statuses: [],
};

export default function PaperViewPage() {
  const params = useParams();
  const doi = useMemo(
    () => (Array.isArray(params?.doi) ? params.doi.join('/') : String(params?.doi ?? '')),
    [params],
  );

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [layout, setLayout] = useState<LayoutMode>('timeline');
  const [selected, setSelected] = useState<PaperNode | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [traceMode, setTraceMode] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Identifies the request the current view should be showing. Anything that
  // changes it — a new DOI, a filter change, a retry — invalidates the result.
  const requestKey = useMemo(
    () => JSON.stringify({ doi, filters, attempt }),
    [doi, filters, attempt],
  );

  const [result, setResult] = useState<{
    key: string;
    graph: PaperGraph | null;
    error: { message: string; hint?: string } | null;
  } | null>(null);

  // Loading is derived, not stored. Holding it in state would mean setting it
  // synchronously inside the fetch effect, and it can go stale against the
  // request it is meant to describe.
  const loading = result?.key !== requestKey;
  const graph = result?.key === requestKey ? result.graph : null;
  const error = result?.key === requestKey ? result.error : null;

  useEffect(() => {
    if (!doi) return;
    let cancelled = false;

    const query = new URLSearchParams({
      direction: filters.direction,
      depth: String(filters.depth),
      limit: String(filters.limit),
    });
    if (filters.minScore > 0) query.set('minScore', String(filters.minScore));
    if (filters.statuses.length) query.set('status', filters.statuses.join(','));

    fetch(`/api/paper/${encodeURIComponent(doi)}?${query.toString()}`)
      .then(async (response) => {
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setResult({
            key: requestKey,
            graph: null,
            error: { message: body.error ?? 'Could not load this paper', hint: body.hint },
          });
          return;
        }
        setResult({ key: requestKey, graph: body as PaperGraph, error: null });
      })
      .catch(() => {
        if (cancelled) return;
        setResult({
          key: requestKey,
          graph: null,
          error: {
            message: 'Could not reach the server',
            hint: 'Check your connection and try again.',
          },
        });
      });

    // A stale response must never overwrite a newer one.
    return () => { cancelled = true; };
  }, [doi, filters, requestKey]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const download = (format: ExportFormat) => {
    const query = new URLSearchParams({
      format,
      direction: filters.direction,
      depth: String(filters.depth),
      limit: String(filters.limit),
    });
    // An anchor rather than assigning location: navigating away would tear
    // down the loaded graph just to fetch a file.
    const link = document.createElement('a');
    link.href = `/api/export/${encodeURIComponent(doi)}?${query.toString()}`;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const root = graph?.root;
  const flaggedCount = graph
    ? graph.nodes.filter((n) => n.status !== 'clean').length
    : 0;
  const postNoticeEdges = graph
    ? graph.edges.filter((e) => e.postRetraction).length
    : 0;

  return (
    <div className="relative z-10 flex h-screen flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-black/30 px-4 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            className="flex shrink-0 items-center text-sm text-slate-400 transition-colors hover:text-white"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Geiger
          </Link>
          <span className="h-5 w-px shrink-0 bg-white/10" />
          <span className="truncate font-mono text-xs text-slate-400" title={doi}>
            {doi}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters((v) => !v)}
            className="border-white/10 bg-black/40 text-slate-300 hover:bg-white/10"
          >
            <Filter className="mr-1.5 h-3.5 w-3.5" />
            Filters
          </Button>
          {graph && (
            <GlobalSearch nodes={graph.nodes} onSelect={setSelected} />
          )}
          <ExportMenu onSelect={download} disabled={!graph} />
        </div>
      </header>

      {showFilters && (
        <FilterBar
          filters={filters}
          onChange={setFilters}
          onReset={() => setFilters(DEFAULT_FILTERS)}
        />
      )}

      {root && <PaperHeader paper={root} />}

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={retry} />
        ) : graph ? (
          <>
            <StatBar
              total={graph.nodes.length}
              flagged={flaggedCount}
              contaminated={graph.meta.contaminatedCount}
              postNotice={postNoticeEdges}
              truncated={graph.meta.truncated}
              totalAvailable={graph.meta.totalAvailable}
            />

            <Tabs defaultValue="graph" className="flex min-h-0 flex-1 flex-col">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <TabsList className="border border-white/10 bg-black/40">
                  <TabsTrigger value="graph" className="data-[state=active]:bg-sky-600">
                    <Network className="mr-1.5 h-3.5 w-3.5" />
                    Graph
                  </TabsTrigger>
                  <TabsTrigger value="table" className="data-[state=active]:bg-sky-600">
                    <TableIcon className="mr-1.5 h-3.5 w-3.5" />
                    Table
                  </TabsTrigger>
                </TabsList>

                <div className="flex items-center gap-2">
                  <LayoutPicker value={layout} onChange={setLayout} />
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-400">
                      <input
                        type="checkbox"
                        checked={focusMode}
                        onChange={(e) => {
                          setFocusMode(e.target.checked);
                          if (e.target.checked) setTraceMode(false);
                        }}
                        className="accent-sky-500"
                      />
                      Focus selection
                    </label>
                    <label className={`flex cursor-pointer items-center gap-1.5 text-xs ${selected ? 'text-amber-500' : 'text-slate-600'}`}>
                      <input
                        type="checkbox"
                        checked={traceMode}
                        onChange={(e) => {
                          setTraceMode(e.target.checked);
                          if (e.target.checked) setFocusMode(false);
                        }}
                        className="accent-amber-500"
                        disabled={!selected}
                      />
                      Trace to Source
                    </label>
                  </div>
              </div>

              <TabsContent
                value="graph"
                className="m-0 min-h-0 flex-1 overflow-hidden rounded-lg border border-white/10 bg-black/40 data-[state=active]:flex"
              >
                <GraphCanvas
                  graph={graph}
                  layout={layout}
                  onSelect={setSelected}
                  selectedId={selected?.id ?? null}
                  focusMode={focusMode}
                  traceMode={traceMode}
                />
              </TabsContent>

              <TabsContent
                value="table"
                className="m-0 min-h-0 flex-1 overflow-hidden rounded-lg border border-white/10 bg-black/40 data-[state=active]:flex"
              >
                <PaperTable
                  nodes={graph.nodes}
                  rootId={graph.root.id}
                  onSelect={setSelected}
                />
              </TabsContent>
            </Tabs>
          </>
        ) : null}
      </main>

      <PaperDetail
        key={selected?.id ?? 'none'}
        paper={selected}
        open={selected !== null}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function PaperHeader({ paper }: { paper: PaperNode }) {
  const status = STATUS[paper.status];

  return (
    <div className="shrink-0 border-b border-white/10 bg-black/20 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-balance text-lg font-semibold leading-snug text-slate-100">
            {paper.title ?? 'Untitled'}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            {paper.authors.length > 0 && (
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {paper.authors.slice(0, 3).map((a) => a.name).join(', ')}
                {paper.authors.length > 3 && ` +${paper.authors.length - 3}`}
              </span>
            )}
            {paper.venue && <span className="italic">{paper.venue}</span>}
            {paper.publicationYear && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {paper.publicationYear}
              </span>
            )}
            <span>{paper.citedByCount.toLocaleString()} citations</span>
            {paper.doi && (
              <a
                href={`https://doi.org/${paper.doi}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-sky-400 hover:text-sky-300"
              >
                doi.org <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge className={`border ${status.badge}`}>{status.label}</Badge>
          {paper.retraction?.noticeDate && (
            <span className="text-[11px] text-slate-500">
              Notice {paper.retraction.noticeDate}
            </span>
          )}
        </div>
      </div>

      {paper.status !== 'clean' && (
        <div className="mt-2.5 flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            {status.description}
            {paper.retraction?.reasons.length ? (
              <> Stated reason: {paper.retraction.reasons.join('; ')}.</>
            ) : null}{' '}
            A retraction is not by itself evidence of misconduct — many are issued for
            honest error or at the authors&apos; own request.
            {paper.retraction?.noticeUrl && (
              <>
                {' '}
                <a
                  href={paper.retraction.noticeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-amber-100"
                >
                  Read the notice
                </a>
                .
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

function StatBar({
  total, flagged, contaminated, postNotice, truncated, totalAvailable,
}: {
  total: number; flagged: number; contaminated: number;
  postNotice: number; truncated: boolean; totalAvailable: number | null;
}) {
  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      <Stat label="Papers shown" value={total} />
      <Stat label="Flagged" value={flagged} tone={flagged > 0 ? 'danger' : 'muted'} />
      <Stat label="Carrying contamination" value={contaminated} tone={contaminated > 0 ? 'warn' : 'muted'} />
      <Stat
        label="Cited after notice"
        value={postNotice}
        tone={postNotice > 0 ? 'danger' : 'muted'}
        hint="Citations made after the cited paper was publicly flagged"
      />
      {truncated && totalAvailable !== null && (
        <div className="flex items-center gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          Showing the {total} highest-scoring of {totalAvailable.toLocaleString()} — raise the
          limit in Filters to see more.
        </div>
      )}
    </div>
  );
}

function Stat({
  label, value, tone = 'muted', hint,
}: {
  label: string; value: number; tone?: 'muted' | 'warn' | 'danger'; hint?: string;
}) {
  const tones = {
    muted: 'text-slate-300 border-white/10',
    warn: 'text-amber-300 border-amber-500/25',
    danger: 'text-rose-300 border-rose-500/25',
  };
  return (
    <div
      className={`flex items-center gap-2 rounded-md border bg-black/40 px-3 py-1.5 ${tones[tone]}`}
      title={hint}
    >
      <span className="text-xs text-slate-400">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value.toLocaleString()}</span>
    </div>
  );
}

function LayoutPicker({
  value, onChange,
}: { value: LayoutMode; onChange: (v: LayoutMode) => void }) {
  const options: { value: LayoutMode; label: string; hint: string }[] = [
    { value: 'timeline', label: 'Timeline', hint: 'Vertical position is publication year' },
    { value: 'hierarchy', label: 'Hierarchy', hint: 'Layered by citation depth' },
    { value: 'organic', label: 'Organic', hint: 'Force-directed clustering' },
  ];

  return (
    <div className="flex rounded-md border border-white/10 bg-black/40 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          title={option.hint}
          className={`rounded px-2.5 py-1 text-xs transition-colors ${
            value === option.value
              ? 'bg-sky-600 text-white'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function FilterBar({
  filters, onChange, onReset,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-end gap-4 border-b border-white/10 bg-black/40 px-4 py-3 text-xs">
      <Field label="Direction" hint="Downstream shows papers affected by this one">
        <select
          value={filters.direction}
          onChange={(e) => onChange({ ...filters, direction: e.target.value as TraversalDirection })}
          className="rounded border border-white/10 bg-black/60 px-2 py-1 text-slate-200"
        >
          <option value="downstream">Downstream (affected by)</option>
          <option value="upstream">Upstream (relies on)</option>
          <option value="both">Both</option>
        </select>
      </Field>

      <Field label="Depth" hint="Citation generations to traverse">
        <select
          value={filters.depth}
          onChange={(e) => onChange({ ...filters, depth: Number(e.target.value) })}
          className="rounded border border-white/10 bg-black/60 px-2 py-1 text-slate-200"
        >
          <option value={1}>1 generation</option>
          <option value={2}>2 generations</option>
          <option value={3}>3 generations</option>
        </select>
      </Field>

      <Field label="Max papers" hint="Highest-scoring are kept when truncating">
        <select
          value={filters.limit}
          onChange={(e) => onChange({ ...filters, limit: Number(e.target.value) })}
          className="rounded border border-white/10 bg-black/60 px-2 py-1 text-slate-200"
        >
          {[100, 250, 400, 600].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </Field>

      <Field label={`Min score: ${filters.minScore}`} hint="Hide papers below this contamination score">
        <input
          type="range"
          min={0}
          max={90}
          step={5}
          value={filters.minScore}
          onChange={(e) => onChange({ ...filters, minScore: Number(e.target.value) })}
          className="w-28 accent-sky-500"
        />
      </Field>

      <Field label="Status">
        <div className="flex gap-2">
          {(['retracted', 'concerned', 'clean'] as const).map((status) => (
            <label key={status} className="flex cursor-pointer items-center gap-1 text-slate-300">
              <input
                type="checkbox"
                checked={filters.statuses.includes(status)}
                onChange={(e) =>
                  onChange({
                    ...filters,
                    statuses: e.target.checked
                      ? [...filters.statuses, status]
                      : filters.statuses.filter((s) => s !== status),
                  })
                }
                className="accent-sky-500"
              />
              {STATUS[status].label}
            </label>
          ))}
        </div>
      </Field>

      <button onClick={onReset} className="ml-auto text-slate-400 underline hover:text-slate-200">
        Reset
      </button>
    </div>
  );
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1" title={hint}>
      <span className="text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </div>
  );
}

function ExportMenu({
  onSelect, disabled,
}: { onSelect: (f: ExportFormat) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="border-white/10 bg-black/40 text-slate-300 hover:bg-white/10"
      >
        <Download className="mr-1.5 h-3.5 w-3.5" />
        Export
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-md border border-white/10 bg-slate-950 shadow-xl">
            {(Object.keys(EXPORT_META) as ExportFormat[]).map((format) => (
              <button
                key={format}
                onClick={() => { onSelect(format); setOpen(false); }}
                className="block w-full px-3 py-2 text-left text-xs text-slate-300 hover:bg-white/5"
              >
                {EXPORT_META[format].label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PaperTable({
  nodes, rootId, onSelect,
}: { nodes: PaperNode[]; rootId: string; onSelect: (p: PaperNode) => void }) {
  const [sortKey, setSortKey] = useState<'score' | 'year' | 'citations'>('score');

  const sorted = useMemo(() => {
    const copy = [...nodes];
    copy.sort((a, b) => {
      if (a.id === rootId) return -1;
      if (b.id === rootId) return 1;
      switch (sortKey) {
        case 'year': return (b.publicationYear ?? 0) - (a.publicationYear ?? 0);
        case 'citations': return b.citedByCount - a.citedByCount;
        default:
          return (b.contamination?.score ?? 0) - (a.contamination?.score ?? 0);
      }
    });
    return copy;
  }, [nodes, rootId, sortKey]);

  return (
    <div className="w-full overflow-auto">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-slate-950">
          <TableRow className="border-white/10 hover:bg-transparent">
            <TableHead className="w-40 text-slate-300">Status</TableHead>
            <TableHead className="text-slate-300">Title</TableHead>
            <TableHead
              className="w-24 cursor-pointer text-right text-slate-300 hover:text-white"
              onClick={() => setSortKey('year')}
            >
              Year {sortKey === 'year' && '▾'}
            </TableHead>
            <TableHead
              className="w-28 cursor-pointer text-right text-slate-300 hover:text-white"
              onClick={() => setSortKey('citations')}
            >
              Cited by {sortKey === 'citations' && '▾'}
            </TableHead>
            <TableHead
              className="w-28 cursor-pointer text-right text-slate-300 hover:text-white"
              onClick={() => setSortKey('score')}
            >
              Score {sortKey === 'score' && '▾'}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((node) => {
            const band = BAND[bandFor(node.contamination)];
            return (
              <TableRow
                key={node.id}
                onClick={() => onSelect(node)}
                className={`cursor-pointer border-white/5 transition-colors hover:bg-white/5 ${
                  node.id === rootId ? 'bg-sky-500/5' : ''
                }`}
              >
                <TableCell>
                  <Badge className={`border text-[11px] ${STATUS[node.status].badge}`}>
                    {STATUS[node.status].label}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-xl">
                  <span className="line-clamp-2 text-slate-200">{node.title ?? node.doi ?? node.id}</span>
                  {node.venue && <span className="text-xs text-slate-500">{node.venue}</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums text-slate-400">
                  {node.publicationYear ?? '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums text-slate-400">
                  {node.citedByCount.toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  <span
                    className={`inline-block rounded border px-2 py-0.5 text-xs tabular-nums ${band.badge}`}
                    title={explainScore(node.contamination)}
                  >
                    {formatScore(node.contamination)}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
      <p className="text-sm text-slate-400">Tracing citation paths…</p>
      <p className="max-w-sm text-center text-xs text-slate-600">
        If this paper is new to Geiger it is being fetched from OpenAlex, which can take
        a few seconds.
      </p>
    </div>
  );
}

function ErrorState({
  error, onRetry,
}: { error: { message: string; hint?: string }; onRetry: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Card className="max-w-md border-rose-500/20 bg-rose-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-rose-300">
            <AlertTriangle className="h-5 w-5" />
            {error.message}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {error.hint && <p className="text-sm text-slate-400">{error.hint}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={onRetry}>Try again</Button>
            <Link href="/">
              <Button size="sm" variant="outline" className="border-white/10">
                Search for another paper
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
