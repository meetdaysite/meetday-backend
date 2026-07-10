// Tunables for crowd-pulse calibration and vibe-match scoring.
// Centralised so the heuristics can be adjusted without touching the logic.

// ─── Crowd pulse (sample-size handling) ────────────────────────────────────────

/** Laplace/additive smoothing strength for vibe-type proportions. */
export const VIBE_SMOOTHING_ALPHA = 1;

/** Half-confidence sample size: confidence = n / (n + n0). */
export const CROWD_CONFIDENCE_N0 = 8;

/** Below this many vibe-typed attendees, suppress confident crowd labels. */
export const MIN_SAMPLE_FOR_LABEL = 5;

/** Below this many vibe-typed attendees, there is no reliable dominant vibe. */
export const MIN_SAMPLE_FOR_DOMINANT = 3;

/** Minimum smoothed-proportion margin between top-two vibes to call a dominant. */
export const DOMINANT_MARGIN = 0.1;

/** Smoothed-proportion threshold for HIGH / LOW energy. */
export const ENERGY_THRESHOLD = 0.4;

// ─── Vibe match (weighted sub-scores) ──────────────────────────────────────────

/** Weights when the caller is authenticated (graph proximity available). Sum = 1. */
export const MATCH_WEIGHTS_AUTH = {
  interest: 0.3,
  vibe: 0.15,
  social: 0.15,
  graph: 0.4, // behavioural truth — weighted highest
} as const;

/** Weights when anonymous (no graph). Sum = 1 (the auth weights renormalised). */
export const MATCH_WEIGHTS_ANON = {
  interest: 0.5,
  vibe: 0.25,
  social: 0.25,
} as const;

/** Interest fit assigned when the user rated no interests in this category. */
export const INTEREST_FIT_UNKNOWN = 0.35;

/** Saturation rate for graph proximity: G = 1 - e^(-k · knownAttendees). */
export const GRAPH_SATURATION_K = 0.5;
