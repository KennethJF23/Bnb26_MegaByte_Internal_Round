const express = require("express");
const router = express.Router();
const { problems, submit, health, intervention } = require("../controllers/ml.controller");
const { getProgress, recordMcqAttempt } = require("../controllers/progress.controller");
const auth = require("../middleware/auth.middleware");

router.get("/problems", auth, problems);
router.post("/intervention", auth, intervention);
router.post("/submit", auth, submit);
router.get("/progress", auth, getProgress);
router.post("/progress/mcq", auth, recordMcqAttempt);
router.get("/health", health);

module.exports = router;