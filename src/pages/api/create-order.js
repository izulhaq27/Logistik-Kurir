import { db } from "../../lib/firebaseAdmin";

function generateOrderId() {
  const year = new Date().getFullYear();
  const counter = String(Math.floor(Math.random() * 9999) + 1).padStart(4, "0");
  return `ORD-${year}-${counter}`;
}

function validateOrderPayload(body) {
  const errors = [];
  if (!body.customerId) errors.push("customerId is required.");
  if (!body.pickup?.address) errors.push("pickup.address is required.");
  if (!body.destination?.address) errors.push("destination.address is required.");
  if (!body.package?.description) errors.push("package.description is required.");
  if (typeof body.package?.weight !== "number") errors.push("package.weight must be a number.");
  return errors;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ success: false, error: `Method ${req.method} Not Allowed` });
  }

  try {
    const validationErrors = validateOrderPayload(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({ success: false, errors: validationErrors });
    }

    const { customerId, pickup, destination, package: pkg, note = "" } = req.body;

    const BASE_FEE = 15000;
    const PER_KM_RATE = 3000;
    const estimatedKm = Math.floor(Math.random() * 10) + 2;
    const distanceFee = estimatedKm * PER_KM_RATE;
    const totalFee = BASE_FEE + distanceFee;

    const orderId = generateOrderId();
    const now = Date.now();
    const orderDoc = {
      orderId,
      status: "pending",
      customerId,
      courierId: null,
      pickup: {
        address: pickup.address,
        lat: pickup.lat ?? null,
        lng: pickup.lng ?? null,
        contactName: pickup.contactName ?? "",
        contactPhone: pickup.contactPhone ?? "",
      },
      destination: {
        address: destination.address,
        lat: destination.lat ?? null,
        lng: destination.lng ?? null,
        contactName: destination.contactName ?? "",
        contactPhone: destination.contactPhone ?? "",
      },
      package: {
        description: pkg.description,
        weight: pkg.weight,
        weightUnit: pkg.weightUnit ?? "kg",
        category: pkg.category ?? "general",
      },
      pricing: {
        baseFee: BASE_FEE,
        distanceFee,
        totalFee,
        currency: "IDR",
        paymentMethod: "wallet",
      },
      timeline: {
        createdAt: now,
        acceptedAt: null,
        pickedUpAt: null,
        deliveredAt: null,
      },
      note,
    };

    console.log(`[PARALLEL] Dispatching 3 concurrent Firebase writes for order ${orderId}...`);
    const startTime = Date.now();

    const [writeOrderResult, deductWalletResult, createChatResult] = await Promise.all([
      db.ref(`/orders/order_${orderId}`).set(orderDoc),
      (async () => {
        const walletRef = db.ref(`/users/${customerId}/wallet/balance`);
        return walletRef.transaction((currentBalance) => {
          const safeBalance = currentBalance ?? 0;
          if (safeBalance < totalFee) {
            return undefined;
          }
          return safeBalance - totalFee;
        });
      })(),
      db.ref(`/chats/order_${orderId}`).set({
        orderId,
        participants: { customer: customerId, courier: null },
        messages: {},
      }),
    ]);

    const elapsed = Date.now() - startTime;
    console.log(`[PARALLEL] All 3 tasks completed in ${elapsed}ms (parallel).`);

    if (deductWalletResult && deductWalletResult.committed === false) {
      await Promise.all([
        db.ref(`/orders/order_${orderId}`).remove(),
        db.ref(`/chats/order_${orderId}`).remove(),
      ]);
      return res.status(402).json({
        success: false,
        error: "Insufficient wallet balance. Order cancelled.",
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
    return res.status(500).json({ success: false, error: "Internal server error.", detail: error.message });
  }
}
