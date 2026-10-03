const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const User = require("../models/users.models");


const generateToken = (id) => {
    return jwt.sign({id},process.env.JWT_SECRET,{expiresIn:"7d"});
}

exports.register = async (req,res) => {
    try{
        const {username,email,password} = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ message: "username, email, and password are required" });
        }

        const userExist = await User.findOne({email});

        if(userExist){
            return res.status(400).json({message:"User already exist"});
        }

        const hashPassword = await bcrypt.hash(password,10);
        
        const user = await User.create({
            username,
            email,
            password:hashPassword
        })

        res.status(201).json({
            id:user._id,
            username:user.username,
            email:user.email,
            token:generateToken(user._id)
        })

    }catch(err){
        if (err && err.code === 11000) {
            const keyValue = err.keyValue && typeof err.keyValue === "object" ? err.keyValue : null;
            const field = keyValue ? Object.keys(keyValue)[0] : null;
            const message = field ? `${field} already exists` : "User already exists";
            return res.status(400).json({ message });
        }
        console.error("Register error:", err);
        res.status(500).json({
            message: err.message,
            ...(process.env.NODE_ENV !== "production" ? { stack: err.stack } : {})
        });
    }
};


exports.login = async (req,res) => {
    try{
        const {email,password} = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: "email and password are required" });
        }

        const user = await User.findOne({email});

        if(!user){
            return res.status(400).json({message:"Invalid Credential or Create User"});
        }

        const IsMatch = await bcrypt.compare(password,user.password);

        if(!IsMatch){
            return res.status(400).json({message:"Invalid Password"});
        }

        res.json({
            id:user._id,
            username:user.username,
            email:user.email,
            token:generateToken(user._id)
        });

    }catch(err){
        console.error("Login error:", err);
        res.status(500).json({
            message: err.message,
            ...(process.env.NODE_ENV !== "production" ? { stack: err.stack } : {})
        });
    }
};