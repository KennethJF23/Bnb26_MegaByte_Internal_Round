const express = require("express");
const dotenv = require("dotenv");
const path = require("path");
const cors = require("cors");

const app = express();
// Load env vars from server/.env only (do not use .env.local)
dotenv.config({ path: path.join(__dirname, ".env") });

app.use(cors());
app.use(express.json());

app.use("/api/auth",require("./routes/auth.routes"))
app.use("/api/ml", require("./routes/ml.routes"));
app.use("/api/admin", require("./routes/admin.routes"));

app.get('/',(req,res)=>{
    res.send("Homepage is working");
})


const connectDB = require("./config/dB")
const PORT = process.env.PORT || 5000;

connectDB()
    .then(() => {
        app.listen(PORT,()=>{
            console.log(`Server is listening at ${PORT}`);
        })
    })
    .catch((err) => {
        console.error("MongoDB connection failed:");
        console.error(err);
        process.exit(1);
    });