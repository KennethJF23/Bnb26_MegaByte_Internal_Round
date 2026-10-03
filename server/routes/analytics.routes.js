const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const analyticsController = require("../controllers/analytics.controller");

// Optional auth helper: populates req.user if a valid token is present without rejecting unauthenticated guests
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "default_jwt_secret_dev");
      req.user = decoded.id;
    } catch {
      // ignore invalid tokens for analytics telemetry
    }
  }
  next();
};

router.post("/record", optionalAuth, analyticsController.recordEvent);
router.get("/trends", optionalAuth, analyticsController.getTrends);
router.get("/recommendations", optionalAuth, analyticsController.getRecommendations);
router.get("/export", optionalAuth, analyticsController.exportReport);
router.post("/seed-demo", optionalAuth, analyticsController.seedDemoData);
router.post("/reset", optionalAuth, analyticsController.resetData);

module.exports = router;
