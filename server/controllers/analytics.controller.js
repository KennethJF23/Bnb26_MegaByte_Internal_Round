/* ============================================================================
   Analytics + learner-model API.

   WHAT CHANGED AND WHY

   1. No more fabricated history on the normal read path.
      getTrends used to call generateRealisticSeedHistory() whenever a learner
      had no events, splice the result into the live store, and return it
      indistinguishably from real data. Its misconception names ("Loop counter
      retains mutation outside expected scope") do not exist in the 67-label
      bank, so the dashboard showed a confident 30-day story about beliefs the
      model cannot even emit. Seeding now happens only when explicitly asked
      for, is built from real bank ids, and every response carries
      `synthetic: true` so the UI can label it.

   2. Misconception identity is the stable numeric id, never the prose.
      Aggregating on misconceptionName meant any wording change forked one
      belief into two rows.

   3. Resolution state comes from lib/resolutionProtocol via lib/learnerModel —
      one state machine, persisted. The old category-wide `consecutivePasses`
      loop is gone entirely.

   4. Recommendations come from lib/interventionEngine, selected on the
      diagnosis and the learner's history with that belief, not `idx % 2`.
   ========================================================================== */

const mongoose = require("mongoose");
const { PerformanceEvent } = require("../models/analytics.models");
const learner = require("../lib/learnerModel");
const { recommendNext } = require("../lib/interventionEngine");
const bank = require("../lib/misconceptionBank");
const { shapeOf } = require("../lib/resolutionProtocol");

/* In-memory event mirror, used when Mongo is down (server.js starts fail-open). */
const memoryStore = { events: [] };

function resolveIdentifier(req) {
  const userId = req.user || null;
  const sessionKey =
    req.headers["x-guest-session"] ||
    req.query.sessionKey ||
    (req.body && req.body.sessionKey) ||
    "guest_learner_default";
  return { userId, sessionKey };
}

function isDbReady() {
  return mongoose.connection && mongoose.connection.readyState === 1;
}

function sinceFor(timeRange) {
  const now = Date.now();
  if (timeRange === "7d") return new Date(now - 7 * 864e5);
  if (timeRange === "30d") return new Date(now - 30 * 864e5);
  return null; // "all"
}

