const mongoose = require("mongoose");

const performanceEventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
    },
    sessionKey: {
      type: String,
      required: false,
      index: true,
    },
    eventType: {
      type: String,
      enum: ["code_submission", "mcq_assessment", "intervention_attempt"],
      required: true,
      index: true,
    },
    problemId: {
      type: String,
      required: false,
    },
    title: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      required: true,
      index: true,
    },
    difficulty: {
      type: String,
      enum: ["Beginner", "Intermediate", "Advanced", "All"],
      default: "Intermediate",
    },
    correct: {
      type: Boolean,
      required: true,
    },
    testsPassed: {
      type: Number,
      default: 0,
    },
    testsTotal: {
      type: Number,
      default: 0,
    },
    misconceptionId: {
      type: String,
      default: null,
    },
    misconceptionName: {
      type: String,
      default: null,
      index: true,
    },
    misconceptionConfidence: {
      type: Number,
      default: 0,
    },
    timeSpentSec: {
      type: Number,
      default: 30,
    },
    studentConfidence: {
      type: String,
      enum: ["low", "medium", "high", "unspecified"],
      default: "unspecified",
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

// Composite indexes for fast time-series trend aggregation
performanceEventSchema.index({ userId: 1, createdAt: -1 });
performanceEventSchema.index({ sessionKey: 1, createdAt: -1 });
performanceEventSchema.index({ category: 1, correct: 1 });

const learnerProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      unique: true,
      sparse: true,
    },
    sessionKey: {
      type: String,
      unique: true,
      sparse: true,
    },
    masteryScore: {
      type: Number,
      default: 0,
    },
    totalSubmissions: {
      type: Number,
      default: 0,
    },
    totalCorrect: {
      type: Number,
      default: 0,
    },
    streakDays: {
      type: Number,
      default: 1,
    },
    lastActiveDate: {
      type: Date,
      default: Date.now,
    },
    domainMastery: {
      type: Map,
      of: new mongoose.Schema(
        {
          attempted: { type: Number, default: 0 },
          correct: { type: Number, default: 0 },
          score: { type: Number, default: 0 },
        },
        { _id: false }
      ),
      default: {},
    },
    misconceptionTracker: {
      type: Map,
      of: new mongoose.Schema(
        {
          name: String,
          category: String,
          count: { type: Number, default: 0 },
          firstSeen: { type: Date, default: Date.now },
          lastSeen: { type: Date, default: Date.now },
          status: {
            type: String,
            enum: ["entrenched", "active", "resolving", "eradicated"],
            default: "active",
          },
          consecutivePasses: { type: Number, default: 0 },
        },
        { _id: false }
      ),
      default: {},
    },
  },
  { timestamps: true }
);

const interventionAttemptSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false, index: true },
    sessionKey: { type: String, required: false, index: true },
    interventionId: { type: String, required: true, index: true },
    misconceptionId: { type: String, required: true, index: true },
    problemId: { type: String, required: true },
    correct: { type: Boolean, required: true },
    diagnosisConfidence: { type: Number, default: 0 },
    status: { type: String, enum: ["active", "resolving", "eradicated"], required: true },
  },
  { timestamps: true }
);

const PerformanceEvent = mongoose.model("PerformanceEvent", performanceEventSchema);
const LearnerProfile = mongoose.model("LearnerProfile", learnerProfileSchema);
const InterventionAttempt = mongoose.model("InterventionAttempt", interventionAttemptSchema);

module.exports = { PerformanceEvent, LearnerProfile, InterventionAttempt };
