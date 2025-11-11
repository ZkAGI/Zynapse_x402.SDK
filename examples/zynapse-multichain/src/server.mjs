// Zynapse Multichain + Pixtral Example (single reusable backend)
//
// This server does two things:
//
// 1) ADMIN SIDE (admin.html):
//    - Frontend calls POST /zynapse/admin/product to define paid Pixtral endpoints.
//    - Each product has:
//        - chain: "evm" or "solana"
//        - method, path
//        - price ($ for EVM, SOL for Solana)
//        - payouts (one or many addresses for split payouts; Solana implemented here, EVM left for splitter-contract extension)
//        - aiBackend: "pixtral"
//        - model: Pixtral/Mistral model name
//    - Server:
//        - Registers the paywall middleware (EVM via x402, Solana via SDK/split helper)
//        - Registers a Pixtral handler for that route
//        - Exposes all products via GET /zynapse/config
//        - Provides /test/evm and /test/sol to simulate autonomous agent calls
//
// 2) CLIENT SIDE (solana-pixtral-chat.html):
//    - Uses the SAME config + endpoints.
//    - Manages a Solana agent wallet via:
//         GET  /wallet/status
//         POST /wallet/create
//    - Uses POST /test/sol?productId=... to:
//         - pay the configured Pixtral Solana endpoint
//         - receive and display paid AI responses (chat-style if desired).
//
// This file is written to be:
//    - Clean
//    - Reusable
//    - Easy to extend for additional AI products & chains
//
// NOTE: For brevity, this focuses on Pixtral AI products only.
//       The patterns are generic enough to plug any backend.

import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  initPaidRoutes,
  initSolanaPaywall,
  createAutonomousFetch,
  createSolanaAutonomousFetch,
} from "@zynapse/node";

dotenv.config();

const app = express();
app.use(express.json());

// ---------- Paths ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const AGENT_WALLET_FILE = path.join(__dirname, "agent-wallet.json");

// ---------- Env: EVM ----------
const EVM_NETWORK =
  process.env.EVM_NETWORK || "base-sepolia";
const EVM_FACILITATOR_URL =
  process.env.EVM_FACILITATOR_URL || "https://x402.org/facilitator";
const EVM_MERCHANT_ADDRESS =
  process.env.EVM_MERCHANT_ADDRESS || "";
const EVM_PAYER_PRIVATE_KEY =
  process.env.EVM_PAYER_PRIVATE_KEY || "";

// ---------- Env: Solana ----------
const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const SOL_MERCHANT_MAIN =
  process.env.SOL_MERCHANT_MAIN || "";

// ---------- Env: Pixtral ----------
const PIXTRAL_API_KEY =
  process.env.PIXTRAL_API_KEY || "";
const PIXTRAL_MODEL =
  process.env.PIXTRAL_MODEL || "pixtral-12b-2409";

const DEFAULT_PIXTRAL_PRICE_USD = Number(
  process.env.DEFAULT_PIXTRAL_PRICE_USD || "0.10"
);
const DEFAULT_PIXTRAL_PRICE_SOL = Number(
  process.env.DEFAULT_PIXTRAL_PRICE_SOL || "0.1"
);

// ---------- Setup connections ----------
const connection = new Connection(SOLANA_RPC_URL, "confirmed");

// ---------- Util helpers ----------

function isValidPubkey(v) {
  try {
    if (!v) return false;
    new PublicKey(v);
    return true;
  } catch {
    return false;
  }
}

// ----- Agent wallet helpers (Solana) -----

function loadAgentKeypairOrNull() {
  if (!fs.existsSync(AGENT_WALLET_FILE)) return null;
  try {
    const raw = fs.readFileSync(AGENT_WALLET_FILE, "utf8");
    const arr = JSON.parse(raw);
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  } catch (e) {
    console.error("[agent] Failed to parse agent-wallet.json:", e);
    return null;
  }
}

function saveAgentKeypair(kp) {
  fs.writeFileSync(
    AGENT_WALLET_FILE,
    JSON.stringify(Array.from(kp.secretKey), null, 2)
  );
}

