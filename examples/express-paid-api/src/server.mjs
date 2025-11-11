import express from "express";
import dotenv from "dotenv";
import { initPaidRoutes, createAutonomousFetch } from "@zynapse/node";

dotenv.config();

const PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS;
if (!PAY_TO_ADDRESS) throw new Error("PAY_TO_ADDRESS missing");

const BUYER_PRIVATE_KEY = process.env.BUYER_PRIVATE_KEY;
if (!BUYER_PRIVATE_KEY) {
  console.warn(
    "[warn] BUYER_PRIVATE_KEY missing – /agent-test will not work until you set it"
  );
}

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
if (!MISTRAL_API_KEY) {
  console.warn(
    "[warn] MISTRAL_API_KEY missing – /pixtral-paid will fail until you set it"
  );
}

const app = express();
app.use(express.json()); // needed for POST body parsing

// --------- 1) Protect /paid + /pixtral-paid with x402 via Zynapse SDK ----------

initPaidRoutes(app, {
  payTo: PAY_TO_ADDRESS,
  routes: {
    "GET /paid": {
      price: "$0.01",
      network: "base-sepolia",
      config: { description: "Simple paid hello" },
    },
    "POST /pixtral-paid": {
      price: "$0.01",
      network: "base-sepolia",
      config: {
        description:
          "Paid Pixtral-12B-2409 response via Mistral API (0.01 USD / call)",
      },
    },
  },
});

// --------- /paid (simple protected hello) ----------

app.get("/paid", (req, res) => {
  // Only reached after successful x402 payment
  res.json({
    message: "welcome to paid api (express/x402)",
    protected: true,
  });
});

// --------- /pixtral-paid (Mistral Pixtral-12B-2409, x402-protected) ----------

app.post("/pixtral-paid", async (req, res) => {
  if (!MISTRAL_API_KEY) {
    return res.status(500).json({
      ok: false,
      error: "MISTRAL_API_KEY not set in env",
    });
  }

  const prompt =
    req.body?.prompt ||
    "You are Pixtral-12B-2409 behind an x402 paywall. Reply with a short hello.";

  try {
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: "pixtral-12b-2409",
        messages: [
          {
            role: "system",
            content:
              "You are a concise, helpful assistant. Keep responses short and clear.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return res.status(500).json({
        ok: false,
        source: "mistral",
        error: data || (await response.text()),
      });
    }

    const answer =
      data?.choices?.[0]?.message?.content ??
      "No content returned from Pixtral-12B-2409.";

    return res.json({
      ok: true,
      model: "pixtral-12b-2409",
      answer,
      usage: data?.usage || null,
      // include raw if you want full debug:
      // raw: data,
    });
  } catch (err) {
    console.error("[pixtral-paid] error", err);
    return res.status(500).json({
      ok: false,
      error: "mistral_request_failed",
      detail: String(err),
    });
  }
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
    try: ["/paid", "/agent-test", "/pixtral-paid"],
  });
});

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => {
  console.log(`express-paid-api running on http://localhost:${PORT}`);
  console.log(`- Paid endpoint:       http://localhost:${PORT}/paid`);
  console.log(`- Agent test:          http://localhost:${PORT}/agent-test`);
  console.log(`- Pixtral paid (POST): http://localhost:${PORT}/pixtral-paid`);
});