/** Read this learner's events from Mongo when possible, memory otherwise. */
async function loadEvents({ userId, sessionKey }, { timeRange = "30d", category = "All" } = {}) {
  const since = sinceFor(timeRange);
  const catWanted = category && category !== "All" && category !== "All Topics" ? category : null;

  if (isDbReady()) {
    try {
      const query = userId
        ? { $or: [{ userId: new mongoose.Types.ObjectId(userId) }, { sessionKey }] }
        : { sessionKey };
      if (catWanted) query.category = catWanted;
      if (since) query.createdAt = { $gte: since };
      return await PerformanceEvent.find(query).sort({ createdAt: 1 }).lean();
    } catch (err) {
      console.warn("[analytics] mongo read failed, using memory:", err.message);
    }
  }

  return memoryStore.events
    .filter((e) => {
      const mine = e.sessionKey === sessionKey || (userId && String(e.userId) === String(userId));
      const inCat = !catWanted || e.category === catWanted;
      const inWindow = !since || new Date(e.createdAt) >= since;
      return mine && inCat && inWindow;
    })
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

/* ========================= time-series from events ========================= */
/*
   Events carry the chronology; the learner profile carries belief state. Keeping
   them separate is what removed the need to re-derive the state machine here.
*/
function computeTimeSeries(events) {
  const sorted = [...events].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  let totalCorrect = 0, testsPassed = 0, testsTotal = 0;
  const catMap = {};
  const dayMap = {};
  const metacog = { calibrated: 0, overconfident: 0, underconfident: 0, awareError: 0 };

  for (const e of sorted) {
    if (e.correct) totalCorrect++;
    testsPassed += Number(e.testsPassed || (e.correct ? 1 : 0));
    testsTotal += Number(e.testsTotal || 1);

    const cat = e.category || "Uncategorised";
    catMap[cat] = catMap[cat] || { attempted: 0, correct: 0 };
    catMap[cat].attempted++;
    if (e.correct) catMap[cat].correct++;

    /* Calibration: only meaningful when the learner actually reported a
       confidence. Unspecified is not counted as "calibrated". */
    const conf = (e.studentConfidence || "unspecified").toLowerCase();
    if (conf !== "unspecified") {
      if (e.correct) {
        if (conf === "high") metacog.calibrated++;
        else metacog.underconfident++;
      } else {
        if (conf === "high") metacog.overconfident++;
        else metacog.awareError++;
      }
    }

    const day = new Date(e.createdAt).toISOString().slice(0, 10);
    dayMap[day] = dayMap[day] || { date: day, attempts: 0, correct: 0, tp: 0, tt: 0 };
    dayMap[day].attempts++;
    if (e.correct) dayMap[day].correct++;
    dayMap[day].tp += Number(e.testsPassed || (e.correct ? 1 : 0));
    dayMap[day].tt += Number(e.testsTotal || 1);
  }

  const dailyTrend = Object.values(dayMap)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      date: d.date,
      accuracy: Math.round((d.correct / Math.max(1, d.attempts)) * 100),
      testPassRate: Math.round((d.tp / Math.max(1, d.tt)) * 100),
      attempts: d.attempts,
    }));

  /* Velocity: second half vs first half. Needs enough points to mean anything,
     so below 6 attempts it reports null rather than a noisy number. */
  let velocityDelta = null;
  if (sorted.length >= 6) {
    const half = Math.floor(sorted.length / 2);
    const r1 = sorted.slice(0, half).filter((x) => x.correct).length / half;
    const r2 = sorted.slice(half).filter((x) => x.correct).length / (sorted.length - half);
    velocityDelta = Math.round((r2 - r1) * 100);
  }

  const categoryBreakdown = {};
  for (const [c, v] of Object.entries(catMap)) {
    const score = Math.round((v.correct / Math.max(1, v.attempted)) * 100);
    categoryBreakdown[c] = {
      attempted: v.attempted,
      correct: v.correct,
      score,
      status: score >= 80 ? "Mastered" : score >= 50 ? "Proficient" : "Developing",
    };
  }

  return {
    accuracy: sorted.length ? Math.round((totalCorrect / sorted.length) * 100) : 0,
    testPassRate: testsTotal ? Math.round((testsPassed / testsTotal) * 100) : 0,
    totalEvents: sorted.length,
    velocityDelta,
    dailyTrend,
    categoryBreakdown,
    metacognition: metacog,
  };
}

/** Trackers -> the matrix the dashboard renders, with the evidence chain. */
function misconceptionMatrix(profile) {
  return learner.trackerList(profile).map((t) => ({
    misconceptionId: t.misconceptionId,
    name: t.name,
    category: t.category,
    occurrences: t.occurrences,
    status: t.status,

    interventionCount: t.interventionCount,
    passes: t.passes,
    transferPasses: t.transferPasses,
    shapesPassed: (t.probeShapesSeen || []).length,
    siblingSwaps: t.siblingSwaps,
    relapses: t.relapses,

    resolutionConfidence: t.resolutionConfidence,
    outstanding: t.outstanding,

    firstSeen: t.firstSeen,
    lastSeen: t.lastSeen,
    resolvedAt: t.resolvedAt,

    confusableWith: bank.siblingsOf(t.misconceptionId).map((id) => ({
      misconceptionId: id,
      description: bank.describe(id),
    })),

    history: (t.history || []).slice(-8),
  }));
}

/* ============================== 1. record =============================== */

