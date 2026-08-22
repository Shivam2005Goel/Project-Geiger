<div align="center">
  <h1>☢️ Project Geiger</h1>
  <p><strong>Mapping the Blast Radius of Retracted Science</strong></p>
</div>

---

## 🚨 The Problem: The Zombie Science Epidemic
When a scientific paper is retracted, it doesn't just disappear. If the paper was highly cited, its findings have already seeped into the literature, creating a cascade of "zombie science". 

Surprisingly, **millions of citations** continue to accumulate for retracted papers, meaning researchers are unknowingly building new studies, medical guidelines, and AI models on top of flawed or falsified data. A simple citation graph doesn't tell the whole story: *Did the citing author know it was retracted? Were they refuting it, or relying heavily on it?*

## 💡 Our Solution: Project Geiger
**Project Geiger** is a powerful, interactive visualizer and scoring engine that traces citations forward from retracted and disputed papers. It reveals exactly what they contaminated—and how much of that happened *after* the retraction notice was published.

Geiger doesn't just draw lines; it **scores contamination** by weighing citation timing, reference-list size, notice severity, and citation intent. 

---

## ✨ Key Features

### 🕸️ Interactive Visualisations
- **3D Galaxy WebGL Mode:** Dive into an immersive, interactive 3D universe of citations. Rotate, zoom, and explore complex citation networks dynamically.
- **2D Timeline Layout:** View citations flowing forward through time (y-axis = publication year). Watch contamination visibly travel forward, with post-notice citations drawn as flashing dashed red edges.
- **Author Network Mode:** Shift from paper-to-paper networks to author-to-author networks. Discover co-author clusters and track how contamination spreads between specific researchers.
- **Trace to Source:** Select any paper and instantly highlight the shortest path back to the original retracted source.
- **Time-Lapse Animation:** Hit play and watch the citation graph evolve year-by-year, telling the story of a paper's influence over time.

### 🧠 Deep Data & AI
- **AI Citation Context Analysis (NLP):** Hover over a citation edge to see exactly *how* a paper was cited. Our local NLP pipeline classifies the sentiment—was the citing author supporting the retracted work, or refuting it?
- **Global Search:** Hit `⌘K` anywhere to search for any paper by DOI, OpenAlex ID, PMID, arXiv ID, title, or author. Missing papers are automatically crawled on demand!
- **Intelligent Scoring Engine:** Computes a "contamination score" based on chronological timing, reliance dose, and notice severity.

### 🛠️ Professional Tools
- **Bibliography Checker:** Upload a `.bib`, `.ris`, DOI list, or paste a reference list to scan your entire bibliography. Find out if any of your "clean" references secretly rest on flagged work.
- **Comprehensive Exports:** Generate beautiful, print-ready **PDF Reports**, or export data to CSV, GraphML (for Gephi/Cytoscape), BibTeX, RIS, and full JSON.
- **Public JSON API:** Full REST API with validation, rate limiting, and cache headers for developers.

---

## 🚀 Quick Start

### 1. Installation
```bash
npm install
```

### 2. Configuration
Copy the environment file and fill in your details:
```bash
cp .env.example .env
```
*(Note: `GEIGER_CONTACT_EMAIL` is required to access the polite pool for OpenAlex and Crossref APIs.)*

### 3. Build Your First Graph
Crawl a retracted paper (e.g., the famous Schön scandal paper) to seed your local database:
```bash
npm run ingest -- --seed 10.1038/nature04533
```

### 4. Run the Visualizer
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) and watch the blast radius unfold!

---

## ⚙️ The Pipeline Engine
Under the hood, Geiger uses a robust data pipeline to fetch, enrich, and score data.

```bash
npm run ingest -- --help
```

You can run individual stages or batch jobs:
```bash
# Analyze a paper's blast radius to a depth of 2
npm run ingest -- --seed 10.1038/nature04533 --depth 2 --max-works 800

# Seed the database with the top 25 most-cited retracted works
npm run ingest -- --retracted 25 --min-citations 100

# Re-score the database (e.g. after tweaking the algorithm)
npm run score
```

---

## 📊 How the Contamination Score Works

```text
score(p) = normalise( Σ_r severity(r) · w_time(p,r) · w_reliance(p) · w_intent(p) · decay^(hops−1) )
```

1. **Timing:** Citations published *after* a retraction receive maximum penalty. Citations published *before* could not have known, receiving a lower penalty.
2. **Reliance:** Citing a retracted work among 8 references is heavily penalized; citing it among 300 references is diluted.
3. **Severity:** A full retraction emits a full dose. An "expression of concern" emits less.
4. **Intent:** A paper explicitly *writing about* a retraction (refutational) is not penalized.

*Scores are mapped from 0–100. Retracted papers are pinned at 100.*

---

## ⚠️ Limitations & Ethics
- **A retraction is not an accusation:** Many retractions are requested by honest authors who found an error. Geiger scores citation paths, not people.
- **Coverage is partial:** The absence of a flag in Geiger does not guarantee a paper is flawless. We bound crawls to prevent infinite fan-out.
- **Heuristics:** Intent detection is AI/NLP-assisted and based on metadata. It is highly accurate but not a flawless substitute for human reading.

## 📄 Licensing & Data Sources
- [OpenAlex](https://openalex.org) (CC0) — Bibliographic metadata and the citation graph.
- [Crossref](https://www.crossref.org) / Retraction Watch (CC0) — Retraction notices, dates, and reasons.
