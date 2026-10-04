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
      enum: ["code_submission", "mcq_assessment"],
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

    /* ---------------------------------------------------------------------
       Resolution-protocol fields. Without these there is no way to tell a
       first encounter from a post-intervention retest, which is why the old
       build had to fall back on crediting a whole category.
       ------------------------------------------------------------------ */

    /** The misconception this ITEM probes, as a stable number. Credit or debit
        is applied to this id, never to a category and never to free text. */
    targetsMisconceptionId: {
      type: Number,
      default: null,
      index: true,
    },
    /** False when the item does not probe the tracked belief, so it must not
        count as evidence either way. */
    targeted: {
      type: Boolean,
      default: true,
    },
    /** Links a retest back to the intervention it is verifying. */
    interventionId: {
      type: String,
      default: null,
      index: true,
    },
    /** 1 = pre-intervention diagnosis, 2+ = reassessment rounds. */
    attemptNumber: {
      type: Number,
      default: 1,
    },
    /** Item shape, used to enforce the transfer requirement (a correction has
        to survive a change of surface form, not just a repeat of one item). */
    probeShape: {
      type: String,
      default: null,
    },
    /** Set when a wrong choice maps onto a SIBLING misconception — the learner
        swapped one belief for an adjacent one rather than resolving it. */
    chosenSibling: {
      type: Number,
      default: null,
    },
    /** Which diagnoser produced this: the trained classifier, the rule-based
        fallback, or the learner's own probe answer. */
    engine: {
      type: String,
      enum: ["model", "rules", "learner-probe", "none"],
      default: "none",
    },
    /** True when the diagnosis could not be separated from its twin. */
    ambiguous: {
      type: Boolean,
      default: false,
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
    /** ISO yyyy-mm-dd stamps of days with activity. streakDays is derived from
        this rather than guessed, so it survives gaps and restarts. */
    activeDays: {
      type: [String],
      default: [],
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
    /* ---------------------------------------------------------------------
       Per-misconception state, keyed by the stable numeric id as a string.
       This is the authoritative learner model: the state machine in
       lib/resolutionProtocol.js owns these fields and nothing else writes
       them, so the four statuses have exactly one definition.
       ------------------------------------------------------------------ */
    misconceptionTracker: {
      type: Map,
      of: new mongoose.Schema(
        {
          misconceptionId: { type: Number, required: true },
          name: String,
          category: String,

          occurrences: { type: Number, default: 0 },
          firstSeen: { type: Date, default: null },
          lastSeen: { type: Date, default: null },

          interventionCount: { type: Number, default: 0 },
          lastInterventionAt: { type: Date, default: null },
          lastInterventionId: { type: String, default: null },

          /** Qualifying correct retests since the last intervention. */
          passes: { type: Number, default: 0 },
          /** Of those, how many were on a different item shape. */
          transferPasses: { type: Number, default: 0 },
          /** Distinct shapes passed, so transfer can be verified not assumed. */
          probeShapesSeen: { type: [String], default: [] },
          /** Times the learner swapped in a neighbouring belief. */
          siblingSwaps: { type: Number, default: 0 },
          /** Times it came back after being cleared. */
          relapses: { type: Number, default: 0 },

          status: {
            type: String,
            enum: ["entrenched", "active", "resolving", "eradicated"],
            default: "active",
          },
          resolvedAt: { type: Date, default: null },

          /** Append-only evidence chain behind the current status. */
          history: {
            type: [
              new mongoose.Schema(
                {
                  at: { type: Date, default: Date.now },
                  verdict: String,
                  detail: String,
                  shape: String,
                  interventionId: String,
                },
                { _id: false }
              ),
            ],
            default: [],
          },
        },
        { _id: false }
      ),
      default: {},
    },
  },
  { timestamps: true }
);

const PerformanceEvent = mongoose.model("PerformanceEvent", performanceEventSchema);
const LearnerProfile = mongoose.model("LearnerProfile", learnerProfileSchema);

module.exports = { PerformanceEvent, LearnerProfile };
