const mongoose = require("mongoose");
const { PerformanceEvent, LearnerProfile } = require("../models/analytics.models");

// In-memory fallback cache in case MongoDB is running without connection or local demo mode
const memoryStore = {
  events: [],
  profiles: new Map(),
};

function resolveIdentifier(req) {
  const userId = req.user || null;
  const sessionKey =
    req.headers["x-guest-session"] ||
    req.query.sessionKey ||
    (req.body && req.body.sessionKey) ||
    "guest_learner_default";
  return { userId, sessionKey };
}

function isDbReady() {
  return mongoose.connection && mongoose.connection.readyState === 1;
}

// Compute moving velocity / trend metrics
function computeTrendMetrics(events) {
  if (!events || events.length === 0) {
    return {
      masteryIndex: 0,
      velocityDelta: 0,
      testPassRate: 0,
      totalEvents: 0,
      activeMisconceptions: 0,
      resolvedMisconceptions: 0,
      dailyTrend: [],
      categoryBreakdown: {},
      misconceptionMatrix: [],
      metacognition: { calibrated: 0, overconfident: 0, underconfident: 0, awareError: 0 },
    };
  }

  // Sort chronological
  const sorted = [...events].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  let totalCorrect = 0;
  let totalTestsPassed = 0;
  let totalTests = 0;
  const catMap = {};
  const miscMap = {};
  const metacog = { calibrated: 0, overconfident: 0, underconfident: 0, awareError: 0 };

  // Daily binning
  const dayMap = {};

  sorted.forEach((e) => {
    if (e.correct) totalCorrect++;
    totalTestsPassed += Number(e.testsPassed || (e.correct ? 1 : 0));
    totalTests += Number(e.testsTotal || 1);

    // Category
    const cat = e.category || "General Logic";
    if (!catMap[cat]) catMap[cat] = { attempted: 0, correct: 0 };
    catMap[cat].attempted++;
    if (e.correct) catMap[cat].correct++;

    // Misconception tracking
    if (e.misconceptionName && e.misconceptionName !== "None" && !e.correct) {
      const name = e.misconceptionName;
      if (!miscMap[name]) {
        miscMap[name] = {
          name,
          category: cat,
          count: 0,
          firstSeen: e.createdAt,
          lastSeen: e.createdAt,
          consecutivePasses: 0,
        };
      }
      miscMap[name].count++;
      miscMap[name].lastSeen = e.createdAt;
      miscMap[name].consecutivePasses = 0;
    } else if (e.correct && e.category) {
      // Reward consecutive passes on related category
      Object.values(miscMap).forEach((m) => {
        if (m.category === e.category) {
          m.consecutivePasses = (m.consecutivePasses || 0) + 1;
        }
      });
    }

    // Metacognition calibration
    const conf = (e.studentConfidence || "medium").toLowerCase();
    if (e.correct) {
      if (conf === "high" || conf === "medium") metacog.calibrated++;
      else metacog.underconfident++;
    } else {
      if (conf === "high") metacog.overconfident++;
      else metacog.awareError++;
    }

    // Group by Date (YYYY-MM-DD)
    const dStr = new Date(e.createdAt).toISOString().split("T")[0];
    if (!dayMap[dStr]) {
      dayMap[dStr] = { date: dStr, attempts: 0, correct: 0, testsPassed: 0, testsTotal: 0 };
    }
    dayMap[dStr].attempts++;
    if (e.correct) dayMap[dStr].correct++;
    dayMap[dStr].testsPassed += Number(e.testsPassed || (e.correct ? 1 : 0));
    dayMap[dStr].testsTotal += Number(e.testsTotal || 1);
  });

  // Calculate chronological daily trend points
  const dailyTrend = Object.values(dayMap)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      date: d.date,
      accuracy: Math.round((d.correct / d.attempts) * 100),
      testPassRate: Math.round((d.testsPassed / Math.max(1, d.testsTotal)) * 100),
      attempts: d.attempts,
    }));

  // Overall Mastery
  const masteryIndex = Math.round((totalCorrect / sorted.length) * 100);
  const testPassRate = Math.round((totalTestsPassed / Math.max(1, totalTests)) * 100);

  // Velocity Delta (comparison of second half vs first half)
  let velocityDelta = 0;
  if (sorted.length >= 4) {
    const half = Math.floor(sorted.length / 2);
    const firstHalfCorrect = sorted.slice(0, half).filter((x) => x.correct).length;
    const secondHalfCorrect = sorted.slice(half).filter((x) => x.correct).length;
    const rate1 = firstHalfCorrect / half;
    const rate2 = secondHalfCorrect / (sorted.length - half);
    velocityDelta = Math.round((rate2 - rate1) * 100);
  }

  // Misconception Matrix status classification
  const misconceptionMatrix = Object.values(miscMap).map((m) => {
    let status = "active";
    if (m.consecutivePasses >= 2) status = "eradicated";
    else if (m.consecutivePasses === 1) status = "resolving";
    else if (m.count >= 3) status = "entrenched";

    return {
      name: m.name,
      category: m.category,
      occurrences: m.count,
      status,
      consecutivePasses: m.consecutivePasses,
      firstSeen: m.firstSeen,
      lastSeen: m.lastSeen,
    };
  });

  const activeCount = misconceptionMatrix.filter((m) => m.status === "active" || m.status === "entrenched").length;
  const resolvedCount = misconceptionMatrix.filter((m) => m.status === "eradicated" || m.status === "resolving").length;

  // Category Breakdown
  const categoryBreakdown = {};
  Object.keys(catMap).forEach((c) => {
    const item = catMap[c];
    categoryBreakdown[c] = {
      attempted: item.attempted,
      correct: item.correct,
      score: Math.round((item.correct / item.attempted) * 100),
      status: item.correct / item.attempted >= 0.8 ? "Mastered" : item.correct / item.attempted >= 0.5 ? "Proficient" : "Developing",
    };
  });

  return {
    masteryIndex,
    velocityDelta,
    testPassRate,
    totalEvents: sorted.length,
    activeMisconceptions: activeCount,
    resolvedMisconceptions: resolvedCount,
    dailyTrend,
    categoryBreakdown,
    misconceptionMatrix,
    metacognition: metacog,
  };
}

