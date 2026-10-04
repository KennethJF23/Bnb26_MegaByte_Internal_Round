/* ============================================================================
   ML routes. Thin HTTP layer over lib/diagnosisService — all of the diagnosis
   logic lives there so it can be unit-tested without Express.
   ========================================================================== */

const fs = require("fs");
const path = require("path");
const service = require("../lib/diagnosisService");
const bank = require("../lib/misconceptionBank");
const { buildIntervention } = require("../lib/interventionEngine");
const learner = require("../lib/learnerModel");

/** Identity for learner-model writes: a real user wins over a guest session. */
function identOf(req) {
  return {
    userId: req.user || null,
    sessionKey: req.get("x-guest-session") || req.body?.sessionKey || req.query?.sessionKey || null,
  };
}

/* -------------------------------------------------------------- problems --- */

exports.problems = async (req, res) => {
  try {
    const { unavailable, problems } = await service.problems();
    if (unavailable) {
      return res.status(503).json({
        message: "The Python service (uvicorn on port 8000) is not reachable, so the coding problems cannot be loaded.",
        hint: "Start it with: cd server/ml_service && uvicorn serve:app --port 8000",
        problems: [],
      });
    }
    return res.json(problems);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/* ---------------------------------------------------------------- submit --- */

exports.submit = async (req, res) => {
  const { problem_id, code } = req.body || {};
  if (!Number.isInteger(problem_id) || typeof code !== "string" || !code.trim()) {
    return res.status(400).json({ message: "problem_id and code are required" });
  }
  if (code.length > 5000) {
    return res.status(413).json({ message: "Code is too long (max 5000 characters)" });
  }

  try {
    const result = await service.submitCode({ problem_id, code });

    if (result.unavailable) {
      return res.status(503).json({
        message: result.message,
        fallback: result.fallback || null,
      });
    }

    /* A committed diagnosis is immediately actionable: attach the targeted
       intervention, selected against this learner's history with this exact
       belief rather than by list position. */
    if (result.diagnosis && result.diagnosis.misconception_id) {
      const ident = identOf(req);
      const profile = await learner.load(ident);
      const tracker = profile.misconceptions[String(result.diagnosis.misconception_id)] || null;

      result.intervention = buildIntervention({
        misconceptionId: result.diagnosis.misconception_id,
        confidence: result.diagnosis.confidence,
        ambiguous: result.diagnosis.ambiguous,
        tracker,
        seenItemIds: Array.isArray(req.body.seenItemIds) ? req.body.seenItemIds : [],
      });
    }

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/* -------------------------------------------------------------- diagnose --- */
/*
   Diagnose a snippet with no registered problem and no unit tests. This was
   never exposed before (Express only proxied /problems and /submit), which made
   standalone diagnosis unreachable from the app even though the model supports
   it. It also works when the Python service is down, via the rule engine.
*/
exports.diagnose = async (req, res) => {
  const { code, evidence } = req.body || {};
  if (typeof code !== "string" || !code.trim()) {
    return res.status(400).json({ message: "code is required" });
  }
  if (code.length > 5000) {
    return res.status(413).json({ message: "Code is too long (max 5000 characters)" });
  }
  try {
    const diagnosis = await service.diagnoseCode({ code, evidence: evidence || null });

    let intervention = null;
    if (diagnosis.misconception_id) {
      const profile = await learner.load(identOf(req));
      intervention = buildIntervention({
        misconceptionId: diagnosis.misconception_id,
        confidence: diagnosis.confidence,
        ambiguous: diagnosis.ambiguous,
        tracker: profile.misconceptions[String(diagnosis.misconception_id)] || null,
      });
    }
    return res.json({ diagnosis, intervention });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/* ----------------------------------------------------------------- probe --- */
/*
   Resolve an ambiguous diagnosis with the learner's own account of their
   reasoning. This is the step that makes differentiation honest: when evidence
   cannot separate two beliefs that produce the same wrong answer, the system
   asks instead of picking the higher prior.
*/
exports.probe = async (req, res) => {
  const { probe, chosenMisconceptionId } = req.body || {};
  if (!probe || !Array.isArray(probe.options)) {
    return res.status(400).json({ message: "probe (with options) is required" });
  }
  const resolved = service.resolveProbe({ probe, chosenMisconceptionId });
  if (!resolved) {
    return res.status(400).json({ message: "chosenMisconceptionId is not one of the probe options" });
  }

  try {
    const ident = identOf(req);
    const profile = await learner.load(ident);
    const intervention = buildIntervention({
      misconceptionId: resolved.misconception_id,
      confidence: resolved.confidence,
      ambiguous: false,
      tracker: profile.misconceptions[String(resolved.misconception_id)] || null,
    });
    return res.json({ diagnosis: resolved, intervention });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/* ---------------------------------------------------- intervention served --- */
/*
   Called when an intervention is actually shown to the learner. This opens the
   verification window: until an intervention is delivered, a correct answer
   proves nothing, because there was nothing to verify.
*/
exports.markIntervention = async (req, res) => {
  const { misconceptionId, interventionId } = req.body || {};
  const id = Number(misconceptionId);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ message: "misconceptionId is required" });
  }
  try {
    const profile = await learner.markInterventionDelivered(identOf(req), {
      misconceptionId: id,
      interventionId: interventionId || null,
    });
    return res.json({
      ok: true,
      tracker: profile.misconceptions[String(id)] || null,
      storage: learner.dbUp() ? "mongo" : "memory",
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/* --------------------------------------------------------------- metrics --- */
/*
   The held-out evaluation, served rather than left in a file nobody reads.
   The brief scores "evaluate diagnosis accuracy and performance on responses or
   misconceptions not seen during training", and artifacts/baseline_report.json
   already contains exactly that — it was simply never exposed.
*/
const REPORT_PATH = path.join(__dirname, "..", "ml_service", "artifacts", "baseline_report.json");

exports.metrics = async (req, res) => {
  let report = null;
  let reportError = null;
  try {
    report = JSON.parse(fs.readFileSync(REPORT_PATH, "utf8"));
  } catch (err) {
    reportError = `Evaluation report not found (${path.basename(REPORT_PATH)}). Run train_baseline.py to generate it.`;
  }

  const probe = await service.probeMl({ force: false });

  return res.json({
    engine: {
      active: probe.up ? "model" : "rules",
      modelAvailable: probe.up,
      backend: probe.backend,
    },
    report,
    reportError,
    coverage: bank.coverage(),
    siblingGroups: bank.SIBLING_GROUPS.map((g) => ({
      key: g.key,
      label: g.label,
      members: g.members.map((id) => ({ id, description: bank.describe(id) })),
    })),
    /* Read these honestly: 68 classes, so chance is ~1.5%. Top-1 in the low 40s
       is far above chance but wrong more often than right, and tau=0.131 means
       the abstain gate rarely fires — 73% of genuinely unknown misconceptions
       are still assigned a known label. The UI states this rather than
       presenting confidence as authoritative. */
    interpretation: report
      ? {
          classes: bank.MODEL_LABEL_IDS.length + 1,
          chanceLevel: Number((1 / (bank.MODEL_LABEL_IDS.length + 1)).toFixed(4)),
          headline: "Held-out accuracy on problems never seen in training",
          headlineValue: report.unseen_problems ? report.unseen_problems.acc : null,
          caveats: [
            "Trained on LLM-generated corruptions of 25 reference problems, not on real student submissions.",
            "The deployed artifact is refit on all data, so no clean generalisation number describes it exactly.",
            `Open-set rejection is weak: only ${report.unseen_misconceptions ? Math.round(report.unseen_misconceptions.unknown_rejected * 100) : "?"}% of unseen misconceptions are correctly refused.`,
            "Sibling separation is handled by deterministic evidence rules, not by the classifier.",
          ],
        }
      : null,
  });
};

/* ---------------------------------------------------------------- health --- */

exports.health = async (req, res) => {
  try {
    return res.json(await service.health());
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/* ------------------------------------------------------------------ bank --- */

/** The misconception bank and MCQ index, so the client stops shipping its own copy. */
exports.bankIndex = (req, res) => {
  return res.json({
    labels: bank.MODEL_LABEL_IDS.map((id) => {
      const l = bank.getLabel(id);
      return { id, description: l.description, category: l.category, constructs: l.constructs, source: l.source };
    }),
    siblingGroups: bank.SIBLING_GROUPS,
    categories: bank.CATEGORIES,
    coverage: bank.coverage(),
  });
};

/** MCQ items, optionally filtered to those that probe one misconception. */
exports.questions = (req, res) => {
  const { misconceptionId, category } = req.query || {};
  if (misconceptionId) {
    return res.json(bank.mcqsFor(misconceptionId));
  }
  if (category) {
    return res.json(bank.mcqsInCategory(category));
  }
  return res.json(bank.MCQS);
};
