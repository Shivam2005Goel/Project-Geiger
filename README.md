# Project Geiger

Traces citations forward from retracted and disputed papers to show what they
contaminated — and how much of that happened *after* the retraction notice was
published.

The premise is that a citation graph alone does not tell you much. What matters
is whether a paper's evidential base rests on work that was later withdrawn, how
directly, and whether the citing authors could have known at the time.

---

## What it does

- **Search** any paper by DOI, OpenAlex ID, PMID, arXiv ID, title or author.
  Papers not yet in the corpus are crawled from OpenAlex on demand.
- **Contamination scoring** — a documented, versioned model (not a placeholder)
  that weighs citation timing, reference-list size, notice severity and apparent
  citation intent.
- **Explanations** — every score can be expanded into the actual citation chains
  that produced it, hop by hop.
- **Bibliography checking** — upload a `.bib`, `.ris`, DOI list or pasted
  reference list and get every entry checked, including references that are clean
  themselves but rest on flagged work.
- **Graph visualisation** with a timeline layout (y-axis = publication year), so
  contamination is visibly travelling forward through the literature, and
  post-notice citations are drawn as dashed red edges.
- **Exports** — CSV, GraphML (Gephi/Cytoscape), BibTeX, RIS and full JSON.
- **A public JSON API** with validation, rate limiting and cache headers.

## Quick start

```bash
npm install
cp .env.example .env        # then fill in the values
npm run ingest -- --seed 10.1038/nature04533
npm run dev
```

`GEIGER_CONTACT_EMAIL` is required. OpenAlex and Crossref both operate a "polite
pool" with far better rate limits for identified clients, and the pipeline
refuses to start without a real address rather than crawling anonymously.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEO4J_URI` | yes | Bolt URI, e.g. `neo4j+s://xxxx.databases.neo4j.io` |
| `NEO4J_USERNAME` | yes | |
| `NEO4J_PASSWORD` | yes | |
| `NEO4J_DATABASE` | no | Defaults to the instance default |
| `NEO4J_POOL_SIZE` | no | Connection pool size (default 25) |
| `GEIGER_CONTACT_EMAIL` | yes | Sent to OpenAlex and Crossref for the polite pool |

Every model coefficient and every limit is also environment-overridable — see
[`src/lib/config.ts`](src/lib/config.ts), which is the single source of truth.
Nothing that affects a published number is hardcoded anywhere else.

## The pipeline

```bash
npm run ingest -- --help
```

Four stages, each runnable alone via `--stages`:

| Stage | What it does |
| --- | --- |
| `schema` | Constraints, indexes and the fulltext index |
| `crawl` | Walks citations outward from seed papers |
| `enrich` | Attaches retraction dates and reasons from Crossref/Retraction Watch |
| `score` | Recomputes contamination across the whole corpus |

```bash
# One paper and its blast radius
npm run ingest -- --seed 10.1038/nature04533 --depth 2 --max-works 800

# Seed from the most-cited retracted works OpenAlex knows about
npm run ingest -- --retracted 25 --min-citations 100

# Re-score only (after changing a model coefficient)
npm run score

# Corpus health, coverage and the worst-affected papers
npm run db:status

# Inspect one paper end to end
npx tsx scripts/inspect.ts 10.1038/nature04533
```

Seeds come from the command line or from OpenAlex's retracted-works index. There
is no hardcoded seed DOI and no magic fan-out constant; every budget is an
explicit flag with a documented default.

## How the score works

```text
score(p) = normalise( Σ_r severity(r) · w_time(p,r) · w_reliance(p) · w_intent(p) · decay^(hops−1) )
```

| Weight | Rationale |
| --- | --- |
| **Timing** | A paper published before a notice could not have known. One published after either missed it or ignored it. This is the strongest signal in the model. |
| **Reliance** | Citing a retracted work among 8 references differs from citing it among 300. Normalised by reference count. |
| **Severity** | A retraction emits full dose; an expression of concern less, because the concern may not be upheld. |
| **Intent** | A paper *writing about* a retraction is not contaminated by it. Metadata heuristic — see limitations. |

