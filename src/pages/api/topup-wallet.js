import { db } from "../../lib/firebaseAdmin";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ success: false, error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { userId, amount } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, error: "userId is required." });
    }
    const topupAmount = Number(amount);
    if (isNaN(topupAmount) || topupAmount <= 0) {
      return res.status(400).json({ success: false, error: "amount must be a positive number." });
    }
    if (topupAmount > 10000000) {
      return res.status(400).json({ success: false, error: "amount exceeds maximum top-up limit of Rp10,000,000." });
    }

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
      type: "topup",
      amount: topupAmount,
      newBalance,
      timestamp: Date.now(),
      source: "logiparalel-backend-api",
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
    return res.status(500).json({ success: false, error: "Internal server error.", detail: error.message });
  }
}
