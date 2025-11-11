import express from "express";
import dotenv from "dotenv";
import {
  initSolanaPaywall,
  createSolanaAutonomousFetch,
} from "@zynapse/node";

dotenv.config();

console.log("[boot] CWD:", process.cwd());
console.log(
  "[boot] SOL_BUYER_SECRET_JSON present:",
  process.env.SOL_BUYER_SECRET_JSON
    ? `(length=${process.env.SOL_BUYER_SECRET_JSON.length})`
    : "NO"
);
console.log(
  "[boot] SOL_PAY_TO_ADDRESS:",
  process.env.SOL_PAY_TO_ADDRESS || "NO"
);

const SOL_PAY_TO_ADDRESS = process.env.SOL_PAY_TO_ADDRESS;
if (!SOL_PAY_TO_ADDRESS) {
  throw new Error("SOL_PAY_TO_ADDRESS missing");
}

const SOL_BUYER_SECRET_JSON = process.env.SOL_BUYER_SECRET_JSON;
if (!SOL_BUYER_SECRET_JSON) {
  console.warn(
    "[warn] SOL_BUYER_SECRET_JSON missing – /agent-test-sol will not work"
  );
}

const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

const app = express();

// 1) Protect /sol-paid with Solana paywall
initSolanaPaywall({
  app,
  path: "/sol-paid",
  payTo: SOL_PAY_TO_ADDRESS,
  priceLamports: Math.floor(0.001 * 1_000_000_000), // 0.001 SOL
  rpcUrl: SOLANA_RPC_URL,
});

// Only reached once on-chain payment is verified
app.get("/sol-paid", (req, res) => {
  res.json({
    ok: true,
    message: "welcome to paid api (solana-devnet via zynapse)",
    protected: true,
  });
});

// 2) Autonomous Solana agent using @zynapse/node
app.get("/agent-test-sol", async (req, res) => {
  if (!SOL_BUYER_SECRET_JSON) {
    return res.status(500).json({
      ok: false,
      error: "SOL_BUYER_SECRET_JSON not set",
    });
  }

  try {
    const { fetchWithPayment, publicKey } = createSolanaAutonomousFetch({
      secretKey: SOL_BUYER_SECRET_JSON,
      rpcUrl: SOLANA_RPC_URL,
    });

    const url = `${req.protocol}://${req.get("host")}/sol-paid`;

    const response = await fetchWithPayment(url, { method: "GET" });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }

    if (!response.ok) {
      return res.status(500).json({
        ok: false,
        error: "solana_autonomous_payment_failed",
        status: response.status,
        body,
      });
    }

    res.json({
      ok: true,
      note: "Solana agent paid and accessed /sol-paid via Zynapse.",
      payer: publicKey,
      payee: SOL_PAY_TO_ADDRESS,
      protected_response: body,
    });
  } catch (e) {
    console.error("[agent-test-sol] error", e);
    res.status(500).json({
      ok: false,
      error: String(e),
    });
  }
});

// Root
app.get("/", (req, res) => {
  res.json({
    status: "up",
    network: "solana-devnet",
    try: ["/sol-paid", "/agent-test-sol"],
  });
});

const PORT = process.env.PORT || 4010;
app.listen(PORT, () => {
  console.log(`express-solana-devnet-api running on http://localhost:${PORT}`);
  console.log(`- Paid route:       http://localhost:${PORT}/sol-paid`);
  console.log(`- Agent test (sol): http://localhost:${PORT}/agent-test-sol`);
});
