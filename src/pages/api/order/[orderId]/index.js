import { db } from "../../../lib/firebaseAdmin";

export default async function handler(req, res) {
  const { orderId } = req.query;

  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ success: false, error: `Method ${req.method} Not Allowed` });
  }

  try {
    const snap = await db.ref(`/orders/order_${orderId}`).once("value");

    if (!snap.exists()) {
      return res.status(404).json({ success: false, error: `Order '${orderId}' not found.` });
    }

    return res.status(200).json({ success: true, order: snap.val() });
  } catch (error) {
    console.error("[ERROR] GET /api/order:", error.message);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
}
