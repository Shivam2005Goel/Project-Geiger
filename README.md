<div align="center">

# ☢️ Project Geiger

**Mapping the blast radius of retracted science.**

A citation-integrity tool that traces what retracted papers contaminated — and how much
of it happened *after* the retraction notice was published.

![Next.js](https://img.shields.io/badge/Next.js-16.3-000000?logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-19.2-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Neo4j](https://img.shields.io/badge/Neo4j-6.2-4581C3?logo=neo4j&logoColor=white)
![Tests](https://img.shields.io/badge/tests-108%20passing-3fb950)

</div>

---

## Table of contents

- [The problem](#the-problem)
- [The solution](#the-solution)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [The ingest pipeline](#the-ingest-pipeline)
- [How the contamination score works](#how-the-contamination-score-works)
- [Project structure](#project-structure)
- [API reference](#api-reference)
- [Configuration](#configuration)
- [Development](#development)
- [Limitations and ethics](#limitations-and-ethics)
- [Data sources and licensing](#data-sources-and-licensing)

---

## The problem

When a paper is retracted, it does not disappear from the literature. Its findings have
already been absorbed into hundreds of downstream studies, and those studies keep being
cited long after the retraction notice appears.

The Lesné 2006 *Nature* paper on amyloid-β — the foundation of a major strand of
Alzheimer's research — accumulated **2,758 citations** and was not retracted until 2024,
sixteen years after publication. Papers built on it are still being published.

The hard part is that a citation graph alone does not tell you whether any of that
matters. Looking at a line between two papers, you cannot see:

- **Did the citing author know?** A paper published in 2010 citing work retracted in 2024
  was acting in good faith. One published in 2025 was not, and that difference is the
  entire integrity signal.
- **How much weight does it carry?** Citing a retracted work among 8 references is a very
  different act from citing it among 300.
- **Are they relying on it, or criticising it?** A paper *about* research misconduct cites
  the fraudulent work too — and naive tooling scores those authors as the worst offenders.

## The solution

Geiger walks citations **forward** from flagged papers — the direction that actually
carries contamination — and scores each affected paper on a documented, versioned model
that weighs all three of the questions above.

Every score can be expanded into the exact citation chains that produced it, hop by hop.
A number nobody can interrogate is a number nobody should act on.

```text
     Retracted paper (2006, notice 2022)
              ▲
              │ cited 2008  ← pre-notice, discounted
              │ cited 2024  ← post-notice, full weight ⚠
              │
      Papers that cite it  ──▶  Papers that cite those  ──▶  decay stops at 3 hops
```

---

## Features

### Search and discovery

| Feature | Description |
| --- | --- |
| **Universal search** | Look up any paper by DOI, OpenAlex ID, PMID, arXiv ID, title or author. Searches the local corpus first, then falls back to OpenAlex. |
| **On-demand crawling** | A paper not yet in the database is fetched live from OpenAlex, persisted, scored and rendered — no 404 dead ends. |
| **In-graph search (`⌘K` / `Ctrl+K`)** | Command palette for jumping to any node inside the currently loaded graph. |

### Visualisation

| Mode | What it shows |
| --- | --- |
| **Timeline** | Vertical position is publication year, so contamination is visibly travelling forward through time. Post-notice citations are drawn as dashed red edges. |
| **Hierarchy** | Layered by citation depth (dagre). |
| **Organic** | Force-directed clustering. |
| **3D Galaxy** | WebGL force-directed graph you can orbit and fly through. |
| **Author network** | Switches the 3D graph from paper-to-paper to author-to-author, revealing co-author clusters. |
| **Time-lapse** | Play/pause scrubbing through publication years to watch the graph grow. |
| **Trace to source** | Highlights the shortest citation path from any selected paper back to the flagged work. |
| **Focus mode** | Dims everything outside the selected node's neighbourhood. |

Node size encodes citation count (log scale), fill encodes integrity status or
contamination band, and a legend is always on screen.

### Analysis tools

- **Bibliography checker** — upload a `.bib` / `.ris`, paste a DOI list, or drop in a
  reference list copied straight out of a manuscript. Reports which references are
  retracted *and* which are clean themselves but rest on flagged work.
- **Score explanations** — click any paper for the actual citation chains behind its score.
- **Exports** — CSV, GraphML (Gephi/Cytoscape Desktop), BibTeX, RIS, full JSON, and a
  client-side PDF report.
- **Public JSON API** — validated, rate-limited, cache-headed.
- **Methods page** — the formula, the live coefficients, and the limitations, so results
  are citable.

> **Note on citation-context analysis.** The `/api/nlp` endpoint that shows a sentence-level
> "supporting / contrasting / mentioning" label on an edge is currently a **demo stub**: it
> returns randomly selected canned snippets, not a real analysis. It does **not** feed the
> contamination score. The intent weighting that *does* affect scores is a separate,
> tested metadata heuristic in [`src/lib/scoring/intent.ts`](src/lib/scoring/intent.ts).
> See [Limitations](#limitations-and-ethics).

---

## Tech stack

| Layer | Technology | Why |
| --- | --- | --- |
| **Framework** | Next.js 16.3 (App Router, Turbopack) | Server components for data-backed pages, route handlers for the API |
| **Language** | TypeScript 5 (strict) | The scoring model is the product; types keep it honest |
| **UI** | React 19.2, Tailwind CSS v4 | |
| **Components** | shadcn-style on `@base-ui/react`, `lucide-react`, `framer-motion`, `cmdk` | Accessible primitives, command palette |
| **Database** | Neo4j 5+ via `neo4j-driver` 6.2 | Citation data is a graph; variable-depth traversal is the core query |
| **2D graph** | Cytoscape 3.34 + `cytoscape-dagre` | Mature layout engine, custom timeline layout on top |
| **3D graph** | `react-force-graph-3d` + Three.js 0.185 | WebGL for large neighbourhoods |
| **Export** | `html2canvas`, `jsPDF` | Client-side PDF reports |
| **Tooling** | `tsx`, `node:test`, ESLint 9 | Zero-config TS execution for CLI scripts and tests |
| **Data** | OpenAlex, Crossref / Retraction Watch | Both CC0 |

---

## Getting started

### Prerequisites

- **Node.js 20.9+** (developed on 22.x)
- **A Neo4j database** — [Neo4j Aura](https://neo4j.com/cloud/aura/) free tier is enough,
  or run one locally:

  ```bash
  docker run -p 7474:7474 -p 7687:7687 \
    -e NEO4J_AUTH=neo4j/yourpassword neo4j:5
  ```

- **An email address you monitor** — OpenAlex and Crossref both operate a "polite pool"
  with far better rate limits for identified clients. The pipeline refuses to run without
  one rather than crawling anonymously.

### 1. Install

```bash
git clone <your-repo-url>
cd citation-visualizer
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Fill in the four required values:

```ini
NEO4J_URI=neo4j+s://xxxxxxxx.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-password
GEIGER_CONTACT_EMAIL=you@university.edu
```

### 3. Build a corpus

The database starts empty. Seed it by crawling outward from a known retracted paper:

```bash
npm run ingest -- --seed 10.1038/nature04533
```

This creates the schema, crawls the citation neighbourhood, enriches it with retraction
dates from Crossref, and scores everything. Expect **2–3 minutes** for ~400 papers.

### 4. Run

```bash
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)**.

### 5. Verify

```bash
curl http://localhost:3000/api/health
```

```json
{ "status": "ok",
  "checks": {
    "neo4j":  { "ok": true, "detail": "...databases.neo4j.io:7687" },
    "corpus": { "ok": true, "detail": "1773 papers, 7406 citations" } },
  "scoreVersion": "geiger-contamination-1.0.0" }
```

A `degraded` status means the database is reachable but the corpus is empty or unscored —
run the ingest step above.

---

## The ingest pipeline

```bash
npm run ingest -- --help
```

Four stages, each runnable alone via `--stages`:

| Stage | What it does |
| --- | --- |
| `schema` | Constraints, indexes and the full-text search index |
| `crawl` | Walks citations outward from the seed papers |
| `enrich` | Attaches retraction dates and reasons from Crossref / Retraction Watch |
| `score` | Recomputes contamination across the whole corpus |

### Common recipes

```bash
# A single paper and its blast radius, two generations deep
npm run ingest -- --seed 10.1038/nature04533 --depth 2 --max-works 800

# Several seeds at once
npm run ingest -- --seed 10.1038/nature04533,10.1016/S0140-6736(97)11096-0

# Seed from the most-cited retracted works OpenAlex knows about
npm run ingest -- --retracted 25 --min-citations 100

# Re-score only — after changing a model coefficient
npm run score

# Refresh retraction status from Crossref
npm run enrich

# Corpus health, coverage, and the worst-affected papers
npm run db:status

# Inspect one paper end to end
npx tsx scripts/inspect.ts 10.1038/nature04533
```

### All flags

| Flag | Default | Purpose |
| --- | --- | --- |
| `--seed <doi>` | — | Seed DOI; comma-separate for several |
| `--retracted <n>` | — | Seed from the *n* most-cited retracted works |
| `--min-citations <n>` | — | With `--retracted`: citation floor for seeds |
| `--from-year <yyyy>` | — | With `--retracted`: publication-year floor |
| `--depth <n>` | 2 | Generations to crawl outward |
| `--max-works <n>` | 400 | Ceiling on works fetched per seed |
| `--per-generation <n>` | 100 | Citing works pulled per paper |
| `--direction <dir>` | `downstream` | `downstream` \| `upstream` \| `both` |
| `--stages <list>` | all | Subset of `schema,crawl,enrich,score` |
| `--enrich-limit <n>` | 1000 | Papers to check against Crossref |
| `--recheck-all` | off | Re-check retraction status for every paper |

Seeds come from the command line or from OpenAlex's retracted-works index. There is no
hardcoded seed DOI and no magic fan-out constant — every budget is an explicit flag with a
documented default.

---

## How the contamination score works

```text
score(p) = normalise( Σ_r  severity(r) · w_time(p,r) · w_reliance(p) · w_intent(p) · decay^(hops−1) )
```

Dose flows **backwards along citations** from every flagged paper to the papers that cite
it, decaying with each generation.

| Weight | Default | Rationale |
| --- | --- | --- |
| **Timing** `w_time` | 1.0 post-notice · 0.3 pre-notice · 0.5 unknown | The strongest signal in the model. Same-year comparisons resolve to *unknown* rather than being guessed. |
| **Reliance** `w_reliance` | baseline 30 refs | Above the baseline, weight falls off as `30 ÷ reference count`. Always in (0, 1]. |
| **Severity** `severity` | retracted 1.0 · concern 0.5 · correction 0.2 | An expression of concern may not be upheld, so it cannot count the same as a retraction. |
| **Intent** `w_intent` | 0.15 for apparent commentary | A paper *writing about* a retraction is not contaminated by it. |
| **Decay** | 0.35 per hop, stops at 3 | Generation 3 stays faint but visible. |

The accumulated dose is mapped onto **0–100** by a saturating curve, so a paper citing
twenty retracted works does not score twenty times one citing a single work. Retracted
papers themselves are pinned to **100** and labelled as *sources*, not recipients.

### Why intent weighting exists

Running the model over the Lesné neighbourhood *without* it puts these at the top of the
"most contaminated" list:

- *Academic Research Integrity Investigations Must be Independent, Fair, and Transparent*
- *Performance of AI Tools in Citing Retracted Literature*
- *Doctored: Fraud, Arrogance, and Tragedy in the Quest to Cure Alzheimer's*

Every one of them cites the retracted paper **as an example of misconduct**. Without intent
weighting the tool penalises exactly the people doing the correcting.

### Reproducibility

Every score is stamped with the model version that produced it. Scores are computed as a
batch job over the whole graph — never per request — so all numbers in a run are comparable.
Papers fetched on demand are scored against the crawled fragment only and marked
`+fragment` until the next full `npm run score`.

The live coefficients are served at [`/methods`](http://localhost:3000/methods) and
`GET /api/stats`.

---

## Project structure

```text
citation-visualizer/
├── scripts/                      CLI entry points (run with tsx)
│   ├── ingest.ts                 the pipeline: schema → crawl → enrich → score
│   ├── status.ts                 corpus health and worst-affected papers
│   ├── inspect.ts                one paper, end to end
│   ├── setup-neo4j.ts            standalone constraint creation
│   └── lib/env.ts                dotenv bootstrap + flag parsing
│
├── src/
│   ├── app/
│   │   ├── page.tsx              landing page + search
│   │   ├── paper/[...doi]/       the graph view
│   │   ├── bibliography/         the reference checker
│   │   ├── methods/              formula, coefficients, limitations
│   │   ├── error.tsx  loading.tsx  not-found.tsx
│   │   └── api/
│   │       ├── search/           local corpus → OpenAlex fallback
│   │       ├── paper/[...doi]/   graph + on-demand crawl
│   │       ├── paths/[...doi]/   score explanations
│   │       ├── export/[...doi]/  CSV / GraphML / BibTeX / RIS / JSON
│   │       ├── bibliography/     bulk reference check
│   │       ├── stats/            corpus counts + live model parameters
│   │       ├── nlp/              citation-context demo stub
│   │       └── health/           liveness and readiness
│   │
│   ├── components/
│   │   ├── graph-canvas.tsx      2D Cytoscape: timeline, hierarchy, organic
│   │   ├── graph-canvas-3d.tsx   3D WebGL galaxy + author network
│   │   ├── paper-detail.tsx      the "why does this score exist" panel
│   │   ├── search-box.tsx        global search with autocomplete
│   │   ├── global-search.tsx     ⌘K in-graph command palette
│   │   └── ui/                   shadcn-style primitives
│   │
│   └── lib/
│       ├── config.ts             ★ every tunable, env-overridable
│       ├── types.ts              domain types (4-state status, not a boolean)
│       ├── scoring/
│       │   ├── contamination.ts  ★ the model — pure, no I/O
│       │   └── intent.ts         meta-research heuristic
│       ├── sources/
│       │   ├── openalex.ts       citations both directions, balanced sampling
│       │   ├── crossref.ts       Retraction Watch notices
│       │   ├── merge.ts          multi-source reconciliation
│       │   └── http.ts           polite pool, pacing, backoff
│       ├── ingest/
│       │   ├── crawl.ts          bounded breadth-first traversal
│       │   ├── persist.ts        upserts + batch scoring
│       │   └── enrich.ts         retraction enrichment
│       ├── db/
│       │   ├── driver.ts         pooled Neo4j driver
│       │   ├── schema.ts         constraints and indexes
│       │   ├── mappers.ts        node ⇄ domain type
│       │   └── queries/          paper graph, search, stats
│       ├── bibliography/         BibTeX/RIS/free-text parsing + checking
│       ├── export/formats.ts     CSV, GraphML, BibTeX, RIS, JSON
│       ├── api/guard.ts          validation, rate limiting, error shaping
│       └── ui/presentation.ts    shared colour and wording rules
│
├── .env.example
└── package.json
```

**Data model.** Citations are stored as `(citing)-[:CITES]->(cited)`. *Downstream* — the
contamination direction — is therefore everything pointing **at** a paper.

★ marks the two files that decide what every published number means.

---

## API reference

All endpoints are rate-limited per IP and return structured errors with an actionable
`hint`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/search?q=` | Local corpus, then OpenAlex |
| `GET` | `/api/paper/{doi}` | Paper + citation neighbourhood; crawls on demand |
| `GET` | `/api/paths/{doi}` | The citation chains behind a score |
| `GET` | `/api/export/{doi}?format=` | `csv` \| `graphml` \| `bibtex` \| `ris` \| `json` |
| `POST` | `/api/bibliography` | Bulk reference check |
| `POST` | `/api/nlp` | Citation-context label (demo stub) |
| `GET` | `/api/stats` | Corpus counts + live model parameters |
| `GET` | `/api/health` | Liveness; `degraded` on an empty or unscored corpus |

**Graph query parameters:** `direction` (`downstream`/`upstream`/`both`), `depth` (1–3),
`limit` (1–600), `yearFrom`, `yearTo`, `minScore` (0–100), `status`, `crawl=false`.

```bash
# A paper's downstream neighbourhood
curl "localhost:3000/api/paper/10.1038/nature04533?direction=downstream&depth=2&limit=100"

# Only heavily affected papers since 2020
curl "localhost:3000/api/paper/10.1038/nature04533?minScore=40&yearFrom=2020"

# Check a bibliography, resolving unknown DOIs upstream
curl -X POST localhost:3000/api/bibliography \
  -H 'Content-Type: application/json' \
  -d '{"text":"10.1038/nature04533\n10.1126/science.1074069","deep":true}'

# Download the graph for Gephi
curl -o graph.graphml \
  "localhost:3000/api/export/10.1038/nature04533?format=graphml"
```

---

## Configuration

Every value below has a working default; only the first four are required.
[`src/lib/config.ts`](src/lib/config.ts) is the single source of truth — nothing that
affects a published number is hardcoded anywhere else.

### Required

| Variable | Purpose |
| --- | --- |
| `NEO4J_URI` | e.g. `neo4j+s://xxxx.databases.neo4j.io` or `bolt://localhost:7687` |
| `NEO4J_USERNAME` | |
| `NEO4J_PASSWORD` | |
| `GEIGER_CONTACT_EMAIL` | Sent to OpenAlex and Crossref for the polite pool |

### Model coefficients

Changing any of these changes published numbers — bump `SCORE_VERSION` in
`src/lib/config.ts` alongside, then re-run `npm run score`.

| Variable | Default |
| --- | --- |
| `GEIGER_HOP_DECAY` | `0.35` |
| `GEIGER_MAX_GENERATIONS` | `3` |
| `GEIGER_W_POST_RETRACTION` | `1.0` |
| `GEIGER_W_PRE_RETRACTION` | `0.3` |
| `GEIGER_W_UNKNOWN_TIMING` | `0.5` |
| `GEIGER_REFERENCE_BASELINE` | `30` |
| `GEIGER_DOSE_SATURATION` | `1.5` |
| `GEIGER_SEVERITY_RETRACTED` | `1.0` |
| `GEIGER_SEVERITY_CONCERNED` | `0.5` |
| `GEIGER_SEVERITY_CORRECTED` | `0.2` |
| `GEIGER_W_INTENT_DISPUTING` | `0.15` |

### Limits and infrastructure

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEIGER_MAX_GRAPH_NODES` | `600` | Hard ceiling per graph request |
| `GEIGER_MAX_GRAPH_DEPTH` | `3` | Maximum traversal depth |
| `GEIGER_MAX_BIB_ENTRIES` | `2000` | Per bibliography check |
| `GEIGER_RATELIMIT_MAX` | `60` | Requests per minute per IP |
| `GEIGER_RATELIMIT_BIB_MAX` | `6` | Bibliography checks per minute |
| `GEIGER_REQUEST_INTERVAL_MS` | `110` | Pacing between upstream API calls |
| `GEIGER_MAX_RETRIES` | `4` | Upstream retry attempts |
| `NEO4J_DATABASE` | instance default | |
| `NEO4J_POOL_SIZE` | `25` | Connection pool size |

---

## Development

```bash
npm run dev         # dev server with Turbopack
npm test            # 108 unit tests (node:test via tsx)
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint 9
npm run build       # production build
npm start           # serve the production build
```

### Testing philosophy

The scoring model, source reconciliation, bibliography parser and export formats are
**pure modules with no I/O**, so they are tested without a database or network:

| Suite | Covers |
| --- | --- |
| `scoring/contamination.test.ts` | Propagation, decay, timing, saturation, cycles, path explanation |
| `scoring/intent.test.ts` | The real false positives from the Lesné corpus |
| `sources/merge.test.ts` | Never downgrading a retraction when sources disagree |
| `bibliography/parse.test.ts` | BibTeX nesting, RIS tags, free-text, malformed input |
| `export/formats.test.ts` | CSV formula injection, XML escaping, BibTeX key collisions |

The single most important test asserts that **a post-retraction citer always scores above
an otherwise identical pre-retraction citer**. If that ever fails, the model is broken.

---

## Limitations and ethics

These matter more than the number does, and they are stated in the UI as well.

### A retraction is not an accusation

A large share of retractions are issued for honest error, publisher mistakes, or at the
authors' own request. Geiger scores **papers and citation paths, never people**. The
reason taxonomy is always shown rather than collapsed into a verdict, and every notice
links to the primary source. Read it before drawing conclusions.

### What the method cannot see

| Limitation | Consequence |
| --- | --- |
| **Coverage is partial** | The corpus is built by bounded crawling. Absence of a flag is **not** evidence a paper is sound. |
| **Undated notices** | A flagged paper with no notice date forces every citation to it into the "unknown timing" bucket. `npm run db:status` reports this coverage. |
| **Intent is a heuristic** | It reads titles, venues and subject terms — not the citing sentence. English-only. A match reduces a score, never zeroes it. |
| **`/api/nlp` is a stub** | The edge-level sentiment label is randomly generated demo content and does not affect any score. Wire in a real model before relying on it. |
| **Sampling is bounded** | Geiger samples half by citation count and half by recency so post-retraction citations are not systematically excluded — but a truncated neighbourhood is still a sample, and the UI says so when it truncates. |
| **No full text** | Without it, a load-bearing citation cannot be distinguished from a passing mention in a literature review. |

### Interpreting a result

A high score is **a prompt to look, not a finding**. The correct next step is to open the
paper and check whether the retracted claim is actually load-bearing.

---

## Data sources and licensing

| Source | Licence | Provides |
| --- | --- | --- |
| [OpenAlex](https://openalex.org) | CC0 | Bibliographic metadata, citations in both directions |
| [Crossref](https://www.crossref.org) / [Retraction Watch](https://retractionwatch.com) | CC0 since 2023 | Retraction and expression-of-concern notices, with dates and reasons |

Where sources disagree, Geiger keeps the **most severe** status asserted by any of them and
dates it from the **earliest** notice of any kind. A source with no record is treated as
silent, never as an all-clear.

---

<div align="center">
<sub>Built for researchers, editors and integrity offices who need to know what a retraction actually cost.</sub>
</div>
