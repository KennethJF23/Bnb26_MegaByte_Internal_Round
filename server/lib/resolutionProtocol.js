/* ============================================================================
   Resolution protocol — deciding whether a misconception is actually gone.

   WHAT WAS WRONG BEFORE
   The previous rule credited every misconception in a category whenever any
   answer in that category was correct, then declared "eradicated" at two
   credits. So answering one range() question marked all of "Loops & Iteration"
   resolved — including misconceptions that were never retested. The brief
   explicitly warns against exactly this: "rather than assuming that a correct
   follow-up answer means learning has occurred."

   THE PROTOCOL
   A misconception is only credited by evidence that targets THAT misconception
   (matched on stable numeric id, never on free-text name), and clearing it
   requires three distinct things:

     1. RETEST    — the same misconception, probed again after the intervention,
                    answered correctly.
     2. TRANSFER  — a differently-shaped item for the same misconception. The
                    belief has to survive a change of surface form, otherwise
                    the learner may have memorised one question.
     3. NO SIBLING SWAP — the learner must not have selected a distractor that
                    maps to a sibling misconception. Trading one wrong belief
                    for an adjacent wrong belief is not resolution, and the
                    naive "answer was correct" check cannot see the difference.

   A relapse after clearing sends the misconception to `entrenched`, not back to
   `active`, because a belief that returns after being taught against is the
   harder case and should be prioritised differently.
   ========================================================================== */

const { siblingsOf, getLabel } = require("./misconceptionBank");

/** Lifecycle states, ordered by how much attention the learner needs. */
const STATES = ["eradicated", "resolving", "active", "entrenched"];

const PASSES_TO_RESOLVE = 2;   // qualifying post-intervention passes
const OCCURRENCES_TO_ENTRENCH = 3;

/**
 * A fresh tracker entry for a newly observed misconception.
 */
function newTracker(misconceptionId, { category = null, name = null } = {}) {
  const label = getLabel(misconceptionId);
  return {
    misconceptionId: Number(misconceptionId),
    name: name || (label ? label.description : `Misconception #${misconceptionId}`),
    category: category || (label ? label.category : null),

    occurrences: 0,          // times diagnosed
    firstSeen: null,
    lastSeen: null,

    interventionCount: 0,
    lastInterventionAt: null,
    lastInterventionId: null,

    // post-intervention evidence
    passes: 0,               // qualifying correct retests since last intervention
    transferPasses: 0,       // of those, how many were differently-shaped
    probeShapesSeen: [],     // distinct item shapes answered correctly
    siblingSwaps: 0,         // chose a sibling's distractor
    relapses: 0,

    status: "active",
    resolvedAt: null,
    history: [],             // audit trail — the evidence chain, newest last
  };
}

/**
 * Shape key for an item, used to enforce the transfer requirement.
 * Two items share a shape when they'd be defeated by memorising one answer.
 */
function shapeOf(event = {}) {
  const meta = event.metadata || {};
  if (meta.probeShape) return String(meta.probeShape);
  const kind = event.eventType === "code_submission" ? "code" : (meta.questionType || event.type || "mcq");
  const id = event.problemId ? `#${event.problemId}` : "";
  return `${kind}${id}`;
}

/**
 * Fold one observation into a tracker. Pure: returns a new tracker.
 *
 * @param {object} tracker   existing tracker (or null to create)
 * @param {object} obs
 * @param {number} obs.misconceptionId
 * @param {boolean} obs.correct          was the learner's answer correct
 * @param {boolean} obs.targeted         did this item actually probe THIS misconception
 * @param {number|null} obs.chosenSibling  sibling id the learner's wrong choice maps to
 * @param {string} obs.shape             item shape (see shapeOf)
 * @param {string|null} obs.interventionId
 * @param {Date}   obs.at
 */
