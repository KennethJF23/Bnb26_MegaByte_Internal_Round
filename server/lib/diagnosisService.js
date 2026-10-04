/* ============================================================================
   Diagnosis service — the orchestrator.

   Division of labour:
     Python (ml_service)  trained classifier + sandboxed test runner
     Node   (here)        evidence fusion, sibling discrimination, intervention
                          selection, learner-model updates

   Keeping fusion and discrimination in Node means they behave identically
   whether the candidates came from the trained classifier or from the
   rule-based fallback, so a demo without uvicorn follows the same code path
   rather than a degraded parallel one.
   ========================================================================== */

const { discriminate, applyProbeAnswer } = require("./discriminator");
const rules = require("./diagnoser");
const { getLabel } = require("./misconceptionBank");

const ML_URL = process.env.ML_URL || "http://127.0.0.1:8000"; // literal IP: "localhost" resolves to ::1 on Node 18+
const ML_TIMEOUT_MS = Number(process.env.ML_TIMEOUT_MS || 20000);

/** Cheap health memo so we don't pay a failed connect on every request. */
let lastProbe = { at: 0, up: false, backend: null };
const PROBE_TTL_MS = 5000;

async function mlFetch(path, options = {}, timeoutMs = ML_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${ML_URL}${path}`, { ...options, signal: ctrl.signal });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function probeMl({ force = false } = {}) {
  if (!force && Date.now() - lastProbe.at < PROBE_TTL_MS) return lastProbe;
  try {
    const { ok, data } = await mlFetch("/health", {}, 2500);
    lastProbe = { at: Date.now(), up: !!ok, backend: (data && data.backend) || null };
  } catch {
    lastProbe = { at: Date.now(), up: false, backend: null };
  }
  return lastProbe;
}

/* --------------------------------------------------------------- shaping --- */

/**
 * Normalise a diagnosis into ONE shape, whatever produced it.
 *
 * The old /submit response nested the whole diagnose envelope under
 * `diagnosis`, so clients had to read `result.diagnosis.diagnosis.description`.
 * Everything below returns a single flat envelope instead.
 */
function shapeDiagnosis({ raw, code, evidence, engine }) {
  const candidates = (raw && raw.candidates) || [];

  // Evidence-based sibling separation. This is the step that turns "it's one of
  // these five string methods" into "it's .replace(), because .replace() is the
  // call in the source and its result is discarded".
  const sep = discriminate({ code, candidates, evidence });

  /* Confidence ceilings. Evidence re-ranking can otherwise push a score to
     1.0, and "100% certain" is never an honest reading here: the classifier
     measures ~42% top-1 on held-out problems, and the rule engine is an
     uncalibrated fallback. Cap by engine so the number stays interpretable. */
  const ceiling = engine === "rules" ? 0.72 : 0.95;
  const capped = sep.candidates.map((c) => ({
    ...c,
    confidence: Math.min(c.confidence, ceiling),
  }));
  const top = capped[0] || null;
  const margin = capped.length > 1 ? capped[0].confidence - capped[1].confidence : sep.margin;

  const modelAbstained = !!(raw && raw.uncertain);
  const isCorrectLabel = top && Number(top.misconception_id) === 0;

  // Commit to a label only when the model did not abstain, the top candidate is
  // a real misconception, and evidence actually separated it from its twins.
  const committed = !!top && !modelAbstained && !isCorrectLabel && !sep.ambiguous;

  const label = top ? getLabel(top.misconception_id) : null;

  return {
    misconception_id: committed ? Number(top.misconception_id) : null,
    description: committed ? top.description : null,
    confidence: top ? Number(top.confidence.toFixed(4)) : 0,
    confidenceCeiling: ceiling,
    category: label ? label.category : null,

    // honesty flags — the UI renders a different state for each
    uncertain: modelAbstained || sep.ambiguous,
    modelAbstained,
    ambiguous: sep.ambiguous,
    noKnownMisconception: isCorrectLabel,
    margin: Number(margin.toFixed(4)),

    candidates: capped.map((c) => ({
      misconception_id: c.misconception_id,
      description: c.description,
      confidence: Number(c.confidence.toFixed(4)),
      priorConfidence: Number((c.priorConfidence ?? c.confidence).toFixed(4)),
      evidence: c.evidence || [],
      injectedByEvidence: !!c.injectedByEvidence,
    })),

    // how the twins were told apart (or why they could not be)
    siblingGroup: sep.group,
    separatedBy: sep.separatedBy,
    rerankedBy: sep.rerankedBy,

    // when ambiguous, the follow-up that resolves it
    probe: sep.probe,

    engine,
    engineNote: engine === "rules"
      ? "Trained classifier unreachable — diagnosed by deterministic rules. Treat as provisional."
      : null,
  };
}

/* ------------------------------------------------------------- diagnose --- */

/**
 * Diagnose a snippet. Uses the trained classifier when reachable, the rule
 * engine otherwise. Never throws for "service down" — that is what the fallback
 * is for.
 */
async function diagnoseCode({ code, evidence = null }) {
  const { up } = await probeMl();

  if (up) {
    try {
      const { ok, data } = await mlFetch("/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (ok && data && Array.isArray(data.candidates)) {
        return shapeDiagnosis({ raw: data, code, evidence, engine: "model" });
      }
    } catch {
      /* fall through to rules */
    }
  }

  const raw = rules.diagnose({ code, evidence });
  return shapeDiagnosis({ raw, code, evidence, engine: "rules" });
}

/* --------------------------------------------------------------- submit --- */

/**
 * Run the learner's code against the problem's tests, then — only if it failed
 * for a logic reason — diagnose WHY, feeding the runtime evidence into the
 * diagnosis.
 *
 * The runtime evidence is the important part. problems.py already extracts
 * got/expected from each failing assertion, and the previous build threw that
 * away before diagnosing, passing only the source text. got/expected is exactly
 * the signal that separates siblings a bag-of-n-grams cannot.
 */
async function submitCode({ problem_id, code }) {
  const { up } = await probeMl();
  if (!up) {
    // Executing untrusted Python needs the sandboxed runner; there is no honest
    // Node substitute for that, so say so and point at what DOES still work.
    return {
      unavailable: true,
      message:
        "The code runner needs the Python service (uvicorn on port 8000), which is not reachable. " +
        "Static diagnosis and the MCQ diagnostic still work without it.",
      fallback: { diagnoseAvailable: true, mcqAvailable: true },
    };
  }

  const { ok, status, data } = await mlFetch("/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ problem_id, code }),
  });
  if (!ok) {
    return { unavailable: true, status, message: (data && data.detail) || "ML service error" };
  }

  const result = {
    correct: !!data.correct,
    passed: data.passed || 0,
    total: data.total || 0,
    syntax: !!data.syntax,
    error: data.error || null,
    failures: data.failures || [],
    diagnosis: null,
  };

  if (result.correct || result.syntax) return result;

  const evidence = {
    failures: result.failures,
    error: result.error,
    syntax: result.syntax,
  };

  // serve.py already ran the classifier and nested its envelope under
  // `diagnosis`. Reuse those candidates rather than paying a second inference,
  // but re-rank them here with the runtime evidence it did not see.
  const nested = data.diagnosis && Array.isArray(data.diagnosis.candidates) ? data.diagnosis : null;

  result.diagnosis = nested
    ? shapeDiagnosis({ raw: nested, code, evidence, engine: "model" })
    : await diagnoseCode({ code, evidence });

  return result;
}

/* ---------------------------------------------------------------- probe --- */

/** Resolve an ambiguous diagnosis using the learner's own answer. */
function resolveProbe({ probe, chosenMisconceptionId }) {
  const resolved = applyProbeAnswer(probe, chosenMisconceptionId);
  if (!resolved) return null;
  const label = getLabel(resolved.misconception_id);
  return {
    ...resolved,
    category: label ? label.category : null,
    uncertain: false,
    ambiguous: false,
    modelAbstained: false,
    noKnownMisconception: false,
    engine: "learner-probe",
  };
}

/* --------------------------------------------------------------- health --- */

async function health() {
  const probe = await probeMl({ force: true });
  return {
    ok: true,
    engines: {
      model: { available: probe.up, backend: probe.backend, url: ML_URL },
      rules: { available: true, note: "Deterministic fallback, always available" },
    },
    active: probe.up ? "model" : "rules",
  };
}

async function problems() {
  const { up } = await probeMl();
  if (!up) return { unavailable: true, problems: [] };
  const { ok, data } = await mlFetch("/problems");
  return ok && Array.isArray(data) ? { unavailable: false, problems: data } : { unavailable: true, problems: [] };
}

module.exports = {
  diagnoseCode,
  submitCode,
  resolveProbe,
  health,
  problems,
  probeMl,
  mlFetch,
  ML_URL,
};
