'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Download, FileSearch,
  Loader2, Upload, XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { STATUS } from '@/lib/ui/presentation';
import { csvCell } from '@/lib/export/formats';
import type { BibliographyFinding, BibliographyReport } from '@/lib/types';

interface Report extends BibliographyReport {
  input: {
    detectedFormat: string;
    entriesParsed: number;
    entriesWithoutDoi: number;
    truncated: boolean;
    deepCheck: boolean;
  };
}

const SAMPLE = `10.1038/nature04533
10.1016/j.cell.2006.02.015
10.1126/science.1074069
Lesné S, et al. A specific amyloid-beta protein assembly in the brain impairs memory. Nature. 2006. doi:10.1038/nature04533`;

/**
 * The bibliography checker.
 *
 * The question this answers — "is there a retracted paper in my reference
 * list?" — is the one researchers actually have, and it is the reason to come
 * back. Everything is optimised around making the answer trustworthy: entries
 * that could not be resolved are reported as unresolved rather than quietly
 * counted as clean.
 */
export default function BibliographyPage() {
  const [text, setText] = useState('');
  const [deep, setDeep] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const check = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setReport(null);

    try {
      const response = await fetch('/api/bibliography', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, deep }),
      });
      const body = await response.json();

      if (!response.ok) {
        setError({ message: body.error ?? 'Check failed', hint: body.hint });
        return;
      }
      setReport(body as Report);
    } catch {
      setError({ message: 'Could not reach the server', hint: 'Check your connection.' });
    } finally {
      setLoading(false);
    }
  };

  const onFile = async (file: File) => {
    // 5 MB guard mirrors the server limit so a huge file fails locally and fast.
    if (file.size > 5_000_000) {
      setError({ message: 'That file is too large', hint: 'Split it into files under 5 MB.' });
      return;
    }
    setText(await file.text());
  };

  const downloadReport = () => {
    if (!report) return;
    const headers = [
      'input', 'doi', 'resolved', 'status', 'contamination_score',
      'flagged_references', 'note', 'title',
    ];
    const rows = report.findings.map((f) => [
      f.input.replace(/\s+/g, ' ').slice(0, 200),
      f.doi ?? '',
      f.resolved,
      f.status,
      f.contaminationScore ?? '',
      f.inheritedFrom.map((r) => r.doi ?? r.id).join('; '),
      f.note ?? '',
      f.paper?.title ?? '',
    ]);
    const csv = [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `geiger-bibliography-report-${report.generatedAt.slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="relative z-10 mx-auto w-full max-w-5xl px-6 py-10">
      <Link
        href="/"
        className="mb-6 inline-flex items-center text-sm text-slate-400 transition-colors hover:text-white"
      >
        <ArrowLeft className="mr-1.5 h-4 w-4" />
        Geiger
      </Link>

      <header className="mb-8">
        <h1 className="text-balance text-3xl font-bold tracking-tight text-slate-50">
          Check a reference list
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-slate-400">
          Paste a bibliography or upload a <code className="text-slate-300">.bib</code> or{' '}
          <code className="text-slate-300">.ris</code> file. Geiger reports which references
          are retracted or under concern, and which are clean themselves but rest on flagged
          work.
        </p>
      </header>

      <section className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            className="border-white/15 bg-black/40 text-slate-300 hover:bg-white/10"
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Upload file
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".bib,.ris,.txt,.csv,text/plain"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
          <button
            onClick={() => setText(SAMPLE)}
            className="text-xs text-slate-500 underline hover:text-slate-300"
          >
            Use a sample
          </button>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          placeholder="Paste BibTeX, RIS, a list of DOIs, or a reference list copied from a manuscript…"
          className="w-full rounded-lg border border-white/15 bg-black/50 p-4 font-mono text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-sky-500/60 focus:ring-2 focus:ring-sky-500/20"
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-400">
            <input
              type="checkbox"
              checked={deep}
              onChange={(e) => setDeep(e.target.checked)}
              className="mt-0.5 accent-sky-500"
            />
            <span>
              Deep check
              <span className="block text-xs text-slate-600">
                Look up references we do not already hold, against OpenAlex and Crossref.
                Much slower, but far fewer unresolved entries.
              </span>
            </span>
          </label>

          <Button onClick={check} disabled={loading || !text.trim()}>
            {loading ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Checking…
              </>
            ) : (
              <>
                <FileSearch className="mr-1.5 h-4 w-4" />
                Check references
              </>
            )}
          </Button>
        </div>
      </section>

      {error && (
        <div className="mb-6 rounded-lg border border-rose-500/25 bg-rose-500/10 p-4">
          <p className="font-medium text-rose-300">{error.message}</p>
          {error.hint && <p className="mt-1 text-sm text-slate-400">{error.hint}</p>}
        </div>
      )}

      {report && <ReportView report={report} onDownload={downloadReport} />}
    </main>
  );
}

function ReportView({ report, onDownload }: { report: Report; onDownload: () => void }) {
  const [filter, setFilter] = useState<'all' | 'problems' | 'unresolved'>('problems');

  const problems = report.findings.filter(
    (f) => f.status !== 'clean' || f.inheritedFrom.length > 0,
  );
  const unresolved = report.findings.filter((f) => !f.resolved);

  const shown =
    filter === 'problems' ? problems : filter === 'unresolved' ? unresolved : report.findings;

  const { summary } = report;
  const hasProblems = problems.length > 0;

  return (
    <section className="space-y-5">
      <div
        className={`rounded-xl border p-5 ${
          hasProblems
            ? 'border-rose-500/25 bg-rose-500/5'
            : 'border-emerald-500/25 bg-emerald-500/5'
        }`}
      >
        <div className="flex items-start gap-3">
          {hasProblems ? (
            <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-rose-400" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-400" />
          )}
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-slate-100">
              {hasProblems
                ? `${problems.length} of ${summary.total} references need attention`
                : `No flagged references found among ${summary.resolved} checked`}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {summary.retracted > 0 && `${summary.retracted} retracted. `}
              {summary.concerned > 0 && `${summary.concerned} under expression of concern. `}
              {summary.contaminated > 0 &&
                `${summary.contaminated} cite flagged work themselves. `}
              {summary.unresolved > 0 && (
                <span className="text-amber-400">
                  {summary.unresolved} could not be checked
                  {report.input.deepCheck ? '' : ' — try a deep check'}.
                </span>
              )}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onDownload}
            className="shrink-0 border-white/15 bg-black/40 text-slate-300 hover:bg-white/10"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            CSV
          </Button>
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-2 md:grid-cols-6">
          <Tile label="Total" value={summary.total} />
          <Tile label="Retracted" value={summary.retracted} tone="danger" />
          <Tile label="Concern" value={summary.concerned} tone="warn" />
          <Tile label="Rest on flagged" value={summary.contaminated} tone="warn" />
          <Tile label="Clean" value={summary.clean} tone="ok" />
          <Tile label="Unresolved" value={summary.unresolved} tone="muted" />
        </dl>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {([
          ['problems', `Needs attention (${problems.length})`],
          ['unresolved', `Unresolved (${unresolved.length})`],
          ['all', `All (${report.findings.length})`],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`rounded-md border px-3 py-1.5 transition-colors ${
              filter === value
                ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                : 'border-white/10 text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-600">
          Detected {report.input.detectedFormat} · {report.input.entriesParsed} entries
          {report.input.entriesWithoutDoi > 0 &&
            ` · ${report.input.entriesWithoutDoi} without a DOI`}
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-white/10 bg-black/30 p-6 text-center text-sm text-slate-500">
          Nothing in this category.
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((finding, index) => (
            <FindingRow key={`${finding.doi ?? 'x'}-${index}`} finding={finding} />
          ))}
        </ul>
      )}

      <p className="border-t border-white/10 pt-4 text-xs leading-relaxed text-slate-600">
        Report generated {report.generatedAt.slice(0, 19).replace('T', ' ')} UTC using model{' '}
        {report.scoreVersion}. Coverage is partial — a reference not flagged here has not
        been proven sound. Always read a retraction notice before drawing conclusions about
        the work or its authors.
      </p>
    </section>
  );
}

