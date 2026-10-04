const User = require("../models/users.models");

const validAttempt = (attempt, type) => {
    if (!attempt || typeof attempt.correct !== "boolean") return false;
    if (type === "mcq") {
        return typeof attempt.questionId === "string" && typeof attempt.topic === "string";
    }
    return Number.isInteger(attempt.problemId) && typeof attempt.topic === "string";
};

exports.getProgress = async (req, res) => {
    try {
        const user = await User.findById(req.user).select("username email progress");
        if (!user) return res.status(404).json({ message: "User not found" });
        return res.json({
            username: user.username,
            email: user.email,
            mcqAttempts: user.progress?.mcqAttempts || [],
            codeAttempts: user.progress?.codeAttempts || []
        });
    } catch (err) {
        console.error("Get progress error:", err);
        return res.status(500).json({ message: "Could not load progress" });
    }
};

exports.recordMcqAttempt = async (req, res) => {
    const attempt = req.body;
    if (!validAttempt(attempt, "mcq")) {
        return res.status(400).json({ message: "questionId, topic, and correct are required" });
    }
    try {
        await User.findByIdAndUpdate(req.user, { $push: { "progress.mcqAttempts": {
            questionId: attempt.questionId,
            topic: attempt.topic,
            difficulty: typeof attempt.difficulty === "string" ? attempt.difficulty : "Unknown",
            correct: attempt.correct,
            createdAt: new Date()
        } } });
        return res.status(201).json({ saved: true });
    } catch (err) {
        console.error("Record MCQ attempt error:", err);
        return res.status(500).json({ message: "Could not save MCQ attempt" });
    }
};

exports.recordCodeAttempt = async (req, res) => {
    const attempt = req.body;
    if (!validAttempt(attempt, "code")) {
        return res.status(400).json({ message: "problemId, topic, and correct are required" });
    }
    try {
        await User.findByIdAndUpdate(req.user, { $push: { "progress.codeAttempts": {
            problemId: attempt.problemId,
            topic: attempt.topic,
            difficulty: typeof attempt.difficulty === "string" ? attempt.difficulty : "Unknown",
            correct: attempt.correct,
            createdAt: new Date()
        } } });
        return res.status(201).json({ saved: true });
    } catch (err) {
        console.error("Record code attempt error:", err);
        return res.status(500).json({ message: "Could not save code attempt" });
    }
};
