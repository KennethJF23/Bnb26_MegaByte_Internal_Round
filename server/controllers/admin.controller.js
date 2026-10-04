const fs = require("fs");
const path = require("path");
const User = require("../models/users.models");

const metricsPath = process.env.MODEL_EVAL_PATH || path.join(
    __dirname,
    "..",
    "..",
    "database",
    "mcminer-main",
    "mcminer-main",
    "dataset",
    "bags_and_results",
    "evaluations",
    "anthropic_claude-sonnet-4-5_no-reasoning",
    "single_multi",
    "evaluation_metrics.json"
);

exports.dashboard = async (req, res) => {
    try {
        const [users, evaluation] = await Promise.all([
            User.countDocuments(),
            fs.promises.readFile(metricsPath, "utf8").then(JSON.parse).catch(() => null)
        ]);
        return res.json({
            users,
            evaluation: evaluation || { standard_metrics: { overall_metrics: {}, by_misconception: {} } }
        });
    } catch (err) {
        console.error("Admin dashboard error:", err);
        return res.status(500).json({ message: "Could not load admin dashboard" });
    }
};
