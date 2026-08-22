import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { SCORE_VERSION, scoring } from '@/lib/config';
import { getStats } from '@/lib/db/queries/search';
import { retractionCoverage } from '@/lib/ingest/enrich';

export const revalidate = 600;

export const metadata = {
  title: 'Methods — Project Geiger',
  description: 'How Geiger computes contamination scores, and what the method cannot see.',
};

/**
 * The methods page.
 *
 * This is what converts a plausible-looking visualisation into something a
 * researcher is willing to cite. It states the formula, the coefficients
 * actually in force, the data sources and their licences, and — at least as
 * importantly — what the method cannot see.
 */
export default async function MethodsPage() {
  const [stats, coverage] = await Promise.all([
    getStats().catch(() => null),
    retractionCoverage().catch(() => null),
  ]);

  return (
    <main className="relative z-10 mx-auto w-full max-w-3xl px-6 py-10">
      <Link
        href="/"
        className="mb-6 inline-flex items-center text-sm text-slate-400 transition-colors hover:text-white"
      >
        <ArrowLeft className="mr-1.5 h-4 w-4" />
        Geiger
      </Link>

      <article className="space-y-10">
        <header>
          <h1 className="text-balance text-3xl font-bold tracking-tight text-slate-50">
            Methods and limitations
          </h1>
          <p className="mt-2 text-pretty text-slate-400">
            Model version <code className="text-slate-300">{SCORE_VERSION}</code>
            {stats?.lastIngestAt && ` · corpus last updated ${stats.lastIngestAt.slice(0, 10)}`}
          </p>
        </header>

        <Section title="What the score measures">
          <p>
            The contamination score estimates how much a paper&apos;s evidential base depends
            on work that has since been retracted or formally questioned. It is a property
            of a <em>paper&apos;s citation neighbourhood</em>, not a judgement of its authors,
            and it is not a claim that the paper is wrong.
          </p>
          <p>
            Dose flows backwards along citations from flagged papers to the papers that cite
            them, decaying with each generation:
          </p>
          <Formula>
            score(p) = normalise( Σ<sub>r</sub> severity(r) · w<sub>time</sub>(p,r) ·
            w<sub>reliance</sub>(p) · w<sub>intent</sub>(p) · decay<sup>hops−1</sup> )
          </Formula>
        </Section>

        <Section title="The four weights">
          <Term
            name="Timing"
            body={`The most defensible signal available. A paper published before a retraction notice could not have known; one published after it either missed the notice or ignored it. Post-notice citations carry weight ${scoring.weightPostRetraction}, pre-notice ${scoring.weightPreRetraction}, and cases where the ordering cannot be established ${scoring.weightUnknownTiming}. Same-year comparisons count as unknown rather than being guessed.`}
          />
          <Term
            name="Reliance"
            body={`Citing a retracted work among eight references is a different act from citing it among three hundred. Above a baseline of ${scoring.referenceBaseline} references the weight falls off as baseline ÷ reference count, so it always sits between 0 and 1.`}
          />
          <Term
            name="Severity"
            body={`A full retraction emits dose ${scoring.sourceSeverity.retracted}; an expression of concern ${scoring.sourceSeverity.concerned}; a correction ${scoring.sourceSeverity.corrected}. The concern may not be upheld, so it should not count the same as a retraction.`}
          />
          <Term
            name="Intent"
            body={`A paper writing about a retraction is not contaminated by it. Where a paper looks like meta-research on research integrity, its citations are weighted at ${scoring.intentWeights.disputing} rather than 1. This is a metadata heuristic, described honestly below.`}
          />
          <p>
            Dose decays by a factor of {scoring.hopDecay} per citation step and propagation
            stops after {scoring.maxGenerations} generations. The accumulated dose is mapped
            onto 0–100 by a saturating curve, so a paper citing twenty retracted works does
            not score twenty times one that cites a single work — past a point, &ldquo;heavily
            affected&rdquo; is the whole message.
          </p>
          <p>
            A paper that is itself retracted is pinned to 100 and labelled a source rather
            than a recipient.
          </p>
        </Section>

        <Section title="Data sources">
          <ul className="space-y-2">
            <li>
              <strong className="text-slate-200">OpenAlex</strong> (CC0) — bibliographic
              metadata and the citation graph in both directions. The <code>cites:</code>{' '}
              filter is what makes forward traversal possible.
            </li>
            <li>
              <strong className="text-slate-200">Crossref / Retraction Watch</strong> (CC0
              since 2023) — retraction and expression-of-concern notices, with dates and
              reasons. OpenAlex carries a retraction flag but no dates, and the entire
              timing half of the model depends on them.
            </li>
          </ul>
          <p>
            Where sources disagree, Geiger keeps the <em>most severe</em> status asserted by
            any of them and dates it from the <em>earliest</em> notice of any kind. A source
            with no record is treated as silent, never as an all-clear.
          </p>
        </Section>

        <Section title="What this cannot see">
          <p className="text-amber-200/90">
            These limits are real and they matter more than the number does.
          </p>
          <ul className="space-y-2">
            <li>
              <strong className="text-slate-200">Coverage is partial.</strong> The corpus is
              built by crawling outward from seed papers under a budget, so the absence of a
              flag is never proof that a paper is sound.
              {stats && coverage && (
                <> Currently {stats.papers.toLocaleString()} papers, of which{' '}
                {coverage.flagged} are flagged and {coverage.withDates} have a notice date.</>
              )}
            </li>
            <li>
              <strong className="text-slate-200">Undated notices weaken the model.</strong>{' '}
              A flagged paper with no notice date forces every citation to it into the
              &ldquo;unknown timing&rdquo; bucket.
              {coverage && coverage.flagged > coverage.withDates && (
                <> {coverage.flagged - coverage.withDates} of {coverage.flagged} flagged papers
                are currently in that position.</>
              )}
            </li>
            <li>
              <strong className="text-slate-200">Intent detection is a heuristic.</strong> It
              reads titles, venues and subject classifications — not the citing sentence. It
              will miss a paper that discusses a retraction only in its body text, it is
              English-only, and it cannot tell which of several references a phrase refers
              to. A match reduces a score but never zeroes it.
            </li>
            <li>
              <strong className="text-slate-200">Sampling is bounded.</strong> Highly-cited
              papers have more citers than any crawl budget can hold. Geiger samples half by
              citation count and half by recency, so post-retraction citations are not
              systematically excluded — but a truncated neighbourhood is still a sample, and
              the interface says so when it truncates.
            </li>
            <li>
              <strong className="text-slate-200">Not all citations are equal.</strong>{' '}
              Without full text the model cannot tell a load-bearing citation from a passing
              reference in a literature review.
            </li>
          </ul>
        </Section>

        <Section title="Interpreting a result responsibly">
          <ul className="space-y-2">
            <li>
              A retraction is <strong className="text-slate-200">not</strong> an accusation of
              misconduct. A large share are issued for honest error, publisher mistakes, or at
              the authors&apos; own request. Always read the notice.
            </li>
            <li>
              Geiger scores papers and citation paths. It does not score people, and an
              author-level tally should not be inferred from it.
            </li>
            <li>
              A high score is a prompt to look, not a finding. The correct next step is to
              open the paper and check whether the retracted claim is actually load-bearing.
            </li>
            <li>
              If you believe a classification here is wrong, it probably is worth reporting —
              the underlying notices come from third-party databases and do occasionally
              mis-link.
            </li>
          </ul>
        </Section>

        <Section title="Reproducibility">
          <p>
            Every score is stamped with the model version that produced it, and every
            parameter above is read from configuration rather than hardcoded, so a run can be
            reproduced exactly. The current parameter set is served at{' '}
            <code className="text-slate-300">/api/stats</code> alongside the corpus counts.
          </p>
          <p>
            Scores are computed as a batch job over the whole graph after each ingest, not
            per request. Papers fetched on demand are scored against the fragment that was
            crawled and are marked{' '}
            <code className="text-slate-300">+fragment</code> in their version string; those
            are provisional until the next full run.
          </p>
        </Section>
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-xl font-semibold text-slate-100">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-slate-400 [&_li]:text-slate-400 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-4">
      <code className="whitespace-nowrap font-mono text-sm text-slate-200">{children}</code>
    </div>
  );
}

function Term({ name, body }: { name: string; body: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3.5">
      <h3 className="mb-1 text-sm font-medium text-slate-200">{name}</h3>
      <p className="text-sm leading-relaxed text-slate-400">{body}</p>
    </div>
  );
}