async function airdropSol(pubkey, solAmount = 1) {
  try {
    const sig = await connection.requestAirdrop(
      pubkey,
      solAmount * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");
    return { ok: true, txSig: sig };
  } catch (e) {
    console.warn("[airdrop] Failed:", e?.message || e);
    return {
      ok: false,
      error:
        "Airdrop failed (maybe faucet limit). Fund this devnet wallet manually if needed.",
    };
  }
}

// ----- Solana split paywall (for multi-payout) -----

function initSolanaSplitPaywall(app, pathUrl, { payouts }) {
  // payouts: [{ to, lamports }]
  const payoutKeys = payouts.map((p) => ({
    ...p,
    pubkey: new PublicKey(p.to),
  }));

  app.use(pathUrl, async (req, res, next) => {
    const header = req.headers["x-payment"];
    if (!header || Array.isArray(header)) {
      return res.status(402).json({
        ok: false,
        error: "payment_required",
        how_to_pay: {
          network: "solana-devnet",
          type: "split",
          payouts,
          header_format:
            'X-PAYMENT: base64({"txSig":"<signature>","payouts":[{"to":"...","lamports":...}]})',
        },
      });
    }

    let payload;
    try {
      const raw = Buffer.from(String(header), "base64").toString("utf8");
      payload = JSON.parse(raw);
    } catch {
      return res
        .status(400)
        .json({ ok: false, error: "invalid_x_payment_encoding" });
    }

    const { txSig } = payload || {};
    if (!txSig) {
      return res
        .status(400)
        .json({ ok: false, error: "missing_txSig" });
    }

    try {
      const tx = await connection.getTransaction(txSig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) {
        return res
          .status(402)
          .json({ ok: false, error: "tx_not_found", txSig });
      }

      const msg = tx.transaction.message;
      let accounts = [];
      const anyMsg = msg;
      if (Array.isArray(anyMsg.accountKeys)) {
        accounts = anyMsg.accountKeys.map((k) =>
          typeof k.toBase58 === "function" ? k.toBase58() : String(k)
        );
      } else if (typeof anyMsg.getAccountKeys === "function") {
        const keys = anyMsg.getAccountKeys();
        const all = [
          ...(keys.staticAccountKeys || []),
          ...(keys.accountKeys || []),
        ];
        accounts = all.map((k) =>
          typeof k.toBase58 === "function" ? k.toBase58() : String(k)
        );
      }

      for (const target of payoutKeys) {
        const idx = accounts.indexOf(target.pubkey.toBase58());
        if (idx === -1) {
          return res.status(402).json({
            ok: false,
            error: "missing_payout",
            missing: target.to,
          });
        }
        const pre =
          (tx.meta?.preBalances && tx.meta.preBalances[idx]) ?? 0;
        const post =
          (tx.meta?.postBalances && tx.meta.postBalances[idx]) ?? 0;
        const delta = post - pre;
        if (delta < target.lamports) {
          return res.status(402).json({
            ok: false,
            error: "insufficient_payout",
            to: target.to,
            required: target.lamports,
            got: delta,
          });
        }
      }

      return next();
    } catch (e) {
      console.error("[split-paywall] verify error", e);
      return res.status(500).json({
        ok: false,
        error: "verification_error",
        detail: String(e?.message || e),
      });
    }
  });
}

// ---------- Product registry (in-memory, admin-controlled) ----------
//
// A "product" here is a reusable config for a paid AI endpoint.

const products = []; // all dynamic Pixtral products

function getAllProducts() {
  return products;
}

// ---------- Core: Register paywall + Pixtral handler for a product ----------

function registerPaywallForProduct(product) {
  const { chain, method, path: routePath, price, priceSol, payouts } =
    product;
  const methodKey = `${(method || "POST").toUpperCase()} ${routePath}`;

  if (chain === "evm") {
    if (!EVM_MERCHANT_ADDRESS) {
      throw new Error(
        "EVM_MERCHANT_ADDRESS not configured; cannot create EVM product"
      );
    }
    if (!price) {
      throw new Error(
        "price (like '$0.10') is required for EVM products"
      );
    }

    // Map this single route to x402 paywall via Zynapse SDK
    initPaidRoutes(app, {
      payTo: EVM_MERCHANT_ADDRESS,
      facilitatorUrl: EVM_FACILITATOR_URL,
      routes: {
        [methodKey]: {
          price,
          network: EVM_NETWORK,
          config: {
            productId: product.id,
            description: product.label,
          },
        },
      },
    });
  }

  if (chain === "solana") {
    const solPrice = Number(priceSol || 0);
    if (!solPrice || solPrice <= 0) {
      throw new Error(
        "priceSol (in SOL) is required for Solana products"
      );
    }
    const lamports = Math.floor(solPrice * LAMPORTS_PER_SOL);

    const validPayouts = Array.isArray(payouts)
      ? payouts.filter((p) => isValidPubkey(p.address))
      : [];

    // Multi-recipient (split) -> use custom split paywall
    if (validPayouts.length > 1) {
      const totalPercent = validPayouts.reduce(
        (s, p) => s + (p.percent || 0),
        0
      );
      const payoutsLamports = validPayouts.map((p, i) => {
        const share =
          i === validPayouts.length - 1
            ? lamports -
              validPayouts
                .slice(0, -1)
                .reduce(
                  (s, x) =>
                    s +
                    Math.floor(
                      (lamports * (x.percent || 0)) / totalPercent
                    ),
                  0
                )
            : Math.floor(
                (lamports * (p.percent || 0)) / totalPercent
              );
        return { to: p.address, lamports: share };
      });

      initSolanaSplitPaywall(app, routePath, {
        payouts: payoutsLamports,
      });
    } else {
      // Single-recipient -> use initSolanaPaywall
      const payTo =
        validPayouts[0]?.address || SOL_MERCHANT_MAIN || "";
      if (!isValidPubkey(payTo)) {
        throw new Error(
          "No valid Solana payee found (configure payouts[0].address or SOL_MERCHANT_MAIN)"
        );
      }

      initSolanaPaywall({
        app,
        path: routePath,
        payTo,
        priceLamports: lamports,
        rpcUrl: SOLANA_RPC_URL,
      });
    }
  }
}

function registerPixtralHandler(product) {
  const method = (product.method || "POST").toLowerCase();
  const routePath = product.path;
  if (!routePath) return;

  // Basic guard: don't double-attach the same route/method.
  if (
    app._router?.stack?.some(
      (l) =>
        l.route &&
        l.route.path === routePath &&
        l.route.methods[method]
    )
  ) {
    return;
  }

  app[method](routePath, async (req, res) => {
    const { prompt } = method === "get" ? req.query : req.body || {};
    const finalPrompt =
      prompt ||
      `Paid Pixtral call for product '${product.id}' via Zynapse.`;

    try {
      if (!PIXTRAL_API_KEY) {
        // Stub: payment has been verified already by paywall middleware.
        return res.json({
          ok: true,
          paid: true,
          backend: "pixtral",
          model: product.model || PIXTRAL_MODEL,
          prompt: finalPrompt,
          stub: true,
          message:
            "[stub] Payment verified. Set PIXTRAL_API_KEY to call Pixtral for real.",
        });
      }

      const resp = await fetch(
        "https://api.mistral.ai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${PIXTRAL_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: product.model || PIXTRAL_MODEL,
            messages: [
              {
                role: "user",
                content: finalPrompt,
              },
            ],
          }),
        }
      );

      const data = await resp.json();

      return res.json({
        ok: true,
        paid: true,
        backend: "pixtral",
        model: product.model || PIXTRAL_MODEL,
        prompt: finalPrompt,
        pixtral_raw: data,
      });
    } catch (e) {
      console.error(`[${routePath}] pixtral error`, e);
      return res.status(500).json({
        ok: false,
        error: "pixtral_request_failed",
        detail: String(e),
      });
    }
  });
}

