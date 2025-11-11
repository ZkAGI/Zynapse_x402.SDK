import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  initSolanaPaywall,
  createSolanaAutonomousFetch,
} from "@zynapse/node";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Config ----------

const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

const MERCHANT_SOL_ADDRESS = process.env.MERCHANT_SOL_ADDRESS;
if (!MERCHANT_SOL_ADDRESS) {
  throw new Error("MERCHANT_SOL_ADDRESS missing in .env");
}

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || "";
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || "mistral-small-latest";
const MISTRAL_PRICE_SOL = Number(process.env.MISTRAL_PRICE_SOL || "0.1");
const PRICE_LAMPORTS = Math.floor(MISTRAL_PRICE_SOL * LAMPORTS_PER_SOL);

// Where we store the payer/agent wallet (server-only)
const AGENT_WALLET_FILE = path.join(__dirname, "agent-wallet.json");

// ---------- Helpers: load or create payer wallet ----------

function loadOrCreateAgentKeypair() {
  if (fs.existsSync(AGENT_WALLET_FILE)) {
    const raw = fs.readFileSync(AGENT_WALLET_FILE, "utf8");
    const arr = JSON.parse(raw);
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }

  const kp = Keypair.generate();
  fs.writeFileSync(
    AGENT_WALLET_FILE,
    JSON.stringify(Array.from(kp.secretKey), null, 2)
  );
  console.log(
    "[agent] Created new payer wallet:",
    kp.publicKey.toBase58()
  );
  console.log(
    "[agent] Secret stored internally in agent-wallet.json (DO NOT EXPOSE)."
  );
  return kp;
}

async function tryAirdrop(connection, pubkey, amountSol) {
  try {
    const sig = await connection.requestAirdrop(
      pubkey,
      Math.floor(amountSol * LAMPORTS_PER_SOL)
    );
    await connection.confirmTransaction(sig, "confirmed");
    console.log(
      `[airdrop] Funded ${pubkey.toBase58()} with ~${amountSol} SOL (devnet)`
    );
  } catch (e) {
    console.warn(
      "[airdrop] Could not auto-airdrop (may already be funded / faucet limit):",
      e?.message || e
    );
  }
}

// ---------- Boot ----------

const connection = new Connection(SOLANA_RPC_URL, "confirmed");

// Payer wallet: used internally for autonomous payments
const agentKeypair = loadOrCreateAgentKeypair();

// Best-effort funding for demo (ok if it fails)
tryAirdrop(connection, agentKeypair.publicKey, 2).catch(() => {});

// ---------- Express app ----------

const app = express();
app.use(express.json());

// 1️⃣ Public: reveal payer public key (no secret), and merchant address
app.get("/wallet", (req, res) => {
  res.json({
    ok: true,
    payer_public_key: agentKeypair.publicKey.toBase58(),
    merchant_public_key: MERCHANT_SOL_ADDRESS,
    note:
      "Payer wallet is used internally for autonomous payments. Only its public key is exposed.",
  });
});

// 2️⃣ Protect /mistral-paid with Solana paywall via Zynapse SDK

initSolanaPaywall({
  app,
  path: "/mistral-paid",
  payTo: MERCHANT_SOL_ADDRESS,
  priceLamports: PRICE_LAMPORTS,
  rpcUrl: SOLANA_RPC_URL,
});

// Only reached after a valid on-chain payment is proven
app.post("/mistral-paid", async (req, res) => {
  const { prompt } = req.body || {};

  if (!prompt) {
    return res.status(400).json({
      ok: false,
      error: "missing_prompt",
    });
  }

  try {
    if (!MISTRAL_API_KEY) {
      // Stub: no external call, but proves paywall flow works
      return res.json({
        ok: true,
        paid: true,
        model: MISTRAL_MODEL,
        prompt,
        stub: true,
        message:
          "[stub] Payment verified. This is where the real Mistral response would appear.",
      });
    }

    const mistralRes = await fetch(
      "https://api.mistral.ai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MISTRAL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MISTRAL_MODEL,
          messages: [{ role: "user", content: prompt }],
        }),
      }
    );

    const data = await mistralRes.json();

    return res.json({
      ok: true,
      paid: true,
      model: MISTRAL_MODEL,
      prompt,
      mistral_raw: data,
    });
  } catch (e) {
    console.error("[/mistral-paid] error", e);
    return res.status(500).json({
      ok: false,
      error: "mistral_request_failed",
      detail: String(e),
    });
  }
});

// 3️⃣ Public autonomous endpoint: pays + calls /mistral-paid using payer wallet

app.post("/mistral-auto", async (req, res) => {
  const { prompt } = req.body || {};

  if (!prompt) {
    return res.status(400).json({
      ok: false,
      error: "missing_prompt",
    });
  }

  try {
    // Read internal secret JSON for payer (never exposed)
    const secretJson = fs.readFileSync(AGENT_WALLET_FILE, "utf8");

    const { fetchWithPayment, publicKey } = createSolanaAutonomousFetch({
      secretKey: secretJson,
      rpcUrl: SOLANA_RPC_URL,
    });

    const targetUrl = `${req.protocol}://${req.get("host")}/mistral-paid`;

    const resp = await fetchWithPayment(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    const text = await resp.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }

    if (!resp.ok) {
      return res.status(500).json({
        ok: false,
        error: "autonomous_payment_or_mistral_failed",
        status: resp.status,
        body,
      });
    }

    return res.json({
      ok: true,
      note:
        "Autonomous agent paid via Solana devnet using Zynapse SDK and fetched the paid Mistral result.",
      payer_public_key: publicKey,
      merchant_public_key: MERCHANT_SOL_ADDRESS,
      price_sol: MISTRAL_PRICE_SOL,
      mistral_response: body,
    });
  } catch (e) {
    console.error("[/mistral-auto] error", e);
    return res.status(500).json({
      ok: false,
      error: String(e),
    });
  }
});

// Root info
app.get("/", (req, res) => {
  res.json({
    status: "up",
    description:
      "Zynapse Solana + Mistral autonomous pay-per-call demo (0.1 SOL per request).",
    endpoints: {
      wallet_info: "/wallet",
      autonomous_mistral: "/mistral-auto",
      paid_mistral_direct: "/mistral-paid (requires X-PAYMENT header)",
    },
  });
});

const PORT = process.env.PORT || 4020;
app.listen(PORT, () => {
  console.log(
    `solana-mistral-autonomous running on http://localhost:${PORT}`
  );
  console.log(`- Wallet info:        http://localhost:${PORT}/wallet`);
  console.log(`- Autonomous Mistral: http://localhost:${PORT}/mistral-auto`);
});