exports.recordEvent = async (req, res) => {
  try {
    const ident = resolveIdentifier(req);
    const b = req.body || {};

    if (!b.eventType || !b.title || !b.category || typeof b.correct !== "boolean") {
      return res.status(400).json({ message: "eventType, title, category, and correct boolean are required" });
    }

    /* The misconception this ITEM probes. Credit and debit attach to this id.
       Falls back to misconceptionId (what was diagnosed) when the caller did not
       distinguish them. */
    const targetId = Number(b.targetsMisconceptionId ?? b.misconceptionId);
    const hasTarget = Number.isFinite(targetId) && targetId > 0;
    const label = hasTarget ? bank.getLabel(targetId) : null;

    const eventPayload = {
      userId: ident.userId ? new mongoose.Types.ObjectId(ident.userId) : undefined,
      sessionKey: ident.sessionKey,
      eventType: b.eventType,
      problemId: String(b.problemId || "prob_custom"),
      title: b.title,
      category: b.category,
      difficulty: b.difficulty || "Intermediate",
      correct: b.correct,
      testsPassed: Number(b.testsPassed ?? (b.correct ? 1 : 0)),
      testsTotal: Number(b.testsTotal ?? 1),

      misconceptionId: hasTarget ? String(targetId) : null,
      /* No invented label. The old code defaulted this to "Identified Logic Bug"
         for any wrong answer, manufacturing a misconception record where the
         model had produced no diagnosis. */
      misconceptionName: label ? label.description : b.misconceptionName || null,
      misconceptionConfidence: Number(b.misconceptionConfidence ?? 0),

      targetsMisconceptionId: hasTarget ? targetId : null,
      targeted: b.targeted !== false,
      interventionId: b.interventionId || null,
      attemptNumber: Number(b.attemptNumber || 1),
      probeShape: b.probeShape || shapeOf(b),
      chosenSibling: Number.isFinite(Number(b.chosenSibling)) ? Number(b.chosenSibling) : null,
      engine: ["model", "rules", "learner-probe"].includes(b.engine) ? b.engine : "none",
      ambiguous: !!b.ambiguous,

      /* Only record a duration the client actually measured. The previous build
         sent a random number, which made the metric meaningless. */
      timeSpentSec: Number.isFinite(Number(b.timeSpentSec)) ? Number(b.timeSpentSec) : null,
      studentConfidence: b.studentConfidence || "unspecified",
      metadata: b.metadata || {},
      createdAt: new Date(),
    };

    memoryStore.events.push(eventPayload);
    if (memoryStore.events.length > 5000) memoryStore.events.shift();

    if (isDbReady()) {
      try {
        await PerformanceEvent.create(eventPayload);
      } catch (dbErr) {
        console.warn("[analytics] event write failed, kept in memory:", dbErr.message);
      }
    }

    /* Fold into the persistent learner model and hand back the updated tracker,
       so the UI can show resolution progress without a second round trip. */
    const profile = await learner.applyEvent(ident, {
      correct: eventPayload.correct,
      category: eventPayload.category,
      targetsMisconceptionId: eventPayload.targetsMisconceptionId,
      targeted: eventPayload.targeted,
      chosenSibling: eventPayload.chosenSibling,
      shape: eventPayload.probeShape,
      interventionId: eventPayload.interventionId,
      at: eventPayload.createdAt,
      misconceptionName: eventPayload.misconceptionName,
    });

    const tracker = hasTarget ? profile.misconceptions[String(targetId)] || null : null;

    return res.status(201).json({
      success: true,
      tracker: tracker
        ? {
            ...tracker,
            resolutionConfidence: require("../lib/resolutionProtocol").resolutionConfidence(tracker),
            outstanding: require("../lib/resolutionProtocol").outstandingRequirements(tracker),
          }
        : null,
      profile: learner.summarise(profile),
    });
  } catch (err) {
    console.error("[analytics] recordEvent:", err);
    return res.status(500).json({ message: "Failed to record event", error: err.message });
  }
};

/* ============================== 2. trends =============================== */