function FindingRow({ finding }: { finding: BibliographyFinding }) {
  const flagged = finding.status !== 'clean';
  const inherits = finding.inheritedFrom.length > 0;

  return (
    <li
      className={`rounded-lg border p-3.5 ${
        flagged
          ? 'border-rose-500/25 bg-rose-500/5'
          : inherits
            ? 'border-amber-500/20 bg-amber-500/5'
            : !finding.resolved
              ? 'border-white/10 bg-black/20'
              : 'border-white/10 bg-black/30'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">
          {flagged ? (
            <XCircle className="h-4 w-4 text-rose-400" />
          ) : inherits ? (
            <AlertTriangle className="h-4 w-4 text-amber-400" />
          ) : !finding.resolved ? (
            <span className="block h-4 w-4 rounded-full border border-slate-600" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-500/70" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-sm text-slate-200">
              {finding.paper?.title ?? finding.input}
            </p>
            {flagged && (
              <Badge className={`shrink-0 border ${STATUS[finding.status].badge}`}>
                {STATUS[finding.status].label}
              </Badge>
            )}
          </div>

          {finding.doi && (
            <a
              href={`https://doi.org/${finding.doi}`}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 block font-mono text-xs text-sky-400/80 hover:text-sky-300"
            >
              {finding.doi}
            </a>
          )}

          {finding.note && (
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{finding.note}</p>
          )}

          {inherits && (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-xs text-amber-400/80 hover:text-amber-300">
                Flagged references it relies on ({finding.inheritedFrom.length})
              </summary>
              <ul className="mt-1 space-y-0.5 pl-3">
                {finding.inheritedFrom.map((ref) => (
                  <li key={ref.id} className="text-xs text-slate-500">
                    {ref.title ?? ref.doi ?? ref.id}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {finding.doi && finding.resolved && (
            <Link
              href={`/paper/${encodeURIComponent(finding.doi)}`}
              className="mt-1.5 inline-block text-xs text-slate-500 underline hover:text-slate-300"
            >
              View citation graph
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}

function Tile({
  label, value, tone = 'default',
}: {
  label: string; value: number;
  tone?: 'default' | 'warn' | 'danger' | 'ok' | 'muted';
}) {
  const tones = {
    default: 'text-slate-200',
    warn: 'text-amber-300',
    danger: 'text-rose-300',
    ok: 'text-emerald-300',
    muted: 'text-slate-500',
  };
  return (
    <div className="rounded-md border border-white/10 bg-black/30 px-2.5 py-2">
      <div className={`text-lg font-semibold tabular-nums ${tones[tone]}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}
