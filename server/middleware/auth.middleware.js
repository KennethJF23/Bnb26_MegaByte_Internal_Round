const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
    const authHeader = req.headers.authorization;

    // Trailing space matters: without it, "Bearertoken" passes this check.
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    if (!process.env.JWT_SECRET) {
        // Fail closed. Verifying against a default dev secret would accept
        // tokens minted by anyone who knows that default.
        return res.status(500).json({ message: "Server auth is not configured (JWT_SECRET missing)" });
    }

    try {
        const token = authHeader.slice(7).trim();
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        req.user = decoded.id;
        next();
    } catch {
        return res.status(401).json({ message: "Invalid Token" });
    }
}