exports.getTrends = async (req, res) => {
  try {
    const ident = resolveIdentifier(req);
    const { timeRange = "30d", category = "All" } = req.query;

    const events = await loadEvents(ident, { timeRange, category });
    const profile = await learner.load(ident);
    const series = computeTimeSeries(events);
    const matrix = misconceptionMatrix(profile);
    const summary = learner.summarise(profile);

    const synthetic = events.some((e) => e.metadata && e.metadata.synthetic);

    return res.json({
      success: true,
      timeRange,
      category,

      /* Honest empty state. No backfill — if there is nothing here, the UI says
         so and invites the learner to start, which is more useful than a
         fictional trend line. */
      isEmpty: events.length === 0 && matrix.length === 0,
      synthetic,

      metrics: {
        /* mastery now reflects verified resolution, not raw accuracy */
        masteryIndex: summary.masteryScore,
        accuracy: series.accuracy,
        testPassRate: series.testPassRate,
        velocityDelta: series.velocityDelta,
        totalEvents: series.totalEvents,

        activeMisconceptions: summary.active + summary.entrenched,
        resolvedMisconceptions: summary.eradicated,
        resolvingMisconceptions: summary.resolving,
        entrenchedMisconceptions: summary.entrenched,

        dailyTrend: series.dailyTrend,
        categoryBreakdown: series.categoryBreakdown,
        misconceptionMatrix: matrix,
        metacognition: series.metacognition,
      },

      learnerModel: {
        ...summary,
        domainMastery: profile.domainMastery,
        lastActiveDate: profile.lastActiveDate,
      },
    });
  } catch (err) {
    console.error("[analytics] getTrends:", err);
    return res.status(500).json({ message: "Failed to compute trends", error: err.message });
  }
};

/* ========================= 3. recommendations ========================== */

exports.getRecommendations = async (req, res) => {
  try {
    const ident = resolveIdentifier(req);
    const profile = await learner.load(ident);
    const trackers = learner.trackerList(profile);

    const seenItemIds = Array.isArray(req.query.seen)
      ? req.query.seen
      : typeof req.query.seen === "string"
      ? req.query.seen.split(",").filter(Boolean)
      : [];

    const interventions = recommendNext(trackers, { limit: 3, seenItemIds });

    if (interventions.length === 0) {
      const anySeen = trackers.length > 0;
      return res.json({
        success: true,
        recommendations: [],
        /* Say what is actually true rather than asserting mastery. A learner
           with no diagnosed misconceptions has not proven anything yet. */
        emptyReason: anySeen
          ? "Every diagnosed misconception has been verified as resolved. Nothing is queued."
          : "No misconception has been diagnosed yet. Answer a few diagnostic items to build the learner model.",
        nextStep: anySeen ? null : { label: "Start the MCQ diagnostic", url: "#/mcq" },
      });
    }

    return res.json({
      success: true,
      recommendations: interventions.map((iv) => ({
        id: iv.interventionId,
        misconceptionId: iv.misconceptionId,
        priority:
          iv.tier === 4 ? "CRITICAL" : iv.tier === 3 ? "VERIFY" : iv.tier === 2 ? "DISCRIMINATE" : "TEACH",
        title: iv.misconception,
        category: iv.category,
        tier: iv.tier,
        tierName: iv.tierName,
        goal: iv.goal,
        /* modality follows the item the engine actually chose */
        type: iv.item ? "mcq" : "explanation",
        actionUrl: iv.item ? `#/mcq?q=${encodeURIComponent(iv.item.id)}` : "#/mcq",
        estimatedMin: iv.estimatedMin,
        reason: iv.rationale.why.join(" · "),
        itemChoice: iv.rationale.itemChoice,
        confusableWith: iv.confusableWith,
        outstanding: iv.outstanding,
        resolutionConfidence: iv.resolutionConfidence,
        hints: iv.hints,
        item: iv.item,
      })),
    });
  } catch (err) {
    console.error("[analytics] getRecommendations:", err);
    return res.status(500).json({ message: "Error building recommendations", error: err.message });
  }
};

/* ============================== 4. export ============================== */

