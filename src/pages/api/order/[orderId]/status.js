import { db } from "../../../lib/firebaseAdmin";

export default async function handler(req, res) {
  const { orderId } = req.query;

  if (req.method !== "PATCH" && req.method !== "OPTIONS") {
    res.setHeader("Allow", ["PATCH", "OPTIONS"]);
    return res.status(405).json({ success: false, error: `Method ${req.method} Not Allowed` });
  }

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { status, courierId } = req.body;

    const validStatuses = ["pending", "accepted", "in_transit", "delivered", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: `Invalid status '${status}'.` });
    }

    const orderRef = db.ref(`/orders/order_${orderId}`);
    const orderSnap = await orderRef.once("value");

    if (!orderSnap.exists()) {
      return res.status(404).json({ success: false, error: `Order '${orderId}' not found.` });
    }

    const timelineUpdate = {};
    if (status === "accepted") timelineUpdate["timeline/acceptedAt"] = Date.now();
    if (status === "in_transit") timelineUpdate["timeline/pickedUpAt"] = Date.now();
    if (status === "delivered") timelineUpdate["timeline/deliveredAt"] = Date.now();

    const updatePayload = { status, ...timelineUpdate };
    if (courierId) {
      updatePayload.courierId = courierId;
      await db.ref(`/chats/order_${orderId}/participants/courier`).set(courierId);
    }

    await orderRef.update(updatePayload);

    return res.status(200).json({ success: true, message: `Order status updated to '${status}'.`, orderId, status });
  } catch (error) {
    console.error("[ERROR] PATCH /api/order/status:", error.message);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
}
