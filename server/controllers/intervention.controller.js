const mongoose = require("mongoose");
const { InterventionAttempt } = require("../models/analytics.models");
const { buildIntervention } = require("../services/intervention.service");

const memoryAttempts = [];

function identity(req) {
  return {
    userId: req.user || null,
    sessionKey: req.headers["x-guest-session"] || req.body?.sessionKey || req.query.sessionKey || "guest_learner_default",
  };
}

function dbReady() {
  return mongoose.connection && mongoose.connection.readyState === 1;
}

exports.next = async (req, res) => {
  const { diagnosis, problemId, availableProblems, recentProblemIds } = req.body || {};
  if (!diagnosis || !Number.isInteger(Number(problemId))) {
    return res.status(400).json({ message: "diagnosis and problemId are required" });
  }

  const intervention = buildIntervention({ diagnosis, problemId, availableProblems, recentProblemIds });
  return res.json({ success: true, intervention });
};

exports.recordAttempt = async (req, res) => {
  const { userId, sessionKey } = identity(req);
  const { interventionId, misconceptionId, problemId, correct, diagnosisConfidence } = req.body || {};
  if (!interventionId || !misconceptionId || !Number.isInteger(Number(problemId)) || typeof correct !== "boolean") {
    return res.status(400).json({ message: "interventionId, misconceptionId, problemId, and correct are required" });
  }

  const prior = memoryAttempts.filter((attempt) => attempt.sessionKey === sessionKey && attempt.misconceptionId === String(misconceptionId));
  const successful = prior.filter((attempt) => attempt.correct).length + (correct ? 1 : 0);
  const status = correct ? (successful >= 2 ? "eradicated" : "resolving") : "active";
  const attempt = {
    userId: userId ? new mongoose.Types.ObjectId(userId) : undefined,
    sessionKey,
    interventionId: String(interventionId),
    misconceptionId: String(misconceptionId),
    problemId: String(problemId),
    correct,
    diagnosisConfidence: Number(diagnosisConfidence || 0),
    status,
    createdAt: new Date(),
  };

  memoryAttempts.push(attempt);
  if (dbReady()) {
    try { await InterventionAttempt.create(attempt); } catch (err) { console.warn("Intervention attempt write failed:", err.message); }
  }

  return res.status(201).json({ success: true, status, successfulReassessments: successful });
};

exports.history = async (req, res) => {
  const { userId, sessionKey } = identity(req);
  let attempts = memoryAttempts.filter((attempt) => attempt.sessionKey === sessionKey || (userId && String(attempt.userId) === String(userId)));
  if (dbReady()) {
    try {
      const query = userId ? { $or: [{ sessionKey }, { userId }] } : { sessionKey };
      const stored = await InterventionAttempt.find(query).sort({ createdAt: -1 }).lean();
      if (stored.length) attempts = stored;
    } catch (err) { console.warn("Intervention history read failed:", err.message); }
  }
  return res.json({ success: true, attempts });
};