exports.exportReport = async (req, res) => {
  try {
    const ident = resolveIdentifier(req);
    const events = await loadEvents(ident, { timeRange: "all", category: "All" });
    const profile = await learner.load(ident);
    const series = computeTimeSeries(events);
    const summary = learner.summarise(profile);
    const matrix = misconceptionMatrix(profile);

    const report = {
      exportTimestamp: new Date().toISOString(),
      learner: {
        session: ident.sessionKey,
        userId: ident.userId || "guest",
        storage: summary.storage,
        persisted: summary.persisted,
      },
      executiveSummary: {
        masteryScore: `${summary.masteryScore}%`,
        rawAccuracy: `${series.accuracy}%`,
        testPassRate: `${series.testPassRate}%`,
        learningVelocity: series.velocityDelta === null ? "insufficient data" : `${series.velocityDelta >= 0 ? "+" : ""}${series.velocityDelta}%`,
        attemptsRecorded: series.totalEvents,
        misconceptionsDiagnosed: summary.misconceptionsSeen,
        verifiedResolved: summary.eradicated,
        stillOpen: summary.active + summary.entrenched,
        relapses: summary.relapses,
        beliefSwaps: summary.siblingSwaps,
      },
      /* The standard being applied, stated in the export so a reader knows what
         "resolved" means here. */
      resolutionStandard: {
        retestsRequired: require("../lib/resolutionProtocol").PASSES_TO_RESOLVE,
        transferRequired: 1,
        note: "A misconception is only credited by items that probe it directly, and must survive a change of item shape. Selecting a sibling misconception's distractor withholds credit.",
      },
      misconceptionTrajectory: matrix,
      domainMastery: series.categoryBreakdown,
      chronology: series.dailyTrend,
      calibration: series.metacognition,
      modelCoverage: bank.coverage(),
      rawEventCount: events.length,
      containsSyntheticData: events.some((e) => e.metadata && e.metadata.synthetic),
    };

    res.setHeader("Content-Disposition", 'attachment; filename="ReLearn_Learner_Report.json"');
    res.setHeader("Content-Type", "application/json");
    return res.send(JSON.stringify(report, null, 2));
  } catch (err) {
    return res.status(500).json({ message: "Error exporting report", error: err.message });
  }
};

/* ============================ 5. seed demo ============================= */
/*
   Explicit, opt-in, and labelled. Built from REAL bank ids and pushed through
   the real resolution protocol, so the resulting dashboard is a genuine
   consequence of the state machine rather than a hand-drawn picture of one.
*/
const DEMO_SCRIPT = [
  // misconceptionId, dayOffset, correct, shape, note
  { id: 1,  day: 26, correct: false, shape: "mcq#1" },
  { id: 1,  day: 25, correct: false, shape: "code#3" },
  { id: 13, day: 24, correct: false, shape: "mcq#17" },
  { id: 6,  day: 22, correct: false, shape: "mcq#11" },
  { id: 1,  day: 20, intervention: true },
  { id: 1,  day: 19, correct: true,  shape: "mcq#1" },
  { id: 1,  day: 18, correct: true,  shape: "code#3" },   // transfer -> eradicated
  { id: 13, day: 16, intervention: true },
  { id: 13, day: 15, correct: true,  shape: "mcq#17" },
  { id: 13, day: 14, correct: true,  shape: "mcq#17" },   // no transfer yet -> resolving
  { id: 6,  day: 12, intervention: true },
  { id: 6,  day: 11, correct: true,  shape: "mcq#11", chosenSibling: 8 }, // belief swap
  { id: 6,  day: 9,  correct: false, shape: "mcq#11" },
  { id: 63, day: 7,  correct: false, shape: "mcq#80" },
  { id: 63, day: 6,  correct: false, shape: "mcq#80" },
  { id: 63, day: 5,  correct: false, shape: "code#12" },  // -> entrenched
  { id: 15, day: 4,  correct: false, shape: "mcq#21" },
  { id: 15, day: 3,  intervention: true },
  { id: 15, day: 2,  correct: true,  shape: "mcq#21" },
  { id: 15, day: 1,  correct: true,  shape: "code#9" },   // transfer -> eradicated
];

