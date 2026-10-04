const express = require("express");
const router = express.Router();
const analytics = require("../controllers/analytics.controller");
const optionalAuth = require("../middleware/optionalAuth.middleware");

/* Guests are first-class here: the MCQ diagnostic and the dashboard both work
   without an account, keyed on a client-generated session id. */
router.post("/record", optionalAuth, analytics.recordEvent);
router.get("/trends", optionalAuth, analytics.getTrends);
router.get("/recommendations", optionalAuth, analytics.getRecommendations);
router.get("/learner-model", optionalAuth, analytics.getLearnerModel);
router.get("/export", optionalAuth, analytics.exportReport);
router.post("/seed-demo", optionalAuth, analytics.seedDemoData);
router.post("/reset", optionalAuth, analytics.resetData);

module.exports = router;
