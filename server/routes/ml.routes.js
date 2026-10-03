const express = require("express");
const router = express.Router();
const { problems, submit, health } = require("../controllers/ml.controller");
const auth = require("../middleware/auth.middleware");

router.get("/problems", auth, problems);
router.post("/submit", auth, submit);
router.get("/health", health);

module.exports = router;