exports.seedDemoData = async (req, res) => {
  try {
    const ident = resolveIdentifier(req);
    const dayMs = 864e5;
    const now = Date.now();

    // start from a clean slate so the script's outcome is deterministic
    memoryStore.events = memoryStore.events.filter((e) => e.sessionKey !== ident.sessionKey);
    if (isDbReady()) {
      try {
        await PerformanceEvent.deleteMany({ sessionKey: ident.sessionKey });
      } catch (err) {
        console.warn("[analytics] seed cleanup skipped:", err.message);
      }
    }
    await learner.resetProfile(ident);

    const created = [];
    for (const step of DEMO_SCRIPT) {
      const at = new Date(now - step.day * dayMs);
      const label = bank.getLabel(step.id);

      if (step.intervention) {
        await learner.markInterventionDelivered(ident, {
          misconceptionId: step.id,
          interventionId: `iv_${step.id}_demo`,
          at,
        });
        continue;
      }

      const payload = {
        userId: ident.userId ? new mongoose.Types.ObjectId(ident.userId) : undefined,
        sessionKey: ident.sessionKey,
        eventType: step.shape.startsWith("code") ? "code_submission" : "mcq_assessment",
        problemId: step.shape.replace(/^\D+/, ""),
        title: label ? label.description.slice(0, 70) : `Misconception #${step.id}`,
        category: label ? label.category : "Uncategorised",
        difficulty: "Intermediate",
        correct: !!step.correct,
        testsPassed: step.correct ? 5 : 2,
        testsTotal: 5,
        misconceptionId: String(step.id),
        misconceptionName: label ? label.description : null,
        misconceptionConfidence: step.correct ? 0 : 0.62,
        targetsMisconceptionId: step.id,
        targeted: true,
        interventionId: `iv_${step.id}_demo`,
        probeShape: step.shape,
        chosenSibling: step.chosenSibling || null,
        engine: "model",
        ambiguous: false,
        timeSpentSec: null,
        studentConfidence: "unspecified",
        // the flag that keeps this distinguishable from real history, forever
        metadata: { synthetic: true, seededAt: new Date().toISOString() },
        createdAt: at,
      };

      memoryStore.events.push(payload);
      created.push(payload);

      await learner.applyEvent(ident, {
        correct: payload.correct,
        category: payload.category,
        targetsMisconceptionId: step.id,
        targeted: true,
        chosenSibling: step.chosenSibling || null,
        shape: step.shape,
        interventionId: payload.interventionId,
        at,
      });
    }

    if (isDbReady()) {
      try {
        await PerformanceEvent.insertMany(created);
      } catch (err) {
        console.warn("[analytics] seed write skipped:", err.message);
      }
    }

    const profile = await learner.load(ident);
    return res.json({
      success: true,
      synthetic: true,
      message: `Seeded ${created.length} synthetic attempts across ${new Set(DEMO_SCRIPT.map((s) => s.id)).size} real misconceptions. Every resulting status was produced by the live resolution protocol.`,
      count: created.length,
      outcome: learner.summarise(profile),
    });
  } catch (err) {
    console.error("[analytics] seedDemoData:", err);
    return res.status(500).json({ message: "Error seeding demo data", error: err.message });
  }
};

/* ============================== 6. reset =============================== */

exports.resetData = async (req, res) => {
  try {
    const ident = resolveIdentifier(req);
    memoryStore.events = memoryStore.events.filter((e) => e.sessionKey !== ident.sessionKey);

    if (isDbReady()) {
      try {
        await PerformanceEvent.deleteMany({ sessionKey: ident.sessionKey });
      } catch (err) {
        console.warn("[analytics] reset delete skipped:", err.message);
      }
    }
    await learner.resetProfile(ident);

    return res.json({ success: true, message: "Learner model and event history cleared." });
  } catch (err) {
    return res.status(500).json({ message: "Error resetting data", error: err.message });
  }
};

/* ========================= 7. learner model read ======================= */
/*
   The learner model as its own resource. The brief asks the system to "track
   recurring misconceptions and demonstrated understanding across attempts", so
   that record deserves a first-class endpoint rather than living only as a
   by-product of the trends aggregation.
*/
exports.getLearnerModel = async (req, res) => {
  try {
    const ident = resolveIdentifier(req);
    const profile = await learner.load(ident);
    return res.json({
      success: true,
      summary: learner.summarise(profile),
      domainMastery: profile.domainMastery,
      misconceptions: misconceptionMatrix(profile),
      activeDays: profile.activeDays,
      lastActiveDate: profile.lastActiveDate,
    });
  } catch (err) {
    return res.status(500).json({ message: "Error reading learner model", error: err.message });
  }
};
