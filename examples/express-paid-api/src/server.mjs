import express from "express";
import dotenv from "dotenv";
import { initPaidRoutes, createAutonomousFetch } from "@zynapse/node";

dotenv.config();

const PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS;
if (!PAY_TO_ADDRESS) throw new Error("PAY_TO_ADDRESS missing");

const BUYER_PRIVATE_KEY = process.env.BUYER_PRIVATE_KEY;
if (!BUYER_PRIVATE_KEY) {
  console.warn("[warn] BUYER_PRIVATE_KEY missing – /agent-test will not work until you set it");
}

const app = express();

// --------- 1) Protect /paid with x402 via Zynapse SDK ----------

initPaidRoutes(app, {
  payTo: PAY_TO_ADDRESS,
  routes: {
    "GET /paid": {
      price: "$0.01",
      network: "base-sepolia",
      config: { description: "Simple paid hello" },
    },
  },
});

app.get("/paid", (req, res) => {
  // Only reached after successful x402 payment
  res.json({
    message: "welcome to paid api (express/x402)",
    protected: true,
  });
});

// --------- 2) Autonomous agent hitting /paid ----------

app.get("/agent-test", async (req, res) => {
  if (!BUYER_PRIVATE_KEY) {
    return res.status(500).json({
      ok: false,
      error: "BUYER_PRIVATE_KEY not set in env",
    });
  }

  try {
    // Create autonomous client (x402-fetch + viem wallet)
    const { fetchWithPayment, account } = createAutonomousFetch({
      privateKey: BUYER_PRIVATE_KEY,
    });

    const targetUrl = `${req.protocol}://${req.get("host")}/paid`;

    // This call:
    //  - hits /paid
    //  - sees 402 + x402 challenge
    //  - pays via facilitator using BUYER_PRIVATE_KEY wallet
    //  - retries with X-PAYMENT
    const response = await fetchWithPayment(targetUrl, { method: "GET" });

    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    if (!response.ok) {
      return res.status(500).json({
        ok: false,
        error: "autonomous_payment_failed",
        status: response.status,
        body: json,
      });
    }

    // X-PAYMENT-RESPONSE (if facilitator returns it) can be decoded here if needed:
    const paymentHeader =
      response.headers.get("x-payment-response") ||
      response.headers.get("X-PAYMENT-RESPONSE");

    let paymentResponse = null;
    if (paymentHeader) {
      try {
        const decoded = Buffer.from(paymentHeader, "base64").toString("utf8");
        paymentResponse = JSON.parse(decoded);
      } catch {
        paymentResponse = { raw: paymentHeader };
      }
    }

    return res.json({
      ok: true,
      note: "Agent paid and accessed /paid successfully via x402.",
      paid_response: json,
      payer: account.address,
      payee: PAY_TO_ADDRESS,
      payment_response: paymentResponse,
    });
  } catch (err) {
    console.error("[agent-test] error", err);
    return res.status(500).json({
      ok: false,
      error: String(err),
    });
  }
});

// --------- 3) Root ----------

app.get("/", (req, res) => {
  res.json({
    status: "up",
    try: ["/paid", "/agent-test"],
  });
});

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => {
  console.log(`express-paid-api running on http://localhost:${PORT}`);
  console.log(`- Paid endpoint:  http://localhost:${PORT}/paid`);
  console.log(`- Agent test:     http://localhost:${PORT}/agent-test`);
});
