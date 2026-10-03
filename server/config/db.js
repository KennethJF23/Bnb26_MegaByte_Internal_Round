const mongoose = require("mongoose");

const connectDB = async () =>{
    // Avoid confusing "buffering timed out" errors when the DB is down.
    mongoose.set("bufferCommands", false);

    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
        throw new Error("MONGO_URI is not set (check server/.env)");
    }

    try{
        await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 10000,
        });
        console.log("MongoDB Connected");
    }catch(err){
        console.error("MongoDB Connection Failed");
        console.error(err && err.message ? err.message : err);
        throw err;
    }
}

module.exports = connectDB;