// ---------- ADMIN: create Pixtral product ----------
//
// Called by admin.html form.
//
// Request body example:
// {
//   "id": "pixtral-evm-1",
//   "label": "Pixtral EVM",
//   "chain": "evm",
//   "method": "POST",
//   "path": "/ai/pixtral-evm-1",
//   "price": "$0.10",
//   "payouts": [{ "address": "0x...", "percent": 100 }],
//   "aiBackend": "pixtral",
//   "model": "pixtral-12b-2409"
// }
//
// OR for Solana:
// {
//   "id": "pixtral-sol-1",
//   "chain": "solana",
//   "method": "POST",
//   "path": "/ai/pixtral-sol-1",
//   "priceSol": 0.1,
//   "payouts": [{ "address": "SOL_PUBKEY", "percent": 100 }],
//   "aiBackend": "pixtral"
// }

app.post("/zynapse/admin/product", (req, res) => {
  try {
    const {
      id,
      label,
      chain,
      method,
      path: routePath,
      price,
      priceSol,
      payouts,
      aiBackend,
      model,
      description,
    } = req.body || {};

    if (!id || !label || !chain || !method || !routePath) {
      return res.status(400).json({
        ok: false,
        error: "missing_required_fields",
      });
    }

    if (getAllProducts().some((p) => p.id === id)) {
      return res.status(400).json({
        ok: false,
        error: "duplicate_id",
      });
    }

    if (aiBackend && aiBackend !== "pixtral") {
      return res.status(400).json({
        ok: false,
        error: "only_pixtral_aiBackend_supported_in_demo",
      });
    }

    const product = {
      id,
      label,
      chain,
      method: method.toUpperCase(),
      path: routePath,
      description: description || "",
      payouts: Array.isArray(payouts) ? payouts : [],
      aiBackend: aiBackend || "pixtral",
      model: model || PIXTRAL_MODEL,
    };

    if (chain === "evm") {
      product.price = price || `$${DEFAULT_PIXTRAL_PRICE_USD}`;
    } else if (chain === "solana") {
      product.priceSol =
        typeof priceSol === "number" && priceSol > 0
          ? priceSol
          : DEFAULT_PIXTRAL_PRICE_SOL;
    } else {
      return res.status(400).json({
        ok: false,
        error: "unsupported_chain",
      });
    }

    // Wire paywall + handler
    registerPaywallForProduct(product);
    registerPixtralHandler(product);

    products.push(product);

    return res.json({
      ok: true,
      product,
    });
  } catch (e) {
    console.error("[/zynapse/admin/product] error", e);
    return res.status(500).json({
      ok: false,
      error: String(e),
    });
  }
});