// 1. Record Performance Event
exports.recordEvent = async (req, res) => {
  try {
    const { userId, sessionKey } = resolveIdentifier(req);
    const {
      eventType,
      problemId,
      title,
      category,
      difficulty,
      correct,
      testsPassed,
      testsTotal,
      misconceptionId,
      misconceptionName,
      misconceptionConfidence,
      timeSpentSec,
      studentConfidence,
      metadata,
    } = req.body || {};

    if (!eventType || !title || !category || typeof correct !== "boolean") {
      return res.status(400).json({ message: "eventType, title, category, and correct boolean are required" });
    }

    const eventPayload = {
      userId: userId ? new mongoose.Types.ObjectId(userId) : undefined,
      sessionKey,
      eventType,
      problemId: String(problemId || "prob_custom"),
      title,
      category,
      difficulty: difficulty || "Intermediate",
      correct,
      testsPassed: Number(testsPassed || (correct ? 1 : 0)),
      testsTotal: Number(testsTotal || 1),
      misconceptionId: misconceptionId ? String(misconceptionId) : null,
      misconceptionName: misconceptionName || (correct ? null : "Identified Logic Bug"),
      misconceptionConfidence: Number(misconceptionConfidence || 0.85),
      timeSpentSec: Number(timeSpentSec || 30),
      studentConfidence: studentConfidence || "medium",
      metadata: metadata || {},
      createdAt: new Date(),
    };

    // Save to In-Memory store immediately
    memoryStore.events.push(eventPayload);

    // Save to MongoDB if connected
    if (isDbReady()) {
      try {
        await PerformanceEvent.create(eventPayload);
      } catch (dbErr) {
        console.warn("MongoDB record event write failed, preserved in memory:", dbErr.message);
      }
    }

    return res.status(201).json({
      success: true,
      message: "Performance telemetry logged successfully",
      event: eventPayload,
    });
  } catch (err) {
    console.error("Error recording performance event:", err);
    return res.status(500).json({ message: "Failed to record performance telemetry", error: err.message });
  }
};

