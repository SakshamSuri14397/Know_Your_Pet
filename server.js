const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/petwikiDB", {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("MongoDB Connected"))
  .catch(err => console.log("MongoDB Connection Error:", err));

// Define User Schema and Model
const UserSchema = new mongoose.Schema({
    firstName: String,
    lastName: String,
    email: { type: String, unique: true },
    password: String,
    joinedAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", UserSchema);

// Adoption Center Schema
const AdoptionCenterSchema = new mongoose.Schema({
    name: String,
    address: String,
    city: String,
    state: String,
    phone: String,
    breeds: [String],
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
});

const AdoptionCenter = mongoose.model("AdoptionCenter", AdoptionCenterSchema);

// Comment Schema
const CommentSchema = new mongoose.Schema({
    breedId: String,
    content: String,
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    userName: String,
    createdAt: { type: Date, default: Date.now }
});

const Comment = mongoose.model("Comment", CommentSchema);

// Authentication middleware
const authenticate = async (req, res, next) => {
    try {
        const token = req.header("Authorization")?.replace("Bearer ", "");
        if (!token) throw new Error("No token provided");
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "default_secret_key");
        req.user = await User.findById(decoded.id);
        if (!req.user) throw new Error("User not found");
        next();
    } catch (err) {
        res.status(401).send({ error: "Please authenticate" });
    }
};

// Login endpoint
app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        
        if (!user) return res.status(400).send({ error: "User not found" });
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).send({ error: "Invalid credentials" });
        
        // Include user info in token payload
        const token = jwt.sign({ 
            id: user._id,
            firstName: user.firstName,
            lastName: user.lastName
        }, process.env.JWT_SECRET || "default_secret_key", { expiresIn: "7d" });
        
        res.send({ token, user: {
            id: user._id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email
        }});
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

// Register endpoint
app.post("/register", async (req, res) => {
    try {
        const { firstName, lastName, email, password } = req.body;
        
        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).send({ error: "Email already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const user = new User({ 
            firstName, 
            lastName, 
            email, 
            password: hashedPassword 
        });
        
        await user.save();
        
        // Include user info in token payload
        const token = jwt.sign({ 
            id: user._id,
            firstName: user.firstName,
            lastName: user.lastName
        }, process.env.JWT_SECRET || "default_secret_key", { expiresIn: "7d" });
        
        res.status(201).send({ token, user: {
            id: user._id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email
        }});
    } catch (err) {
        if (err.code === 11000) { // MongoDB duplicate key error
            res.status(400).send({ error: "Email already exists" });
        } else {
            res.status(400).send({ error: err.message });
        }
    }
});

// API Routes

// Adoption Center Routes
app.get("/api/centers", async (req, res) => {
    try {
        const { state, city } = req.query;
        const query = {};
        if (state) query.state = state;
        if (city) query.city = city;
        
        const centers = await AdoptionCenter.find(query)
            .populate('addedBy', 'firstName lastName');
            
        // Format the data to match what frontend expects
        const formattedCenters = centers.map(center => ({
            ...center._doc,
            addedBy: center.addedBy ? {
                name: `${center.addedBy.firstName} ${center.addedBy.lastName}`
            } : null
        }));
        
        res.send(formattedCenters);
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

app.post("/api/centers", authenticate, async (req, res) => {
    try {
        const center = new AdoptionCenter({
            ...req.body,
            addedBy: req.user._id
        });
        await center.save();
        res.status(201).send(center);
    } catch (err) {
        res.status(400).send({ error: err.message });
    }
});

// Comment Routes - Fix to match frontend query parameter approach
app.get("/api/comments", async (req, res) => {
    try {
        const { breedId } = req.query;
        if (!breedId) {
            return res.status(400).send({ error: "Breed ID is required" });
        }
        
        const comments = await Comment.find({ breedId })
            .sort({ createdAt: -1 });
        res.send(comments);
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

app.post("/api/comments", authenticate, async (req, res) => {
    try {
        const comment = new Comment({
            ...req.body,
            userId: req.user._id,
            userName: `${req.user.firstName} ${req.user.lastName}`
        });
        await comment.save();
        res.status(201).send(comment);
    } catch (err) {
        res.status(400).send({ error: err.message });
    }
});

// Serve frontend files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/home.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'home.html'));
});

app.get('/info.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'info.html'));
});

// This should be the last route - catch-all
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open in browser: http://localhost:${PORT}`);
});