function applyObservation(tracker, obs) {
  const t = tracker
    ? { ...tracker, probeShapesSeen: [...tracker.probeShapesSeen], history: [...tracker.history] }
    : newTracker(obs.misconceptionId, obs);

  const at = obs.at ? new Date(obs.at) : new Date();
  const note = (verdict, detail) => {
    t.history.push({ at, verdict, detail, shape: obs.shape || null, interventionId: obs.interventionId || null });
    if (t.history.length > 40) t.history.shift();
  };

  /* ---- an item that does not target this misconception cannot credit it ---- */
  if (!obs.targeted) {
    return t;
  }

  if (!obs.correct) {
    /* ---- the misconception showed up again ------------------------------- */
    t.occurrences += 1;
    t.firstSeen = t.firstSeen || at;
    t.lastSeen = at;

    const wasCleared = t.status === "eradicated" || t.status === "resolving";
    if (wasCleared) {
      t.relapses += 1;
      t.resolvedAt = null;
      t.status = "entrenched";
      note("relapse", "reappeared after the intervention, so the belief was not actually replaced");
    } else {
      t.status = t.occurrences >= OCCURRENCES_TO_ENTRENCH ? "entrenched" : "active";
      note("observed", `diagnosed on a targeted item (occurrence ${t.occurrences})`);
    }

    // a wrong answer resets accumulated post-intervention credit
    t.passes = 0;
    t.transferPasses = 0;
    t.probeShapesSeen = [];
    return t;
  }

  /* ---- correct on a targeted item -------------------------------------- */

  // Sibling swap: "correct" on the stem but the reasoning points at a twin.
  if (obs.chosenSibling && siblingsOf(t.misconceptionId).includes(Number(obs.chosenSibling))) {
    t.siblingSwaps += 1;
    t.passes = 0;
    t.transferPasses = 0;
    t.probeShapesSeen = [];
    t.status = "active";
    const sib = getLabel(obs.chosenSibling);
    note("sibling-swap", `traded this belief for an adjacent one: ${sib ? sib.description : `#${obs.chosenSibling}`}`);
    return t;
  }

  // Credit only counts once the learner has actually been taught against it.
  if (t.interventionCount === 0) {
    note("correct-pre-intervention", "correct before any intervention, so there is nothing to verify yet");
    t.lastSeen = t.lastSeen || at;
    return t;
  }

  const shape = obs.shape || "unknown";
  const isTransfer = t.probeShapesSeen.length > 0 && !t.probeShapesSeen.includes(shape);
  if (!t.probeShapesSeen.includes(shape)) t.probeShapesSeen.push(shape);

  t.passes += 1;
  if (isTransfer) t.transferPasses += 1;
  t.lastSeen = at;

  const meetsRetest = t.passes >= PASSES_TO_RESOLVE;
  const meetsTransfer = t.transferPasses >= 1;

  if (meetsRetest && meetsTransfer) {
    t.status = "eradicated";
    t.resolvedAt = at;
    note("verified-resolved", `${t.passes} targeted passes across ${t.probeShapesSeen.length} different item shapes`);
  } else {
    t.status = "resolving";
    const missing = !meetsRetest
      ? `needs ${PASSES_TO_RESOLVE - t.passes} more targeted pass(es)`
      : "needs one pass on a differently-shaped item";
    note("partial-credit", `${isTransfer ? "transfer" : "retest"} pass recorded — ${missing}`);
  }

  return t;
}

/** Record that an intervention was delivered for this misconception. */
function recordIntervention(tracker, { misconceptionId, interventionId, at, category, name } = {}) {
  const t = tracker
    ? { ...tracker, probeShapesSeen: [...tracker.probeShapesSeen], history: [...tracker.history] }
    : newTracker(misconceptionId, { category, name });
  const when = at ? new Date(at) : new Date();
  t.interventionCount += 1;
  t.lastInterventionAt = when;
  t.lastInterventionId = interventionId || null;
  // a new intervention starts a fresh verification window
  t.passes = 0;
  t.transferPasses = 0;
  t.probeShapesSeen = [];
  if (t.status === "eradicated") t.status = "resolving";
  t.history.push({
    at: when,
    verdict: "intervention",
    detail: `targeted intervention delivered (#${t.interventionCount})`,
    interventionId: interventionId || null,
  });
  if (t.history.length > 40) t.history.shift();
  return t;
}

/**
 * What still has to happen before this misconception can be called resolved.
 * Drives the UI's "what's left" line, so the learner sees the standard.
 */
function outstandingRequirements(tracker) {
  if (!tracker) return [];
  const out = [];
  if (tracker.interventionCount === 0) out.push("Receive the targeted intervention");
  if (tracker.passes < PASSES_TO_RESOLVE) {
    out.push(`Answer ${PASSES_TO_RESOLVE - tracker.passes} more targeted item(s) correctly`);
  }
  if (tracker.transferPasses < 1) out.push("Pass one differently-shaped item on the same idea");
  if (tracker.siblingSwaps > 0) out.push("Stop selecting the neighbouring belief");
  return out;
}

/**
 * Confidence that the misconception is genuinely gone, in [0,1].
 * Deliberately conservative: a single pass never reads as certainty.
 */
function resolutionConfidence(tracker) {
  if (!tracker) return 0;
  if (tracker.status === "entrenched") return 0;
  let c = 0;
  c += Math.min(tracker.passes, PASSES_TO_RESOLVE) / PASSES_TO_RESOLVE * 0.5;
  c += Math.min(tracker.transferPasses, 2) / 2 * 0.35;
  c += Math.min(tracker.probeShapesSeen.length, 3) / 3 * 0.15;
  c -= tracker.siblingSwaps * 0.2;
  c -= tracker.relapses * 0.25;
  return Number(Math.max(0, Math.min(1, c)).toFixed(3));
}

/** Sort key: who needs attention first. */
function priorityOf(tracker) {
  const base = { entrenched: 0, active: 1, resolving: 2, eradicated: 3 }[tracker.status] ?? 1;
  return base * 1000 - tracker.occurrences * 10 - tracker.relapses * 50;
}

module.exports = {
  STATES,
  PASSES_TO_RESOLVE,
  OCCURRENCES_TO_ENTRENCH,
  newTracker,
  shapeOf,
  applyObservation,
  recordIntervention,
  outstandingRequirements,
  resolutionConfidence,
  priorityOf,
};
