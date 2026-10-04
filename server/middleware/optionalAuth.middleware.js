/* ============================================================================
   Optional auth: populate req.user when a valid token is present, but let
   unauthenticated visitors through.

   Shared deliberately. This logic previously lived inline in
   analytics.routes.js with a hardcoded `|| "default_jwt_secret_dev"` fallback,
   while the strict middleware had no such fallback — so the two paths could
   disagree about whether the same token was valid. One implementation, one
   secret, no fallback.
   ========================================================================== */

const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  const header = req.headers.authorization;
  // Note the trailing space: "Bearertoken" must not pass the prefix check.
  if (header && header.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    if (token && process.env.JWT_SECRET) {
      try {
        req.user = jwt.verify(token, process.env.JWT_SECRET).id;
      } catch {
        // An invalid token is treated as "no token" here: analytics and the MCQ
        // bank are usable by guests, so a stale token must not lock them out.
      }
    }
  }
  next();
};
