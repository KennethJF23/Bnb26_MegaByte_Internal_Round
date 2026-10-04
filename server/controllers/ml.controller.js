// Thin proxy from Express to the FastAPI model service (server/ml_service/serve.py)
const ML_URL = process.env.ML_URL || "http://127.0.0.1:8000"; // 127.0.0.1, not "localhost" (IPv6 issue on Node 18+)
const User = require("../models/users.models");

async function forward(res, path, options = {}, onSuccess) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`${ML_URL}${path}`, { ...options, signal: ctrl.signal });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ message: data.detail || "ML service error" });
    if (onSuccess) await onSuccess(data);
    return res.json(data);
  } catch {
    return res.status(503).json({ message: "ML service unavailable. Is uvicorn running on port 8000?" });
  } finally {
    clearTimeout(timer);
  }
}

exports.problems = (req, res) => forward(res, "/problems");

exports.intervention = (req, res) => {
  const { current_difficulty, correct, wrong_streak, confidence } = req.body || {};
  if (typeof current_difficulty !== "string" || typeof correct !== "boolean") {
    return res.status(400).json({ message: "current_difficulty and correct are required" });
  }
  return forward(res, "/intervention", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      current_difficulty,
      correct,
      wrong_streak: Number.isInteger(wrong_streak) ? wrong_streak : 0,
      confidence: typeof confidence === "number" ? confidence : 0
    })
  });
};

exports.submit = (req, res) => {
  const { problem_id, code } = req.body || {};
  if (!Number.isInteger(problem_id) || typeof code !== "string" || !code.trim()) {
    return res.status(400).json({ message: "problem_id and code are required" });
  }
  if (code.length > 5000) return res.status(413).json({ message: "Code is too long (max 5000 characters)" });
  return forward(res, "/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ problem_id, code }),
  }, async (result) => {
    try {
      await User.findByIdAndUpdate(req.user, { $push: { "progress.codeAttempts": {
        problemId: problem_id,
        topic: result.category || "Unknown",
        difficulty: result.difficulty || "Unknown",
        correct: result.correct,
        createdAt: new Date()
      } } });
    } catch (err) {
      console.error("Record code attempt error:", err);
    }
  });
};

exports.health = (req, res) => forward(res, "/health");