Dose decays per hop and stops after 3 generations. The result is mapped to
0–100 by a saturating curve. Retracted papers are pinned to 100 and labelled as
sources rather than recipients.

Scores are computed as a batch job over the whole graph, never per request, and
every score is stamped with the model version that produced it. Papers fetched
on demand are scored against the crawled fragment only and marked `+fragment`
until the next full run.

The full write-up, including the coefficients currently in force, is served at
`/methods` and at `GET /api/stats`.

## Limitations

These are stated in the UI as well, because they matter more than the number.

- **Coverage is partial.** The corpus is built by bounded crawling. The absence
  of a flag is not evidence a paper is sound.
- **Undated notices weaken the model.** A flagged paper with no notice date
  forces every citation to it into the "unknown timing" bucket.
- **Intent detection is a heuristic** over titles, venues and subject terms — not
  the citing sentence. English-only. A match reduces a score, never zeroes it.
- **Sampling is bounded.** Highly-cited papers have more citers than any budget
  holds. Geiger samples half by citation count and half by recency so
  post-retraction citations are not systematically excluded, but a truncated
  neighbourhood is still a sample, and the UI says so when it truncates.
- **A retraction is not an accusation.** Many are issued for honest error or at
  the authors' request. Geiger scores papers and citation paths, never people.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/search?q=` | Local corpus, then OpenAlex |
| `GET /api/paper/{doi}` | Paper and citation neighbourhood; crawls on demand |
| `GET /api/paths/{doi}` | The citation chains behind a score |
| `GET /api/export/{doi}?format=` | `csv`, `graphml`, `bibtex`, `ris`, `json` |
| `POST /api/bibliography` | Bulk reference check |
| `GET /api/stats` | Corpus counts and the live model parameters |
| `GET /api/health` | Liveness; reports `degraded` on an empty or unscored corpus |

Graph queries accept `direction` (`downstream`/`upstream`/`both`), `depth`,
`limit`, `yearFrom`, `yearTo`, `minScore` and `status`.

```bash
curl "localhost:3000/api/paper/10.1038/nature04533?direction=downstream&depth=2"
curl -X POST localhost:3000/api/bibliography \
  -H 'Content-Type: application/json' \
  -d '{"text":"10.1038/nature04533","deep":true}'
```

## Development

```bash
npm run dev         # dev server
npm test            # unit tests
npm run typecheck   # tsc --noEmit
npm run lint
npm run build
```

The scoring model, source reconciliation, bibliography parser and export
formats are pure modules with unit tests — those are the parts whose output
people are asked to trust, so they are testable without a database.

## Architecture

```text
src/lib/
  config.ts              every tunable, env-overridable
  types.ts               domain types (4-state integrity status, not a boolean)
  scoring/               the contamination model — pure and tested
  sources/               OpenAlex, Crossref, multi-source reconciliation
  ingest/                crawl, persist, enrich, score
  db/                    driver, schema, mappers, queries
  bibliography/          parsing and checking
  export/                CSV, GraphML, BibTeX, RIS, JSON
  api/                   validation, rate limiting, error shaping
scripts/
  ingest.ts              the pipeline CLI
  status.ts              corpus health
  inspect.ts             one paper, end to end
```

Citations are stored as `(citing)-[:CITES]->(cited)`. Downstream — the
contamination direction — is therefore everything pointing **at** a paper.

## Data sources and licensing

- [OpenAlex](https://openalex.org) — CC0. Bibliographic metadata and the
  citation graph.
- [Crossref](https://www.crossref.org) / Retraction Watch — CC0 since 2023.
  Retraction and expression-of-concern notices with dates and reasons.

Where sources disagree, Geiger keeps the most severe status asserted by any of
them and dates it from the earliest notice of any kind. A source with no record
is treated as silent, never as an all-clear.