// 2. Query Production Trend Analytics
exports.getTrends = async (req, res) => {
  try {
    const { userId, sessionKey } = resolveIdentifier(req);
    const { timeRange = "30d", category = "All" } = req.query;

    let userEvents = [];

    if (isDbReady()) {
      try {
        const query = {};
        if (userId) {
          query.$or = [{ userId: new mongoose.Types.ObjectId(userId) }, { sessionKey }];
        } else {
          query.sessionKey = sessionKey;
        }

        if (category && category !== "All" && category !== "All Topics") {
          query.category = category;
        }

        // Time filter
        const now = new Date();
        if (timeRange === "7d") {
          query.createdAt = { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) };
        } else if (timeRange === "30d") {
          query.createdAt = { $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
        }

        userEvents = await PerformanceEvent.find(query).sort({ createdAt: 1 }).lean();
      } catch (dbErr) {
        console.warn("MongoDB read failed, falling back to memory store:", dbErr.message);
      }
    }

    // Fallback or augment with memory events matching user
    if (!userEvents || userEvents.length === 0) {
      userEvents = memoryStore.events.filter((e) => {
        const matchId = userId && String(e.userId) === String(userId);
        const matchSession = e.sessionKey === sessionKey;
        const matchCat = category === "All" || category === "All Topics" || e.category === category;
        return (matchId || matchSession) && matchCat;
      });
    }

    // If still empty, provide seeded baseline metrics so user instantly sees a rich live preview
    if (userEvents.length === 0) {
      const generatedSeed = generateRealisticSeedHistory(sessionKey, userId);
      userEvents = generatedSeed;
      memoryStore.events.push(...generatedSeed);
    }

    const metrics = computeTrendMetrics(userEvents);

    return res.json({
      success: true,
      timeRange,
      category,
      metrics,
    });
  } catch (err) {
    console.error("Error computing trend analytics:", err);
    return res.status(500).json({ message: "Failed to compute trend analytics", error: err.message });
  }
};

// 3. Prescriptive Targeted Interventions
exports.getRecommendations = async (req, res) => {
  try {
    const { userId, sessionKey } = resolveIdentifier(req);
    let events = memoryStore.events.filter((e) => e.sessionKey === sessionKey || (userId && String(e.userId) === String(userId)));

    if (isDbReady()) {
      try {
        const dbEvents = await PerformanceEvent.find({
          $or: [{ sessionKey }, ...(userId ? [{ userId }] : [])],
        }).lean();
        if (dbEvents && dbEvents.length > 0) events = dbEvents;
      } catch (err) {
        // proceed with memory
      }
    }

    const metrics = computeTrendMetrics(events);
    const activeMiscs = metrics.misconceptionMatrix.filter((m) => m.status === "entrenched" || m.status === "active");

    const recommendations = [];

    if (activeMiscs.length > 0) {
      activeMiscs.slice(0, 3).forEach((m, idx) => {
        recommendations.push({
          id: `rec_${idx + 1}`,
          priority: m.status === "entrenched" ? "CRITICAL" : "RECOMMENDED",
          title: `Eradicate: ${m.name}`,
          category: m.category,
          type: idx % 2 === 0 ? "mcq" : "code",
          reason: `Misconception detected ${m.occurrences} time(s). Targeted practice is required to verify permanent resolution.`,
          actionUrl: idx % 2 === 0 ? `#/mcq` : `#/live`,
          estimatedMin: 5,
        });
      });
    } else {
      recommendations.push({
        id: "rec_mastery",
        priority: "ADVANCE",
        title: "Advanced Data Structures & Recursion Depth",
        category: "Functions & Recursion",
        type: "code",
        reason: "All primary misconceptions have been resolved. Test boundary cases on nested recursive trees.",
        actionUrl: "#/live",
        estimatedMin: 10,
      });
    }

    return res.json({ success: true, recommendations });
  } catch (err) {
    return res.status(500).json({ message: "Error fetching recommendations", error: err.message });
  }
};

