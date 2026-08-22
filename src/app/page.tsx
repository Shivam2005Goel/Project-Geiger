import Link from 'next/link';
import { BookOpen, FileSearch, GitBranch, ScrollText } from 'lucide-react';

import { SearchBox } from '@/components/search-box';
import { getStats } from '@/lib/db/queries/search';
import { getMostContaminated } from '@/lib/db/queries/paper';
import { BAND, bandFor, formatScore } from '@/lib/ui/presentation';

// The corpus changes only when the pipeline runs, so the landing page is
// statically regenerated rather than rebuilt per request.
export const revalidate = 600;

export default async function Home() {
  // A landing page must render even when the database is unreachable: an
  // outage should not present as a broken site.
  const [stats, worst] = await Promise.all([
    getStats().catch(() => null),
    getMostContaminated(5).catch(() => []),
  ]);

  return (
    <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-14 px-6 py-16">
      <section className="flex flex-col items-center gap-6 pt-8 text-center">
        <span className="rounded-full border border-sky-500/25 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">
          Research integrity tooling
        </span>

        <h1 className="text-balance text-4xl font-bold tracking-tight text-slate-50 md:text-5xl">
          Does your bibliography rest on retracted work?
        </h1>

        <p className="max-w-2xl text-pretty text-lg text-slate-400">
          Geiger traces citations forward from retracted and disputed papers to show what
          they contaminated — and how much of that happened after the retraction notice
          was published.
        </p>

        <div className="w-full max-w-2xl pt-2">
          <SearchBox autoFocus />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
          <Link
            href="/bibliography"
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-slate-200 transition-colors hover:bg-white/10"
          >
            <FileSearch className="h-4 w-4" />
            Check a reference list
          </Link>
          <Link
            href="/methods"
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-slate-400 transition-colors hover:text-slate-200"
          >
            <ScrollText className="h-4 w-4" />
            How the score works
          </Link>
        </div>
      </section>

      {stats && (
        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 md:grid-cols-4">
          <Stat label="Papers analysed" value={stats.papers.toLocaleString()} />
          <Stat label="Citations mapped" value={stats.citations.toLocaleString()} />
          <Stat
            label="Flagged papers"
            value={(stats.retracted + stats.concerned).toLocaleString()}
            tone="danger"
          />
          <Stat
            label="Carrying contamination"
            value={stats.contaminated.toLocaleString()}
            tone="warn"
          />
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <Feature
          icon={<GitBranch className="h-5 w-5" />}
          title="Every score is explained"
          body="Click any paper to see the exact citation chains linking it to retracted work, hop by hop. A number you cannot interrogate is a number you should not act on."
        />
        <Feature
          icon={<BookOpen className="h-5 w-5" />}
          title="Timing is the signal"
          body="A paper citing work retracted years later was acting in good faith. One citing it afterwards is a live problem. Geiger weighs those differently and shows you which is which."
        />
        <Feature
          icon={<FileSearch className="h-5 w-5" />}
          title="Bulk reference checks"
          body="Upload a .bib, .ris or pasted reference list and get every entry checked — including references that are clean themselves but rest on flagged work."
        />
      </section>

      {worst.length > 0 && (
        <section>
          <h2 className="mb-1 text-lg font-semibold text-slate-200">
            Most affected papers in the corpus
          </h2>
          <p className="mb-4 text-sm text-slate-500">
            Ranked by contamination score. These papers are not accused of anything — they
            cite work that was later retracted.
          </p>

          <ul className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/10 bg-black/30">
            {worst.map((paper) => {
              const band = BAND[bandFor(paper.contamination)];
              return (
                <li key={paper.id}>
                  <Link
                    href={paper.doi ? `/paper/${encodeURIComponent(paper.doi)}` : '#'}
                    className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-white/5"
                  >
                    <span
                      className={`shrink-0 rounded border px-2 py-1 text-xs tabular-nums ${band.badge}`}
                    >
                      {formatScore(paper.contamination)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-sm text-slate-200">
                        {paper.title ?? paper.doi}
                      </span>
                      <span className="text-xs text-slate-500">
                        {paper.publicationYear ?? '—'}
                        {paper.venue ? ` · ${paper.venue}` : ''}
                        {paper.contamination?.postRetractionCitations
                          ? ` · ${paper.contamination.postRetractionCitations} post-notice citation${
                              paper.contamination.postRetractionCitations === 1 ? '' : 's'
                            }`
                          : ''}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <footer className="border-t border-white/10 pt-6 text-xs leading-relaxed text-slate-600">
        <p className="mb-2">
          Data from <a href="https://openalex.org" className="text-slate-500 hover:text-slate-400">OpenAlex</a> (CC0)
          and the <a href="https://www.crossref.org" className="text-slate-500 hover:text-slate-400">Crossref</a>/
          Retraction Watch retraction database (CC0).
          {stats?.lastIngestAt && ` Corpus last updated ${stats.lastIngestAt.slice(0, 10)}.`}
          {stats && ` Model ${stats.scoreVersion}.`}
        </p>
        <p>
          Coverage is partial: the absence of a flag is not evidence a paper is sound, and a
          retraction is not by itself evidence of misconduct. See{' '}
          <Link href="/methods" className="text-slate-500 underline hover:text-slate-400">
            methods and limitations
          </Link>{' '}
          before citing these results.
        </p>
      </footer>
    </main>
  );
}

function Stat({
  label, value, tone = 'default',
}: { label: string; value: string; tone?: 'default' | 'warn' | 'danger' }) {
  const tones = {
    default: 'text-slate-100',
    warn: 'text-amber-300',
    danger: 'text-rose-300',
  };
  return (
    <div className="bg-slate-950 px-4 py-4">
      <div className={`text-2xl font-semibold tabular-nums ${tones[tone]}`}>{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{label}</div>
    </div>
  );
}

function Feature({
  icon, title, body,
}: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-5">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-sky-500/20 bg-sky-500/10 text-sky-400">
        {icon}
      </div>
      <h3 className="mb-1.5 font-medium text-slate-200">{title}</h3>
      <p className="text-sm leading-relaxed text-slate-400">{body}</p>
    </div>
  );
}
