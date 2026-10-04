const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const admin = require("../middleware/admin.middleware");
const { dashboard } = require("../controllers/admin.controller");

router.get("/dashboard", auth, admin, dashboard);

module.exports = router;