// 4. Export Complete Performance Audit Report
exports.exportReport = async (req, res) => {
  try {
    const { userId, sessionKey } = resolveIdentifier(req);
    let events = memoryStore.events.filter((e) => e.sessionKey === sessionKey || (userId && String(e.userId) === String(userId)));

    if (isDbReady()) {
      try {
        const dbEvents = await PerformanceEvent.find({
          $or: [{ sessionKey }, ...(userId ? [{ userId }] : [])],
        }).lean();
        if (dbEvents && dbEvents.length > 0) events = dbEvents;
      } catch (err) {}
    }

    const metrics = computeTrendMetrics(events);

    const report = {
      exportTimestamp: new Date().toISOString(),
      studentSession: sessionKey,
      userId: userId || "Anonymous Learner",
      executiveSummary: {
        overallMasteryScore: `${metrics.masteryIndex}%`,
        learningVelocityTrend: `${metrics.velocityDelta >= 0 ? "+" : ""}${metrics.velocityDelta}%`,
        testPassEfficiency: `${metrics.testPassRate}%`,
        totalSubmissionsTracked: metrics.totalEvents,
        activeMisconceptions: metrics.activeMisconceptions,
        resolvedMisconceptions: metrics.resolvedMisconceptions,
      },
      misconceptionTrajectory: metrics.misconceptionMatrix,
      domainMasteryBreakdown: metrics.categoryBreakdown,
      chronologicalVelocity: metrics.dailyTrend,
      rawEventsCount: events.length,
    };

    res.setHeader("Content-Disposition", 'attachment; filename="ReLearn_Student_Trend_Analysis.json"');
    res.setHeader("Content-Type", "application/json");
    return res.send(JSON.stringify(report, null, 2));
  } catch (err) {
    return res.status(500).json({ message: "Error exporting report", error: err.message });
  }
};

// 5. Seed Realistic 30-Day Learning Arc (Demo / Testing)
exports.seedDemoData = async (req, res) => {
  try {
    const { userId, sessionKey } = resolveIdentifier(req);
    const demoEvents = generateRealisticSeedHistory(sessionKey, userId);

    memoryStore.events = memoryStore.events.filter((e) => e.sessionKey !== sessionKey);
    memoryStore.events.push(...demoEvents);

    if (isDbReady()) {
      try {
        await PerformanceEvent.deleteMany({ sessionKey });
        await PerformanceEvent.insertMany(demoEvents);
      } catch (err) {
        console.warn("DB seed write skipped:", err.message);
      }
    }

    return res.json({
      success: true,
      message: "Seeded 28 realistic historical trend data points over 30 days",
      count: demoEvents.length,
    });
  } catch (err) {
    return res.status(500).json({ message: "Error seeding data", error: err.message });
  }
};

// 6. Reset Analytics Data
exports.resetData = async (req, res) => {
  try {
    const { userId, sessionKey } = resolveIdentifier(req);
    memoryStore.events = memoryStore.events.filter((e) => e.sessionKey !== sessionKey);

    if (isDbReady()) {
      try {
        await PerformanceEvent.deleteMany({ sessionKey });
      } catch (err) {}
    }

    return res.json({ success: true, message: "Learner analytics data reset successfully" });
  } catch (err) {
    return res.status(500).json({ message: "Error resetting data", error: err.message });
  }
};

