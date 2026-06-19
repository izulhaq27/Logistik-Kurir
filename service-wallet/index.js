"use strict";

const express  = require("express");
const cors     = require("cors");
const helmet   = require("helmet");
const morgan   = require("morgan");
const admin    = require("firebase-admin");
require("dotenv").config();

const serviceAccount = {
  type:                        "service_account",
  project_id:                  process.env.FIREBASE_PROJECT_ID,
  client_email:                process.env.FIREBASE_CLIENT_EMAIL,
  private_key:                 (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
};

admin.initializeApp({
  credential:   admin.credential.cert(serviceAccount),
  databaseURL:  process.env.FIREBASE_DATABASE_URL,
});

const db = admin.database();

const app  = express();
const PORT = process.env.PORT || 3001; // Port 3001 untuk Wallet Service

app.use(helmet());
app.use(morgan("dev"));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*").split(",").map(o => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: Origin '${origin}' not allowed.`));
      }
    },
    methods:          ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders:   ["Content-Type", "Authorization"],
    credentials:      true,
  })
);

app.options("*", cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.json({ service: "LogiParalel Wallet Service", status: "OK" });
});

app.get("/health", (req, res) => {
  res.json({ status: "healthy", uptime: process.uptime() });
});

// ---- POST /api/topup-wallet --------------------------------
app.post("/api/topup-wallet", async (req, res) => {
  try {
    const { userId, amount } = req.body;

    if (!userId) return res.status(400).json({ success: false, error: "userId is required." });
    
    const topupAmount = Number(amount);
    if (isNaN(topupAmount) || topupAmount <= 0) {
      return res.status(400).json({ success: false, error: "amount must be a positive number." });
    }
    if (topupAmount > 10_000_000) {
      return res.status(400).json({ success: false, error: "amount exceeds maximum top-up limit." });
    }

    const userRef = db.ref(`/users/${userId}`);
    const userSnap = await userRef.once("value");
    
    if (!userSnap.exists()) {
      await userRef.set({
        uid: userId,
        name: "User Demo",
        role: "customer",
        wallet: { balance: 0, currency: "IDR" },
        createdAt: Date.now()
      });
    }

    const walletRef = db.ref(`/users/${userId}/wallet/balance`);
    const transactionResult = await walletRef.transaction((currentBalance) => {
      const safeBalance = currentBalance ?? 0;
      return safeBalance + topupAmount;
    });

    if (!transactionResult.committed) {
      return res.status(409).json({ success: false, error: "Transaction conflict. Please retry." });
    }

    const newBalance = transactionResult.snapshot.val();

    await db.ref(`/users/${userId}/wallet/transactions`).push({
      type:      "topup",
      amount:    topupAmount,
      newBalance,
      timestamp: Date.now(),
      source:    "logiparalel-wallet-service",
    });

    return res.status(200).json({
      success: true,
      message: "Wallet top-up successful.",
      userId,
      topupAmount,
      newBalance,
      currency: "IDR",
    });

  } catch (error) {
    console.error("[ERROR] POST /api/topup-wallet:", error.message);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
});

app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ success: false, error: err.message || "Unexpected server error." });
});

app.listen(PORT, () => {
  console.log("=======================================================");
  console.log(`  Wallet Service Started on Port ${PORT}`);
  console.log("=======================================================");
});
