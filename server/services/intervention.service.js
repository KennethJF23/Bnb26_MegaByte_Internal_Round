const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BANK_PATH = path.join(__dirname, "..", "ml_service", "dataset", "misconception_bank.json");

let bankById = new Map();
try {
  const bank = JSON.parse(fs.readFileSync(BANK_PATH, "utf8"));
  bankById = new Map(bank.map((item) => [String(item.id), item]));
} catch (err) {
  console.warn("Could not load misconception bank:", err.message);
}

const cleanText = (value) => String(value || "")
  .replace(/```[a-z]*\n?/gi, "")
  .replace(/```/g, "")
  .replace(/\*\*/g, "")
  .trim();

const diagnosisFrom = (diagnosis) => diagnosis?.diagnosis || diagnosis || null;

function chooseProblem(availableProblems, currentProblemId, description, recentProblemIds = []) {
  const currentId = String(currentProblemId || "");
  const recent = new Set(recentProblemIds.map(String));
  const candidates = (availableProblems || []).filter((problem) => String(problem.id) !== currentId);
  const unused = candidates.filter((problem) => !recent.has(String(problem.id)));
  const pool = unused.length ? unused : candidates;
  if (!pool.length) return availableProblems?.find((problem) => String(problem.id) === currentId) || null;

  const words = String(description || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3);
  return [...pool].sort((a, b) => {
    const aText = `${a.title} ${a.description}`.toLowerCase();
    const bText = `${b.title} ${b.description}`.toLowerCase();
    const aScore = words.reduce((score, word) => score + (aText.includes(word) ? 1 : 0), 0);
    const bScore = words.reduce((score, word) => score + (bText.includes(word) ? 1 : 0), 0);
    return bScore - aScore;
  })[0];
}

function buildIntervention({ diagnosis, problemId, availableProblems = [], recentProblemIds = [] }) {
  const detected = diagnosisFrom(diagnosis);
  if (!detected || detected.misconception_id === undefined || detected.misconception_id === null) return null;
  if (diagnosis?.uncertain) return null;

  const misconceptionId = String(detected.misconception_id);
  if (misconceptionId === "0") return null;

  const bankItem = bankById.get(misconceptionId);
  const description = detected.description || bankItem?.description || "A misconception was detected in this response.";
  const example = cleanText(bankItem?.example || "Review the rule, then apply it to a new problem.");
  const practiceProblem = chooseProblem(availableProblems, problemId, description, recentProblemIds);
  const confidence = Number(detected.confidence || 0);
  const interventionType = confidence >= 0.8 ? "worked_example" : "clarification_check";

  return {
    id: `int_${crypto.randomUUID()}`,
    misconceptionId,
    misconception: description,
    title: interventionType === "worked_example" ? "Targeted worked example" : "Check the underlying idea",
    interventionType,
    confidence,
    explanation: `Your response is consistent with this belief: ${description}`,
    example,
    guidance: interventionType === "worked_example"
      ? "Study the example, then solve the follow-up without copying its exact structure."
      : "Before retrying, explain which rule your code is relying on and what value changes at each step.",
    practiceProblemId: practiceProblem ? String(practiceProblem.id) : String(problemId || ""),
    practiceProblemTitle: practiceProblem?.title || "Fresh reassessment",
    category: practiceProblem?.category || "General Logic",
    sourceProblemId: String(problemId || ""),
    createdAt: new Date().toISOString(),
  };
}

module.exports = { buildIntervention };