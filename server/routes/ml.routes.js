const express = require("express");
const router = express.Router();
const { problems, submit, health, intervention, diagnose } = require("../controllers/ml.controller");
const { getProgress, recordMcqAttempt } = require("../controllers/progress.controller");
const auth = require("../middleware/auth.middleware");

router.get("/problems", auth, problems);
router.post("/intervention", auth, intervention);
router.post("/submit", auth, submit);
router.post("/diagnose", auth, diagnose);
router.get("/progress", auth, getProgress);
router.post("/progress/mcq", auth, recordMcqAttempt);
router.get("/health", health);

module.exports = router;