// ============================================================
// LogiParalel — Backend API Server
// Architecture: Express.js + Firebase Admin SDK
// Deployment Target: Render.com
// ============================================================
//
// PARALLEL COMPUTING CONCEPT NOTES (for University Report):
// ---------------------------------------------------------
// Node.js uses a single-threaded Event Loop backed by libuv's
// thread pool. This gives us:
//
//  1. NON-BLOCKING I/O: All Firebase/database calls use
//     Promises & async/await, so the CPU thread is NEVER
//     blocked while waiting for I/O — it services other
//     incoming HTTP requests concurrently. This is analogous
//     to coroutine-based parallelism.
//
//  2. PARALLEL PROCESSING MOCKUP: The `create-order` endpoint
//     uses Promise.all() to fire MULTIPLE independent async
//     tasks SIMULTANEOUSLY (in parallel), then awaits all
//     results at once — mirroring the fork-join model used in
//     traditional parallel computing (e.g., OpenMP sections).
//
//  3. ATOMIC TRANSACTIONS: The `topup-wallet` endpoint uses
//     Firebase Realtime Database transactions, which are
//     compare-and-swap (CAS) operations — the standard
//     mechanism for handling race conditions in concurrent/
//     parallel systems without explicit mutex locks.
// ============================================================

"use strict";

// --- Core Dependencies ---
const express  = require("express");
const cors     = require("cors");
const helmet   = require("helmet");
const morgan   = require("morgan");
const admin    = require("firebase-admin");
require("dotenv").config();

