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
const PORT = process.env.PORT || 3002; // Port 3002 untuk Order Service

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

function generateOrderId() {
  const year    = new Date().getFullYear();
  const counter = String(Math.floor(Math.random() * 9999) + 1).padStart(4, "0");
  return `ORD-${year}-${counter}`;
}

function validateOrderPayload(body) {
  const errors = [];
  if (!body.customerId)               errors.push("customerId is required.");
  if (!body.pickup?.address)          errors.push("pickup.address is required.");
  if (!body.destination?.address)     errors.push("destination.address is required.");
  if (!body.package?.description)     errors.push("package.description is required.");
  if (typeof body.package?.weight !== "number") errors.push("package.weight must be a number.");
  return errors;
}

app.get("/", (req, res) => {
  res.json({ service: "LogiParalel Order Service", status: "OK" });
});

app.get("/health", (req, res) => {
  res.json({ status: "healthy", uptime: process.uptime() });
});

app.post("/api/create-order", async (req, res) => {
  try {
    const validationErrors = validateOrderPayload(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({ success: false, errors: validationErrors });
    }

    const { customerId, pickup, destination, package: pkg, note = "" } = req.body;

    const BASE_FEE     = 15000;
    const PER_KM_RATE  = 3000;
    const estimatedKm  = Math.floor(Math.random() * 10) + 2;
    const distanceFee  = estimatedKm * PER_KM_RATE;
    const totalFee     = BASE_FEE + distanceFee;

    const orderId  = generateOrderId();
    const now      = Date.now();
    const orderDoc = {
      orderId,
      status:      "pending",
      customerId,
      courierId:   null,
      pickup: {
        address:      pickup.address,
        lat:          pickup.lat      ?? null,
        lng:          pickup.lng      ?? null,
        contactName:  pickup.contactName  ?? "",
        contactPhone: pickup.contactPhone ?? "",
      },
      destination: {
        address:      destination.address,
        lat:          destination.lat      ?? null,
        lng:          destination.lng      ?? null,
        contactName:  destination.contactName  ?? "",
        contactPhone: destination.contactPhone ?? "",
      },
      package: {
        description: pkg.description,
        weight:      pkg.weight,
        weightUnit:  pkg.weightUnit ?? "kg",
        category:    pkg.category   ?? "general",
      },
      pricing: {
        baseFee: BASE_FEE,
        distanceFee,
        totalFee,
        currency:      "IDR",
        paymentMethod: "wallet",
      },
      timeline: {
        createdAt:   now,
        acceptedAt:  null,
        pickedUpAt:  null,
        deliveredAt: null,
      },
      note,
    };

    const startTime = Date.now();

    const [writeOrderResult, deductWalletResult, createChatResult] = await Promise.all([
      db.ref(`/orders/order_${orderId}`).set(orderDoc),
      (async () => {
        const walletRef = db.ref(`/users/${customerId}/wallet/balance`);
        return walletRef.transaction((currentBalance) => {
          // Firebase selalu memanggil ini dengan null pertama kali jika tidak ada cache lokal.
          // Kita harus me-return nilai apa saja (misal 0) agar transaksi dikirim ke server.
          // Server akan menolak 0, dan mengirimkan saldo yang asli untuk iterasi kedua!
          if (currentBalance === null) return 0; 
          
          if (currentBalance < totalFee) return undefined; // Batalkan jika saldo asli kurang
          return currentBalance - totalFee;
        });
      })(),
      db.ref(`/chats/order_${orderId}`).set({
        orderId,
        participants: { customer: customerId, courier: null },
        messages:     {},
      }),
    ]);

    const elapsed = Date.now() - startTime;

    if (deductWalletResult && deductWalletResult.committed === false) {
      await Promise.all([
        db.ref(`/orders/order_${orderId}`).remove(),
        db.ref(`/chats/order_${orderId}`).remove(),
      ]);
      return res.status(402).json({
        success: false,
        error:   "Insufficient wallet balance. Order cancelled.",
        required: totalFee,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Order created successfully.",
      orderId,
      pricing: { baseFee: BASE_FEE, distanceFee, totalFee, estimatedKm },
      parallelProcessingMs: elapsed,
    });

  } catch (error) {
    console.error("[ERROR] POST /api/create-order:", error.message);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
});

app.get("/api/order/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const snap = await db.ref(`/orders/order_${orderId}`).once("value");

    if (!snap.exists()) {
      return res.status(404).json({ success: false, error: `Order '${orderId}' not found.` });
    }

    return res.status(200).json({ success: true, order: snap.val() });
  } catch (error) {
    console.error("[ERROR] GET /api/order:", error.message);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
});

app.patch("/api/order/:orderId/status", async (req, res) => {
  try {
    const { orderId }         = req.params;
    const { status, courierId } = req.body;

    const validStatuses = ["pending", "accepted", "in_transit", "delivered", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: `Invalid status '${status}'.` });
    }

    const orderRef  = db.ref(`/orders/order_${orderId}`);
    const orderSnap = await orderRef.once("value");

    if (!orderSnap.exists()) {
      return res.status(404).json({ success: false, error: `Order '${orderId}' not found.` });
    }

    const timelineUpdate = {};
    if (status === "accepted")    timelineUpdate["timeline/acceptedAt"]  = Date.now();
    if (status === "in_transit")  timelineUpdate["timeline/pickedUpAt"]  = Date.now();
    if (status === "delivered")   timelineUpdate["timeline/deliveredAt"] = Date.now();

    const updatePayload = { status, ...timelineUpdate };
    if (courierId) {
      updatePayload.courierId = courierId;
      await db.ref(`/chats/order_${orderId}/participants/courier`).set(courierId);
    }

    await orderRef.update(updatePayload);

    return res.status(200).json({ success: true, message: `Order status updated.`, orderId, status });
  } catch (error) {
    console.error("[ERROR] PATCH /api/order/status:", error.message);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
});

app.get("/api/orders/pending", async (req, res) => {
  try {
    const snap = await db.ref("/orders")
      .orderByChild("status")
      .equalTo("pending")
      .once("value");

    const orders = [];
    snap.forEach((child) => orders.push(child.val()));

    return res.status(200).json({ success: true, count: orders.length, orders });
  } catch (error) {
    console.error("[ERROR] GET /api/orders/pending:", error.message);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
});

app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ success: false, error: err.message || "Unexpected server error." });
});

app.listen(PORT, () => {
  console.log("=======================================================");
  console.log(`  Order Service Started on Port ${PORT}`);
  console.log("=======================================================");
});
