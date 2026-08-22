/**
 * Central configuration for Project Geiger.
 *
 * Every tunable in the system lives here with a documented default and an
 * environment-variable override. Nothing that affects a published number
 * should be a literal buried in a query or a component.
 */

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, got "${raw}"`);
  }
  return parsed;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

/**
 * Contamination model parameters.
 *
 * These are the coefficients of the published formula. They are versioned:
 * any change to a value here must come with a bump to `SCORE_VERSION`, because
 * scores computed under different parameters are not comparable.
 */
export const scoring = {
  /**
   * Per-hop decay. A paper citing a paper that cited retracted work receives
   * `HOP_DECAY` times the dose of a direct citer. 0.35 keeps generation 3
   * faint but visible.
   */
  hopDecay: num('GEIGER_HOP_DECAY', 0.35),

  /**
   * Maximum generations propagated outward from a retracted work. Beyond 3
   * hops the decayed dose is below the noise floor for any realistic decay.
   */
  maxGenerations: num('GEIGER_MAX_GENERATIONS', 3),

  /**
   * Weight applied when the citing paper was published *after* the retraction
   * notice. This is a live integrity problem, so it carries full weight.
   */
  weightPostRetraction: num('GEIGER_W_POST_RETRACTION', 1.0),

  /**
   * Weight when the citing paper predates the retraction notice. The authors
   * could not have known, so the citation is evidence of contamination spread
   * but not of negligence.
   */
  weightPreRetraction: num('GEIGER_W_PRE_RETRACTION', 0.3),

  /**
   * Weight when we cannot establish the ordering (missing retraction date or
   * missing publication date). Sits between the two known cases rather than
   * silently assuming the favourable one.
   */
  weightUnknownTiming: num('GEIGER_W_UNKNOWN_TIMING', 0.5),

  /**
   * Reference-count baseline for reliance weighting. A paper citing fewer
   * works than this leans proportionally harder on each one, so it gets full
   * weight; above it, weight falls off as the baseline over the actual count.
   * 30 approximates the median reference list length in the sciences.
   */
  referenceBaseline: num('GEIGER_REFERENCE_BASELINE', 30),

  /**
   * Dose at which the normalised score reaches ~63/100. Controls how quickly
   * the saturating curve climbs; raise it to spread out the top of the range.
   */
  doseHalfSaturation: num('GEIGER_DOSE_SATURATION', 1.5),

  /**
   * How much dose a flagged paper emits, by its own status. A formally
   * retracted work emits full dose; a paper merely under discussion emits
   * less, because the concern may not be upheld.
   */
  sourceSeverity: {
    retracted: num('GEIGER_SEVERITY_RETRACTED', 1.0),
    concerned: num('GEIGER_SEVERITY_CONCERNED', 0.5),
    corrected: num('GEIGER_SEVERITY_CORRECTED', 0.2),
    clean: 0,
  },

  /**
   * Citation-intent multipliers. Applied when an intent classification is
   * available for the citation; `mentioning` is the neutral default.
   */
  intentWeights: {
    supporting: num('GEIGER_W_INTENT_SUPPORTING', 1.0),
    mentioning: num('GEIGER_W_INTENT_MENTIONING', 0.6),
    disputing: num('GEIGER_W_INTENT_DISPUTING', 0.15),
  },
} as const;

/**
 * Bumped whenever `scoring` parameters or the propagation algorithm change.
 * Stamped onto every scored node so stale scores are detectable.
 */
export const SCORE_VERSION = 'geiger-contamination-1.0.0';

/** Limits that protect the database and the browser from unbounded graphs. */
export const limits = {
  /** Hard ceiling on nodes returned by a single graph request. */
  maxGraphNodes: num('GEIGER_MAX_GRAPH_NODES', 600),
  /** Default when the client does not ask for a specific size. */
  defaultGraphNodes: num('GEIGER_DEFAULT_GRAPH_NODES', 250),
  /** Maximum traversal depth a client may request. */
  maxGraphDepth: num('GEIGER_MAX_GRAPH_DEPTH', 3),
  defaultGraphDepth: num('GEIGER_DEFAULT_GRAPH_DEPTH', 2),
  /** Maximum references accepted in one bibliography check. */
  maxBibliographyEntries: num('GEIGER_MAX_BIB_ENTRIES', 2000),
  /** Maximum distinct citation paths returned by the explanation endpoint. */
  maxExplanationPaths: num('GEIGER_MAX_EXPLANATION_PATHS', 25),
  /** Search results per request. */
  searchLimit: num('GEIGER_SEARCH_LIMIT', 20),
} as const;

/** External data source settings. */
export const sources = {
  /**
   * Contact address sent to OpenAlex and Crossref. Both operate a "polite
   * pool" with materially better rate limits for identified clients; an
   * unset or placeholder address gets throttled.
   */
  get contactEmail(): string {
    // Read lazily rather than at module load: this module is often imported
    // before a CLI entry point has had a chance to call dotenv, and ESM
    // hoists imports above statements, so a cached value can be empty.
    return str('GEIGER_CONTACT_EMAIL', '');
  },
  openAlexBase: str('OPENALEX_API_BASE', 'https://api.openalex.org'),
  crossrefBase: str('CROSSREF_API_BASE', 'https://api.crossref.org'),
  /** Milliseconds between successive requests to one host. */
  requestIntervalMs: num('GEIGER_REQUEST_INTERVAL_MS', 110),
  maxRetries: num('GEIGER_MAX_RETRIES', 4),
} as const;

/** Server-side cache lifetimes, in seconds. */
export const cache = {
  graphTtl: num('GEIGER_CACHE_GRAPH_TTL', 900),
  searchTtl: num('GEIGER_CACHE_SEARCH_TTL', 300),
  statsTtl: num('GEIGER_CACHE_STATS_TTL', 600),
} as const;

/** Per-IP request budgets for the public API. */
export const rateLimit = {
  windowMs: num('GEIGER_RATELIMIT_WINDOW_MS', 60_000),
  maxRequests: num('GEIGER_RATELIMIT_MAX', 60),
  /** Bibliography checks are far more expensive, so they get their own budget. */
  maxBibliographyRequests: num('GEIGER_RATELIMIT_BIB_MAX', 6),
} as const;
