'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, GitBranch, Loader2, ShieldAlert, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { BAND, STATUS, bandFor, explainScore, formatScore } from '@/lib/ui/presentation';
import type { ContaminationPath, PaperNode } from '@/lib/types';

interface PaperDetailProps {
  paper: PaperNode | null;
  open: boolean;
  onClose: () => void;
}

/**
 * The "why" panel.
 *
 * A contamination score that cannot be interrogated is a number nobody should
 * act on, so this panel exists to answer the only question that matters after
 * seeing one: *what exactly connects this paper to retracted work?* It fetches
 * the actual citation chains on demand and lists them hop by hop.
 */
export function PaperDetail({ paper, open, onClose }: PaperDetailProps) {
  // Worth asking only when there is actually something to explain.
  const explainable =
    paper?.doi != null &&
    open &&
    (paper.contamination?.score ?? 0) > 0 &&
    paper.contamination?.minHops !== 0;

  // Seeded from the initial render rather than reset in an effect. The parent
  // keys this component by paper id, so selecting a different paper remounts
  // it and the state resets naturally.
  const [paths, setPaths] = useState<ContaminationPath[] | null>(null);
  const [loadingPaths, setLoadingPaths] = useState(explainable);

  useEffect(() => {
    if (!explainable || !paper?.doi) return;

    let cancelled = false;

    fetch(`/api/paths/${encodeURIComponent(paper.doi)}?limit=10`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!cancelled && body?.paths) setPaths(body.paths as ContaminationPath[]);
      })
      .catch(() => { /* the panel degrades to score-only */ })
      .finally(() => { if (!cancelled) setLoadingPaths(false); });

    return () => { cancelled = true; };
  }, [explainable, paper?.doi]);

  if (!open || !paper) return null;

  const status = STATUS[paper.status];
  const band = BAND[bandFor(paper.contamination)];

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-white/10 bg-slate-950/95 backdrop-blur-xl"
        role="dialog"
        aria-label="Paper details"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 p-4">
          <div className="min-w-0">
            <Badge className={`mb-2 border ${status.badge}`}>{status.label}</Badge>
            <h2 className="text-balance text-base font-semibold leading-snug text-slate-100">
              {paper.title ?? 'Untitled'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded p-1 text-slate-500 hover:bg-white/5 hover:text-slate-300"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          <section className="space-y-1.5 text-sm">
            {paper.authors.length > 0 && (
              <Row label="Authors">
                {paper.authors.map((a) => a.name).join(', ')}
              </Row>
            )}
            {paper.venue && <Row label="Published in">{paper.venue}</Row>}
            {(paper.publicationDate || paper.publicationYear) && (
              <Row label="Date">{paper.publicationDate ?? paper.publicationYear}</Row>
            )}
            <Row label="Cited by">{paper.citedByCount.toLocaleString()} works</Row>
            <Row label="References">{paper.referencedCount} works</Row>
            {paper.doi && (
              <Row label="DOI">
                <a
                  href={`https://doi.org/${paper.doi}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 break-all text-sky-400 hover:text-sky-300"
                >
                  {paper.doi}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              </Row>
            )}
          </section>

          {paper.status !== 'clean' && paper.retraction && (
            <section className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-rose-300">
                <ShieldAlert className="h-4 w-4" />
                Integrity notice
              </h3>
              <dl className="space-y-1 text-xs text-slate-300">
                {paper.retraction.noticeDate && (
                  <Row label="Notice date" small>{paper.retraction.noticeDate}</Row>
                )}
                {paper.retraction.nature && (
                  <Row label="Type" small>{paper.retraction.nature.replace(/_/g, ' ')}</Row>
                )}
                {paper.retraction.reasons.length > 0 && (
                  <Row label="Reason" small>{paper.retraction.reasons.join('; ')}</Row>
                )}
                {paper.retraction.source && (
                  <Row label="Source" small>{paper.retraction.source}</Row>
                )}
              </dl>
              {paper.retraction.noticeUrl && (
                <a
                  href={paper.retraction.noticeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-rose-300 underline hover:text-rose-200"
                >
                  Read the notice <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <p className="mt-2 border-t border-rose-500/15 pt-2 text-[11px] leading-relaxed text-slate-400">
                Retractions are issued for many reasons, including honest error and
                author-initiated withdrawal. Read the notice before drawing conclusions.
              </p>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-sm font-medium text-slate-300">Contamination</h3>
            <div className={`rounded-lg border p-3 ${band.badge}`}>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-semibold tabular-nums">
                  {formatScore(paper.contamination)}
                </span>
                <span className="text-xs font-medium uppercase tracking-wide">
                  {band.label}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed opacity-90">
                {explainScore(paper.contamination)}
              </p>
            </div>

            {paper.contamination && (
              <dl className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
                <Metric label="Direct flagged citations" value={paper.contamination.directHits} />
                <Metric label="Post-notice citations" value={paper.contamination.postRetractionCitations} />
                <Metric
                  label="Nearest flagged work"
                  value={paper.contamination.minHops === null
                    ? '—'
                    : paper.contamination.minHops === 0
                      ? 'this paper'
                      : `${paper.contamination.minHops} step${paper.contamination.minHops === 1 ? '' : 's'}`}
                />
                <Metric label="Flagged sources upstream" value={paper.contamination.totalUpstreamRetractions} />
              </dl>
            )}

            {paper.contamination?.version && (
              <p className="mt-2 font-mono text-[10px] text-slate-600">
                model {paper.contamination.version}
                {paper.contamination.computedAt &&
                  ` · computed ${paper.contamination.computedAt.slice(0, 10)}`}
              </p>
            )}
          </section>

          {(loadingPaths || (paths && paths.length > 0)) && (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-300">
                <GitBranch className="h-4 w-4" />
                How it connects
              </h3>

              {loadingPaths ? (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Tracing citation chains…
                </div>
              ) : (
                <ol className="space-y-2">
                  {paths!.map((path, index) => (
                    <li
                      key={index}
                      className="rounded-md border border-white/10 bg-black/40 p-2.5 text-xs"
                    >
                      <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-500">
                        <span>
                          {path.hops} citation step{path.hops === 1 ? '' : 's'}
                        </span>
                        {path.postRetraction && (
                          <span className="text-rose-400">cited after the notice</span>
                        )}
                      </div>
                      <ol className="space-y-1">
                        {path.nodes.map((node, i) => (
                          <li key={node.id} className="flex gap-2">
                            <span className="shrink-0 text-slate-600">
                              {i === 0 ? '▲' : i === path.nodes.length - 1 ? '▼' : '│'}
                            </span>
                            <span
                              className={
                                node.status !== 'clean' ? 'text-rose-300' : 'text-slate-400'
                              }
                            >
                              {(node.title ?? node.doi ?? node.id).slice(0, 80)}
                              {node.publicationYear ? ` (${node.publicationYear})` : ''}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          {paper.concepts.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-sm font-medium text-slate-300">Topics</h3>
              <div className="flex flex-wrap gap-1">
                {paper.concepts.slice(0, 8).map((concept) => (
                  <span
                    key={concept}
                    className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px] text-slate-400"
                  >
                    {concept}
                  </span>
                ))}
              </div>
            </section>
          )}

          {paper.doi && (
            <Link
              href={`/paper/${encodeURIComponent(paper.doi)}`}
              className="block rounded-md border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-center text-sm text-sky-300 hover:bg-sky-500/15"
            >
              Explore this paper&apos;s own graph
            </Link>
          )}

          <p className="border-t border-white/10 pt-3 text-[11px] leading-relaxed text-slate-600">
            Data from OpenAlex and Crossref/Retraction Watch
            {paper.fetchedAt ? `, retrieved ${paper.fetchedAt.slice(0, 10)}` : ''}.
            Coverage is partial — absence of a flag is not proof a paper is sound.
          </p>
        </div>
      </aside>
    </>
  );
}

function Row({
  label, children, small,
}: { label: string; children: React.ReactNode; small?: boolean }) {
  return (
    <div className={`flex gap-2 ${small ? 'text-xs' : 'text-sm'}`}>
      <span className="w-28 shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 flex-1 text-slate-300">{children}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-white/10 bg-black/30 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-sm tabular-nums text-slate-200">{value}</div>
    </div>
  );
}
