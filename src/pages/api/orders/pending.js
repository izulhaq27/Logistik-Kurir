import { db } from "../../../lib/firebaseAdmin";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ success: false, error: `Method ${req.method} Not Allowed` });
  }

  try {
    const snap = await db.ref("/orders")
      .orderByChild("status")
      .equalTo("pending")
      .once("value");

    const orders = [];
    snap.forEach((child) => {
      orders.push(child.val());
    });

    return res.status(200).json({ success: true, count: orders.length, orders });
  } catch (error) {
    console.error("[ERROR] GET /api/orders/pending:", error.message);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
}
