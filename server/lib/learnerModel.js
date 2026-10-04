/* ============================================================================
   Learner model — the persistent record of what this learner believes.

   WHAT WAS WRONG BEFORE
   `LearnerProfile` was defined in models/analytics.models.js and never written
   to: no create, no update, no read. Every number on the dashboard was
   recomputed from raw events on each request, the status state machine existed
   in two places that could disagree, and nothing survived a session.

   WHAT THIS DOES
   One authoritative store, written on every observation, holding per
   misconception state produced by resolutionProtocol.js. Works in two modes:

     mongo    when mongoose is connected
     memory   when it is not (server.js starts fail-open, so this is a real
              runtime state, not a theoretical one)

   The memory mode is a genuine fallback, not a stub: the same shapes, the same
   state machine, just not durable. Callers cannot tell the difference apart
   from `profile.persisted`.
   ========================================================================== */

const mongoose = require("mongoose");
const { LearnerProfile } = require("../models/analytics.models");
const {
  applyObservation,
  recordIntervention,
  resolutionConfidence,
  outstandingRequirements,
  priorityOf,
  shapeOf,
} = require("./resolutionProtocol");
const { getLabel, categoryFor } = require("./misconceptionBank");

const memory = new Map(); // identityKey -> profile

function dbUp() {
  return mongoose.connection && mongoose.connection.readyState === 1;
}

/** Stable identity: a logged-in user wins over a guest session key. */
function identityKey({ userId, sessionKey } = {}) {
  if (userId) return `u:${userId}`;
  return `s:${sessionKey || "guest_learner_default"}`;
}