// ---------- CONFIG: expose products to both widgets ----------

app.get("/zynapse/config", (req, res) => {
  res.json({
    ok: true,
    config: {
      chains: {
        evm: {
          id: "evm",
          label: "Base Sepolia (x402)",
          network: EVM_NETWORK,
          facilitatorUrl: EVM_FACILITATOR_URL,
          merchant: EVM_MERCHANT_ADDRESS || null,
        },
        solana: {
          id: "solana",
          label: "Solana Devnet",
          rpcUrl: SOLANA_RPC_URL,
          merchant: SOL_MERCHANT_MAIN || null,
        },
      },
      products: getAllProducts(),
    },
  });
});

// ---------- AUTONOMOUS TEST: EVM ----------

app.post("/test/evm", async (req, res) => {
  const productId = req.query.productId;
  if (!productId) {
    return res
      .status(400)
      .json({ ok: false, error: "missing_productId" });
  }
  if (!EVM_PAYER_PRIVATE_KEY) {
    return res.status(500).json({
      ok: false,
      error: "EVM_PAYER_PRIVATE_KEY not set",
    });
  }

  const product = getAllProducts().find(
    (p) => p.id === productId && p.chain === "evm"
  );
  if (!product) {
    return res
      .status(404)
      .json({ ok: false, error: "product_not_found" });
  }

  try {
    const { fetchWithPayment, account } = createAutonomousFetch({
      privateKey: EVM_PAYER_PRIVATE_KEY,
    });

    const targetUrl = `${req.protocol}://${req.get(
      "host"
    )}${product.path}`;

    const init =
      product.method === "GET"
        ? { method: "GET" }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: `Test Pixtral via EVM product '${product.id}'`,
            }),
          };

    const r = await fetchWithPayment(targetUrl, init);
    const text = await r.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }

    if (!r.ok) {
      return res.status(500).json({
        ok: false,
        error: "evm_autonomous_payment_failed",
        status: r.status,
        body,
      });
    }

    res.json({
      ok: true,
      chain: "evm",
      productId,
      payer: account.address,
      response: body,
    });
  } catch (e) {
    console.error("[/test/evm] error", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ---------- WALLET endpoints for Solana Pixtral widget ----------

app.get("/wallet/status", async (req, res) => {
  const kp = loadAgentKeypairOrNull();
  if (!kp) {
    return res.json({
      ok: true,
      exists: false,
      message: "No agent wallet yet. Use /wallet/create.",
    });
  }

  try {
    const balance = await connection.getBalance(kp.publicKey);
    return res.json({
      ok: true,
      exists: true,
      publicKey: kp.publicKey.toBase58(),
      balanceSol: balance / LAMPORTS_PER_SOL,
    });
  } catch (e) {
    return res.json({
      ok: true,
      exists: true,
      publicKey: kp.publicKey.toBase58(),
      balanceError: String(e),
    });
  }
});

app.post("/wallet/create", async (req, res) => {
  const existing = loadAgentKeypairOrNull();
  if (existing) {
    const balance = await connection.getBalance(existing.publicKey);
    return res.json({
      ok: true,
      alreadyExists: true,
      publicKey: existing.publicKey.toBase58(),
      balanceSol: balance / LAMPORTS_PER_SOL,
      message:
        "Agent wallet already exists. Using existing wallet for payments.",
    });
  }

  const kp = Keypair.generate();
  saveAgentKeypair(kp);

  const airdropRes = await airdropSol(kp.publicKey, 1);

  return res.json({
    ok: true,
    created: true,
    publicKey: kp.publicKey.toBase58(),
    airdrop: airdropRes,
    note:
      "Agent wallet created. Private key stored on server only.",
  });
});

// ---------- AUTONOMOUS TEST: Solana (used by Pixtral chat widget) ----------
//
// Frontend passes productId of a Solana Pixtral product.
// This endpoint:
//  - ensures agent wallet has enough SOL
//  - uses createSolanaAutonomousFetch to pay + call the product path

app.post("/test/sol", async (req, res) => {
  const productId = req.query.productId;
  if (!productId) {
    return res
      .status(400)
      .json({ ok: false, error: "missing_productId" });
  }

  const kp = loadAgentKeypairOrNull();
  if (!kp) {
    return res.status(400).json({
      ok: false,
      error: "no_agent_wallet",
      message:
        "Create the agent wallet first via /wallet/create.",
    });
  }

  const product = getAllProducts().find(
    (p) => p.id === productId && p.chain === "solana"
  );
  if (!product) {
    return res
      .status(404)
      .json({ ok: false, error: "product_not_found" });
  }

  const { prompt } = req.body || {};
  const testPrompt =
    prompt ||
    `Test Pixtral via Solana product '${product.id}' using autonomous wallet.`;

  try {
    // Ensure sufficient funds
    const priceLamports = Math.floor(
      (product.priceSol || DEFAULT_PIXTRAL_PRICE_SOL) *
        LAMPORTS_PER_SOL
    );
    const minNeeded =
      priceLamports + Math.floor(0.01 * LAMPORTS_PER_SOL);
    let balance = await connection.getBalance(kp.publicKey);

    if (balance < minNeeded) {
      const topup = await airdropSol(kp.publicKey, 1);
      balance = await connection.getBalance(kp.publicKey);

      if (balance < priceLamports) {
        return res.status(400).json({
          ok: false,
          error: "insufficient_funds",
          message:
            "Agent wallet low on SOL and faucet failed. Fund manually on devnet.",
          agent_public_key: kp.publicKey.toBase58(),
          balanceSol: balance / LAMPORTS_PER_SOL,
          faucet: topup,
        });
      }
    }

    const secretJson = fs.readFileSync(AGENT_WALLET_FILE, "utf8");
    const { fetchWithPayment, publicKey } =
      createSolanaAutonomousFetch({
        secretKey: secretJson,
        rpcUrl: SOLANA_RPC_URL,
      });

    const targetUrl = `${req.protocol}://${req.get(
      "host"
    )}${product.path}`;

    let resp;
    try {
      resp = await fetchWithPayment(targetUrl, {
        method: product.method || "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: testPrompt }),
      });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: "send_transaction_failed",
        detail: String(e?.message || e),
        agent_public_key: publicKey || kp.publicKey.toBase58(),
      });
    }

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
        error: "sol_autonomous_payment_or_pixtral_failed",
        status: resp.status,
        body,
      });
    }

    res.json({
      ok: true,
      chain: "solana",
      productId,
      agent_public_key: publicKey,
      response: body,
    });
  } catch (e) {
    console.error("[/test/sol] error", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ---------- Static frontends ----------
//
// /admin -> multichain builder widget
// /chat/solana-pixtral -> solana pixtral wallet widget

app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

app.get("/chat/solana-pixtral", (req, res) => {
  res.sendFile(
    path.join(PUBLIC_DIR, "solana-pixtral-chat.html")
  );
});

// ---------- Start ----------

const PORT = process.env.PORT || 4040;
app.listen(PORT, () => {
  console.log(
    `Zynapse Multichain + Pixtral backend running at http://localhost:${PORT}`
  );
  console.log(`- Admin UI:           /admin`);
  console.log(`- Solana Pixtral UI:  /chat/solana-pixtral`);
  console.log(`- Config:             /zynapse/config`);
});

