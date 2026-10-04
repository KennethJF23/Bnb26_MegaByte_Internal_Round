const express = require("express");
const router = express.Router();
const ml = require("../controllers/ml.controller");
const auth = require("../middleware/auth.middleware");
const optionalAuth = require("../middleware/optionalAuth.middleware");

/* Code execution is gated behind a real account — it runs submitted Python. */
router.get("/problems", auth, ml.problems);
router.post("/submit", auth, ml.submit);

/* Diagnosis is read-only static analysis, so guests may use it. */
router.post("/diagnose", optionalAuth, ml.diagnose);
router.post("/probe", optionalAuth, ml.probe);
router.post("/intervention/delivered", optionalAuth, ml.markIntervention);

/* Reference + evaluation data: public, nothing learner-specific. */
router.get("/health", ml.health);
router.get("/metrics", ml.metrics);
router.get("/bank", ml.bankIndex);
router.get("/questions", ml.questions);

module.exports = router;