function blankProfile({ userId, sessionKey } = {}) {
  return {
    identityKey: identityKey({ userId, sessionKey }),
    userId: userId || null,
    sessionKey: sessionKey || null,
    totalSubmissions: 0,
    totalCorrect: 0,
    masteryScore: 0,
    streakDays: 0,
    activeDays: [],
    lastActiveDate: null,
    domainMastery: {},     // category -> { attempted, correct, score }
    misconceptions: {},    // misconceptionId -> tracker
    persisted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/* ---------------------------------------------------------- derivations --- */

function dayStamp(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/** Consecutive days ending today (or yesterday — today may not have started). */
function computeStreak(activeDays = []) {
  if (!activeDays.length) return 0;
  const set = new Set(activeDays);
  const today = new Date();
  let cursor = new Date(today);
  if (!set.has(dayStamp(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!set.has(dayStamp(cursor))) return 0;
  }
  let streak = 0;
  while (set.has(dayStamp(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/**
 * Mastery: accuracy is only half the story. A learner who answers correctly
 * while still carrying live misconceptions has not mastered the material, so
 * the second half is the share of diagnosed beliefs that are verifiably gone.
 */
function computeMastery(profile) {
  const accuracy = profile.totalSubmissions ? profile.totalCorrect / profile.totalSubmissions : 0;
  const trackers = Object.values(profile.misconceptions || {});
  let resolvedShare = 1;
  if (trackers.length) {
    const cleared = trackers.filter((t) => t.status === "eradicated").length;
    const entrenched = trackers.filter((t) => t.status === "entrenched").length;
    resolvedShare = Math.max(0, (cleared - entrenched * 0.5) / trackers.length);
  }
  return Math.round(100 * (0.55 * accuracy + 0.45 * resolvedShare));
}

function recomputeDerived(profile) {
  profile.streakDays = computeStreak(profile.activeDays);
  profile.masteryScore = computeMastery(profile);
  profile.updatedAt = new Date();
  return profile;
}

/* ------------------------------------------------------------- storage --- */

function toMongoDoc(profile) {
  return {
    userId: profile.userId || undefined,
    sessionKey: profile.userId ? undefined : profile.sessionKey,
    masteryScore: profile.masteryScore,
    totalSubmissions: profile.totalSubmissions,
    totalCorrect: profile.totalCorrect,
    streakDays: profile.streakDays,
    activeDays: profile.activeDays,
    lastActiveDate: profile.lastActiveDate,
    domainMastery: profile.domainMastery,
    misconceptionTracker: profile.misconceptions,
  };
}

function fromMongoDoc(doc, ident) {
  const plain = typeof doc.toObject === "function" ? doc.toObject() : doc;
  const trackers = plain.misconceptionTracker || {};
  return {
    identityKey: identityKey(ident),
    userId: plain.userId ? String(plain.userId) : null,
    sessionKey: plain.sessionKey || null,
    totalSubmissions: plain.totalSubmissions || 0,
    totalCorrect: plain.totalCorrect || 0,
    masteryScore: plain.masteryScore || 0,
    streakDays: plain.streakDays || 0,
    activeDays: plain.activeDays || [],
    lastActiveDate: plain.lastActiveDate || null,
    domainMastery: plain.domainMastery || {},
    misconceptions: trackers instanceof Map ? Object.fromEntries(trackers) : trackers,
    persisted: true,
    createdAt: plain.createdAt || new Date(),
    updatedAt: plain.updatedAt || new Date(),
  };
}

async function load(ident) {
  const key = identityKey(ident);
  if (dbUp()) {
    try {
      const query = ident.userId ? { userId: ident.userId } : { sessionKey: ident.sessionKey };
      const doc = await LearnerProfile.findOne(query).lean();
      if (doc) return fromMongoDoc(doc, ident);
      return { ...blankProfile(ident), persisted: true };
    } catch (err) {
      console.warn(`[learnerModel] mongo read failed, using memory: ${err.message}`);
    }
  }
  if (!memory.has(key)) memory.set(key, blankProfile(ident));
  return memory.get(key);
}

async function save(profile, ident) {
  recomputeDerived(profile);
  if (dbUp()) {
    try {
      const query = ident.userId ? { userId: ident.userId } : { sessionKey: ident.sessionKey };
      await LearnerProfile.findOneAndUpdate(
        query,
        { $set: toMongoDoc(profile) },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      profile.persisted = true;
      // keep the memory mirror warm so a mid-session DB drop is seamless
      memory.set(profile.identityKey, profile);
      return profile;
    } catch (err) {
      console.warn(`[learnerModel] mongo write failed, kept in memory: ${err.message}`);
    }
  }
  profile.persisted = false;
  memory.set(profile.identityKey, profile);
  return profile;
}

/* ------------------------------------------------------------ mutations --- */

/**
 * Fold one answered item into the learner model.
 *
 * `targetsMisconceptionId` is the crucial argument: it is the misconception the
 * ITEM probes, which is what licenses crediting or debiting that belief. The old
 * code credited by category, which is why one correct answer cleared a whole
 * domain.
 */
async function applyEvent(ident, event = {}) {
  const profile = await load(ident);

  const at = event.at ? new Date(event.at) : new Date();
  const stamp = dayStamp(at);
  if (!profile.activeDays.includes(stamp)) profile.activeDays.push(stamp);
  profile.activeDays = profile.activeDays.slice(-400);
  profile.lastActiveDate = at;

  profile.totalSubmissions += 1;
  if (event.correct) profile.totalCorrect += 1;

  /* ---- domain mastery, per category -------------------------------------- */
  const cat = event.category || "Uncategorised";
  const dm = profile.domainMastery[cat] || { attempted: 0, correct: 0, score: 0 };
  dm.attempted += 1;
  if (event.correct) dm.correct += 1;
  dm.score = Math.round((dm.correct / Math.max(dm.attempted, 1)) * 100);
  profile.domainMastery[cat] = dm;

  /* ---- misconception tracking, keyed on the stable numeric id ------------- */
  const targetId = Number(
    event.targetsMisconceptionId != null ? event.targetsMisconceptionId : event.misconceptionId
  );

  if (Number.isFinite(targetId) && targetId > 0) {
    const label = getLabel(targetId);
    const key = String(targetId);
    const existing = profile.misconceptions[key] || null;

    profile.misconceptions[key] = applyObservation(existing, {
      misconceptionId: targetId,
      correct: !!event.correct,
      // An item credits a belief only when it actually probes that belief.
      targeted: event.targeted !== false,
      chosenSibling: event.chosenSibling || null,
      shape: event.shape || shapeOf(event),
      interventionId: event.interventionId || null,
      at,
      category: label ? label.category : cat,
      name: label ? label.description : event.misconceptionName || null,
    });
  }

  await save(profile, ident);
  return profile;
}

/** Note that a targeted intervention was delivered (opens a verification window). */
async function markInterventionDelivered(ident, { misconceptionId, interventionId, at } = {}) {
  const profile = await load(ident);
  const id = Number(misconceptionId);
  if (!Number.isFinite(id) || id <= 0) return profile;
  const label = getLabel(id);
  const key = String(id);
  profile.misconceptions[key] = recordIntervention(profile.misconceptions[key], {
    misconceptionId: id,
    interventionId,
    at,
    category: label ? label.category : null,
    name: label ? label.description : null,
  });
  await save(profile, ident);
  return profile;
}

async function resetProfile(ident) {
  const key = identityKey(ident);
  memory.delete(key);
  if (dbUp()) {
    try {
      const query = ident.userId ? { userId: ident.userId } : { sessionKey: ident.sessionKey };
      await LearnerProfile.deleteOne(query);
    } catch (err) {
      console.warn(`[learnerModel] mongo reset failed: ${err.message}`);
    }
  }
  const fresh = blankProfile(ident);
  memory.set(key, fresh);
  return fresh;
}

/* -------------------------------------------------------------- reading --- */

/** Trackers as a sorted array, with derived fields the UI needs. */
function trackerList(profile) {
  return Object.values(profile.misconceptions || {})
    .map((t) => ({
      ...t,
      resolutionConfidence: resolutionConfidence(t),
      outstanding: outstandingRequirements(t),
    }))
    .sort((a, b) => priorityOf(a) - priorityOf(b));
}

/** Headline counts the dashboard reads, all derived from one place. */
function summarise(profile) {
  const trackers = Object.values(profile.misconceptions || {});
  const by = (s) => trackers.filter((t) => t.status === s).length;
  return {
    masteryScore: profile.masteryScore,
    totalSubmissions: profile.totalSubmissions,
    totalCorrect: profile.totalCorrect,
    accuracy: profile.totalSubmissions
      ? Math.round((profile.totalCorrect / profile.totalSubmissions) * 100)
      : 0,
    streakDays: profile.streakDays,
    misconceptionsSeen: trackers.length,
    entrenched: by("entrenched"),
    active: by("active"),
    resolving: by("resolving"),
    eradicated: by("eradicated"),
    interventionsDelivered: trackers.reduce((s, t) => s + (t.interventionCount || 0), 0),
    relapses: trackers.reduce((s, t) => s + (t.relapses || 0), 0),
    siblingSwaps: trackers.reduce((s, t) => s + (t.siblingSwaps || 0), 0),
    persisted: !!profile.persisted,
    storage: dbUp() ? "mongo" : "memory",
  };
}

module.exports = {
  identityKey,
  blankProfile,
  load,
  save,
  applyEvent,
  markInterventionDelivered,
  resetProfile,
  trackerList,
  summarise,
  computeStreak,
  computeMastery,
  dbUp,
  _memory: memory,
};
