const mongoose = require("mongoose");

const userSchema = mongoose.Schema(
    {
        username: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true
        },
        password: {
            type: String,
            required: false
        },
        role: {
            type: String,
            enum: ["user", "admin"],
            default: "user"
        },
        progress: {
            mcqAttempts: [{
                questionId: String,
                topic: String,
                difficulty: String,
                correct: Boolean,
                createdAt: { type: Date, default: Date.now }
            }],
            codeAttempts: [{
                problemId: Number,
                topic: String,
                difficulty: String,
                correct: Boolean,
                createdAt: { type: Date, default: Date.now }
            }]
        },
    },
    { timestamps: true }

);

module.exports = mongoose.model("User", userSchema);