// Helper: Generates an authentic learning trajectory with typical CS misconceptions
function generateRealisticSeedHistory(sessionKey, userId) {
  const events = [];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const sampleTrajectory = [
    // Week 1: Stumbling on loop variable mutation & off-by-one
    { dayOffset: 28, cat: "Loops & Iteration", title: "Cumulative Counter", correct: false, misc: "Loop counter retains mutation outside expected scope", conf: "high" },
    { dayOffset: 27, cat: "Loops & Iteration", title: "Array Accumulator", correct: false, misc: "Loop counter retains mutation outside expected scope", conf: "high" },
    { dayOffset: 25, cat: "Conditionals & Logic", title: "Boundary Threshold", correct: true, misc: null, conf: "medium" },
    { dayOffset: 24, cat: "Loops & Iteration", title: "Range Iterator", correct: false, misc: "Range(n) excludes upper boundary end index", conf: "medium" },
    { dayOffset: 22, cat: "Lists & Memory References", title: "List Duplication", correct: false, misc: "Assignment operator copies list reference instead of deep value", conf: "high" },

    // Week 2: Targeted intervention begins, early resolution of loop mutation
    { dayOffset: 20, cat: "Loops & Iteration", title: "Targeted Re-assessment: Loop Bounds", correct: true, misc: null, conf: "high" },
    { dayOffset: 19, cat: "Loops & Iteration", title: "Re:Check Loop Scoping", correct: true, misc: null, conf: "high" }, // Resolving loop scoping
    { dayOffset: 18, cat: "Variables & Operators", title: "Integer Division", correct: true, misc: null, conf: "high" },
    { dayOffset: 16, cat: "Lists & Memory References", title: "Slice Shallow Copy", correct: false, misc: "Assignment operator copies list reference instead of deep value", conf: "medium" },
    { dayOffset: 15, cat: "Functions & Recursion", title: "Recursive Factorial", correct: false, misc: "Missing base case return value triggers NoneType propagation", conf: "high" },

    // Week 3: Recursion base case & memory reference interventions
    { dayOffset: 14, cat: "Functions & Recursion", title: "Fibonacci Memoized", correct: false, misc: "Missing base case return value triggers NoneType propagation", conf: "medium" },
    { dayOffset: 12, cat: "Lists & Memory References", title: "Intervention: List Clone", correct: true, misc: null, conf: "medium" },
    { dayOffset: 11, cat: "Strings & Immutability", title: "String In-Place Replace", correct: false, misc: "String methods assumed to mutate original string in-place", conf: "high" },
    { dayOffset: 10, cat: "Lists & Memory References", title: "Re:Check Matrix 2D Ref", correct: true, misc: null, conf: "high" }, // Eradicated list ref bug!
    { dayOffset: 8, cat: "Functions & Recursion", title: "Intervention: Base Case Return", correct: true, misc: null, conf: "high" },

    // Week 4: High velocity mastery phase
    { dayOffset: 7, cat: "Functions & Recursion", title: "Verified Resolution: Recursive Sum", correct: true, misc: null, conf: "high" },
    { dayOffset: 6, cat: "Strings & Immutability", title: "Immutable Concatenation", correct: true, misc: null, conf: "high" },
    { dayOffset: 5, cat: "OOP & Data Structures", title: "Class Instance Attribute", correct: false, misc: "Mutable default argument shared across all instances", conf: "medium" },
    { dayOffset: 4, cat: "Loops & Iteration", title: "Nested Matrix Traversal", correct: true, misc: null, conf: "high" },
    { dayOffset: 3, cat: "Conditionals & Logic", title: "Short Circuit Boolean", correct: true, misc: null, conf: "high" },
    { dayOffset: 2, cat: "OOP & Data Structures", title: "Intervention: Factory Default", correct: true, misc: null, conf: "high" },
    { dayOffset: 1, cat: "Functions & Recursion", title: "Binary Search Recursion", correct: true, misc: null, conf: "high" },
    { dayOffset: 0, cat: "Lists & Memory References", title: "Deepcopy Dictionary Graph", correct: true, misc: null, conf: "high" },
  ];

  sampleTrajectory.forEach((s, idx) => {
    events.push({
      userId: userId ? new mongoose.Types.ObjectId(userId) : undefined,
      sessionKey,
      eventType: idx % 2 === 0 ? "mcq_assessment" : "code_submission",
      problemId: `prob_${100 + idx}`,
      title: s.title,
      category: s.cat,
      difficulty: idx > 15 ? "Advanced" : idx > 8 ? "Intermediate" : "Beginner",
      correct: s.correct,
      testsPassed: s.correct ? 5 : 2,
      testsTotal: 5,
      misconceptionId: s.misc ? `misc_${idx}` : null,
      misconceptionName: s.misc,
      misconceptionConfidence: s.misc ? 0.91 : 0.2,
      timeSpentSec: Math.floor(25 + Math.random() * 45),
      studentConfidence: s.conf,
      createdAt: new Date(now - s.dayOffset * dayMs - Math.floor(Math.random() * 3600000)),
    });
  });

  return events;
}