// ============================================================
// 1. FIREBASE ADMIN SDK INITIALIZATION
//    The Admin SDK is initialised ONCE at startup (singleton).
//    It communicates with Firebase over persistent HTTP/2
//    connections, enabling high-throughput parallel operations.
// ============================================================
const serviceAccount = {
  type:                        "service_account",
  project_id:                  process.env.FIREBASE_PROJECT_ID,
  client_email:                process.env.FIREBASE_CLIENT_EMAIL,
  // Render stores env vars as strings — newlines must be un-escaped.
  private_key:                 (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
};

admin.initializeApp({
  credential:   admin.credential.cert(serviceAccount),
  databaseURL:  process.env.FIREBASE_DATABASE_URL,
});

// Shorthand reference to the Firebase Realtime Database root.
const db = admin.database();

// ============================================================
// 2. EXPRESS APP SETUP
// ============================================================
const app  = express();
const PORT = process.env.PORT || 3000;

// --- Security Headers (Helmet) ---
// Adds standard HTTP security headers (XSS, MIME, etc.)
app.use(helmet());

// --- HTTP Request Logger ---
// 'dev' format gives coloured concise output: method, status, time.
app.use(morgan("dev"));

// --- CORS Middleware ---
// Allows the two separate GitHub Pages frontends to call this API.
// We read the allowed origins from the environment variable for
// easy per-environment configuration without code changes.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*").split(",").map(o => o.trim());

app.use(
  cors({
    // Dynamic origin check — allows any origin in the whitelist.
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g., curl, Postman, mobile apps)
      // or any origin explicitly listed in ALLOWED_ORIGINS.
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

// Handle pre-flight OPTIONS requests for all routes.
app.options("*", cors());

// --- JSON Body Parser ---
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ============================================================
// 3. UTILITY FUNCTIONS
// ============================================================

/**
 * generateOrderId — Creates a human-readable, date-stamped order ID.
 * Format: ORD-YYYY-XXXX (e.g., ORD-2026-0042)
 * In a production system this would use a distributed ID generator
 * (e.g., Snowflake ID) to avoid collisions across parallel workers.
 */
function generateOrderId() {
  const year    = new Date().getFullYear();
  const counter = String(Math.floor(Math.random() * 9999) + 1).padStart(4, "0");
  return `ORD-${year}-${counter}`;
}

/**
 * validateOrderPayload — Guards the create-order endpoint.
 * Returns an array of error messages; empty array = valid.
 */
function validateOrderPayload(body) {
  const errors = [];
  if (!body.customerId)               errors.push("customerId is required.");
  if (!body.pickup?.address)          errors.push("pickup.address is required.");
  if (!body.destination?.address)     errors.push("destination.address is required.");
  if (!body.package?.description)     errors.push("package.description is required.");
  if (typeof body.package?.weight !== "number") errors.push("package.weight must be a number.");
  return errors;
}

// ============================================================
// 4. ROUTES
// ============================================================

// ---- Health Check ------------------------------------------
app.get("/", (req, res) => {
  res.json({
    service:   "LogiParalel Backend API",
    status:    "OK",
    timestamp: new Date().toISOString(),
    version:   "1.0.0",
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "healthy", uptime: process.uptime() });
});

// ---- POST /api/create-order --------------------------------
/**
 * Creates a new delivery order.
 *
 * PARALLEL COMPUTING DEMONSTRATION — Promise.all() Fork-Join:
 * -----------------------------------------------------------
 * After validating the request and computing the fee, we must:
 *   Task A: Write the order document to /orders/{orderId}
 *   Task B: Deduct the fee from the customer's wallet in /users
 *   Task C: Create an empty chat thread in /chats/{orderId}
 *
 * These three tasks are INDEPENDENT of each other, so we
 * dispatch them ALL AT ONCE using Promise.all(). This is the
 * Node.js equivalent of spawning parallel threads/tasks and
 * then joining (waiting) at a barrier — classic fork-join.
 *
 * Sequential approach:  ~900 ms  (3 × 300 ms)
 * Parallel approach:    ~300 ms  (max of 3 × 300 ms)
 *
 * The speed-up factor S = T_sequential / T_parallel = 3x,
 * directly demonstrating Amdahl's Law for embarrassingly
 * parallel workloads (no shared-state dependencies).
 */
app.post("/api/create-order", async (req, res) => {
  try {
    // --- Validate incoming payload ---
    const validationErrors = validateOrderPayload(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({ success: false, errors: validationErrors });
    }

    const {
      customerId,
      pickup,
      destination,
      package: pkg,
      note = "",
    } = req.body;

    // --- Compute pricing (simplified distance-based model) ---
    const BASE_FEE     = 15000; // IDR
    const PER_KM_RATE  = 3000;  // IDR per km
    const estimatedKm  = Math.floor(Math.random() * 10) + 2; // Mockup: 2–12 km
    const distanceFee  = estimatedKm * PER_KM_RATE;
    const totalFee     = BASE_FEE + distanceFee;

    // --- Build the order document ---
    const orderId  = generateOrderId();
    const now      = Date.now();
    const orderDoc = {
      orderId,
      status:      "pending",    // pending → accepted → in_transit → delivered
      customerId,
      courierId:   null,         // Assigned when a courier accepts the order
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

    // ---- PARALLEL FORK-JOIN via Promise.all() ----------------
    // Declare all three independent async operations as Promises.
    // The Event Loop dispatches them concurrently to the Firebase
    // network layer; we await the JOIN point (all three done).
    console.log(`[PARALLEL] Dispatching 3 concurrent Firebase writes for order ${orderId}...`);
    const startTime = Date.now();

    const [writeOrderResult, deductWalletResult, createChatResult] = await Promise.all([
      // TASK A — Write order document
      db.ref(`/orders/order_${orderId}`).set(orderDoc),

      // TASK B — Deduct fee from customer wallet using a transaction
      // (We call our own transaction logic; this is a nested async op)
      (async () => {
        const walletRef = db.ref(`/users/${customerId}/wallet/balance`);
        return walletRef.transaction((currentBalance) => {
          // If node doesn't exist, we start at 0 (though ideally customer should exist)
          const safeBalance = currentBalance ?? 0;
          if (safeBalance < totalFee) {
            // Returning undefined ABORTS the transaction (no write).
            return undefined;
          }
          return safeBalance - totalFee;
        });
      })(),

      // TASK C — Initialise an empty chat thread for this order
      db.ref(`/chats/order_${orderId}`).set({
        orderId,
        participants: { customer: customerId, courier: null },
        messages:     {},
      }),
    ]);

    const elapsed = Date.now() - startTime;
    console.log(`[PARALLEL] All 3 tasks completed in ${elapsed}ms (parallel).`);

    // --- Check if wallet transaction was aborted (insufficient funds) ---
    // Firebase transaction result shape: { committed, snapshot }
    if (deductWalletResult && deductWalletResult.committed === false) {
      // Rollback: delete the order and chat we just created
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

    // --- Success Response ---
    return res.status(201).json({
      success: true,
      message: "Order created successfully.",
      orderId,
      pricing: { baseFee: BASE_FEE, distanceFee, totalFee, estimatedKm },
      parallelProcessingMs: elapsed,
    });

  } catch (error) {
    console.error("[ERROR] POST /api/create-order:", error.message);
    return res.status(500).json({ success: false, error: "Internal server error.", detail: error.message });
  }
});

// ---- POST /api/topup-wallet --------------------------------
/**
 * Tops up a user's wallet balance by a specified amount.
 *
 * PARALLEL COMPUTING DEMONSTRATION — CAS Atomic Transaction:
 * ----------------------------------------------------------
 * In a concurrent system, multiple top-up requests for the
 * same user could arrive simultaneously. A naive read-then-
 * write pattern creates a race condition (lost update problem):
 *
 *   Thread 1: reads balance = 100,000
 *   Thread 2: reads balance = 100,000
 *   Thread 1: writes balance = 100,000 + 50,000 = 150,000 ✓
 *   Thread 2: writes balance = 100,000 + 75,000 = 175,000 ✗ (T1 update lost!)
 *
 * Firebase `ref.transaction()` solves this with a Compare-And-
 * Swap (CAS) loop — the server re-runs the update function if
 * the value changed between read and write, guaranteeing
 * atomicity without a mutex lock.
 */
app.post("/api/topup-wallet", async (req, res) => {
  try {
    const { userId, amount } = req.body;

    // --- Input validation ---
    if (!userId) {
      return res.status(400).json({ success: false, error: "userId is required." });
    }
    const topupAmount = Number(amount);
    if (isNaN(topupAmount) || topupAmount <= 0) {
      return res.status(400).json({ success: false, error: "amount must be a positive number." });
    }
    if (topupAmount > 10_000_000) {
      return res.status(400).json({ success: false, error: "amount exceeds maximum top-up limit of Rp10,000,000." });
    }

    // --- Verify user exists or create minimal profile ---
    const userRef = db.ref(`/users/${userId}`);
    const userSnap = await userRef.once("value");
    
    if (!userSnap.exists()) {
      console.log(`[TOPUP] User ${userId} not found. Creating minimal profile...`);
      await userRef.set({
        uid: userId,
        name: "User Demo",
        role: "customer",
        wallet: { balance: 0, currency: "IDR" },
        createdAt: Date.now()
      });
    }

    // ---- ATOMIC CAS TRANSACTION --------------------------------
    // `db.ref.transaction(updateFn)` implements optimistic locking:
    //   1. Server reads the current value.
    //   2. Passes it to `updateFn` for the new value.
    //   3. Sends a conditional write — only commits if the value
    //      has NOT changed since step 1 (atomicity guarantee).
    //   4. If another writer changed it first, it RETRIES automatically.
    // This is equivalent to an atomic fetch-and-add instruction
    // (std::atomic<T>::fetch_add) in C++ parallel programming.
    const walletRef = db.ref(`/users/${userId}/wallet/balance`);

    const transactionResult = await walletRef.transaction((currentBalance) => {
      // currentBalance is null when the node doesn't exist yet.
      const safeBalance = currentBalance ?? 0;
      // Return the new value — Firebase will CAS-commit this.
      return safeBalance + topupAmount;
    });

    if (!transactionResult.committed) {
      return res.status(409).json({ success: false, error: "Transaction conflict. Please retry." });
    }

    const newBalance = transactionResult.snapshot.val();

    // --- Log the top-up event for audit trail ---
    await db.ref(`/users/${userId}/wallet/transactions`).push({
      type:      "topup",
      amount:    topupAmount,
      newBalance,
      timestamp: Date.now(),
      source:    "logiparalel-backend-api",
    });

    return res.status(200).json({
      success:    true,
      message:    "Wallet top-up successful.",
      userId,
      topupAmount,
      newBalance,
      currency:   "IDR",
    });

  } catch (error) {
    console.error("[ERROR] POST /api/topup-wallet:", error.message);
    return res.status(500).json({ success: false, error: "Internal server error.", detail: error.message });
  }
});

// ---- GET /api/order/:orderId --------------------------------
/**
 * Retrieves a single order by ID.
 * Demonstrates non-blocking async read from Firebase.
 */
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

// ---- PATCH /api/order/:orderId/status ----------------------
/**
 * Updates the status of an order (e.g., courier accepts it).
 * Used by the Courier App client.
 */
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
      // Also update the chat thread with the courier participant
      await db.ref(`/chats/order_${orderId}/participants/courier`).set(courierId);
    }

    await orderRef.update(updatePayload);

    return res.status(200).json({ success: true, message: `Order status updated to '${status}'.`, orderId, status });
  } catch (error) {
    console.error("[ERROR] PATCH /api/order/status:", error.message);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
});

// ---- GET /api/orders/pending --------------------------------
/**
 * Returns all orders with status 'pending'.
 * Polled / listened to by the Courier App to find available orders.
 */
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

// ============================================================
// 5. GLOBAL ERROR HANDLER
//    Catches any error passed via next(err) or unhandled throws.
// ============================================================
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[GLOBAL ERROR]", err.message);
  res.status(err.status || 500).json({
    success: false,
    error:   err.message || "Unexpected server error.",
  });
});

// ============================================================
// 6. START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log("=======================================================");
  console.log("  LogiParalel Backend API — Server Started");
  console.log(`  Port    : ${PORT}`);
  console.log(`  Env     : ${process.env.NODE_ENV || "development"}`);
  console.log(`  Firebase: ${process.env.FIREBASE_PROJECT_ID || "NOT CONFIGURED"}`);
  console.log("  Endpoints:");
  console.log("    GET  /health");
  console.log("    POST /api/create-order");
  console.log("    POST /api/topup-wallet");
  console.log("    GET  /api/order/:orderId");
  console.log("    GET  /api/orders/pending");
  console.log("    PATCH /api/order/:orderId/status");
  console.log("=======================================================");
});

module.exports = app; // Export for testing frameworks (e.g., Jest + Supertest)
