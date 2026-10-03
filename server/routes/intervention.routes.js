const express = require("express");
const jwt = require("jsonwebtoken");
const controller = require("../controllers/intervention.controller");

const router = express.Router();

const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.split(" ")[1];
      req.user = jwt.verify(token, process.env.JWT_SECRET || "default_jwt_secret_dev").id;
    } catch {}
  }
  next();
};

router.post("/next", optionalAuth, controller.next);
router.post("/attempt", optionalAuth, controller.recordAttempt);
router.get("/history", optionalAuth, controller.history);

module.exports = router;