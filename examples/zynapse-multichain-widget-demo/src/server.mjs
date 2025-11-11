// import express from "express";
// import dotenv from "dotenv";
// import fetch from "node-fetch";
// import path from "path";
// import { fileURLToPath } from "url";
// import {
//   initPaidRoutes,
//   initSolanaPaywall,
//   createAutonomousFetch,
//   createSolanaAutonomousFetch,
// } from "@zynapse/node";
// import {
//   Connection,
//   PublicKey,
//   Transaction,
// } from "@solana/web3.js";

// dotenv.config();

// const app = express();
// app.use(express.json());

// // ---------- Paths ----------
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);
// const PUBLIC_DIR = path.join(__dirname, "..", "public");

// // ---------- Env ----------
// const EVM_NETWORK = process.env.EVM_NETWORK || "base-sepolia";
// const EVM_FACILITATOR_URL =
//   process.env.EVM_FACILITATOR_URL || "https://x402.org/facilitator";
// const EVM_MERCHANT_ADDRESS = process.env.EVM_MERCHANT_ADDRESS || "";

// const EVM_PAYER_PRIVATE_KEY = process.env.EVM_PAYER_PRIVATE_KEY || "";

// const SOLANA_RPC_URL =
//   process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

// const SOL_MERCHANT_MAIN = process.env.SOL_MERCHANT_MAIN || "";
// const SOL_MERCHANT_CREATOR = process.env.SOL_MERCHANT_CREATOR || "";
// const SOL_MERCHANT_REFERRER = process.env.SOL_MERCHANT_REFERRER || "";

// const SOL_PAYER_SECRET_JSON = process.env.SOL_PAYER_SECRET_JSON || "";

// const SUBSCRIPTION_SECRET =
//   process.env.SUBSCRIPTION_SECRET || "demo-sub-secret";

// const connection = new Connection(SOLANA_RPC_URL, "confirmed");

// // ---------- In-memory subscription store (demo only) ----------
// const subscriptions = new Map(); // token -> { planId, createdAt }

// // ---------- Solana split paywall helper (example-level) ----------

// /**
//  * initSolanaSplitPaywall:
//  *  - Expects X-PAYMENT: base64({
//  *      txSig: string,
//  *      payouts: [{ to, lamports }]
//  *    })
//  *  - Verifies that:
//  *      * tx exists
//  *      * each payout.to gets at least lamports
//  *  - Only then calls next()
//  */
// function initSolanaSplitPaywall(app, path, { payouts }) {
//   const payoutKeys = payouts.map((p) => ({
//     ...p,
//     pubkey: new PublicKey(p.to),
//   }));

//   app.use(path, async (req, res, next) => {
//     const header = req.headers["x-payment"];

//     if (!header || Array.isArray(header)) {
//       return res.status(402).json({
//         ok: false,
//         error: "payment_required",
//         how_to_pay: {
//           network: "solana-devnet",
//           type: "split",
//           payouts: payouts,
//           header_format:
//             'X-PAYMENT: base64({"txSig":"<signature>","payouts":[{"to":"...","lamports":...}]})',
//         },
//       });
//     }

//     let payload;
//     try {
//       const raw = Buffer.from(String(header), "base64").toString("utf8");
//       payload = JSON.parse(raw);
//     } catch {
//       return res
//         .status(400)
//         .json({ ok: false, error: "invalid_x_payment_encoding" });
//     }

//     const { txSig, payouts: paidPayouts } = payload || {};
//     if (!txSig || !Array.isArray(paidPayouts)) {
//       return res
//         .status(400)
//         .json({ ok: false, error: "missing_txSig_or_payouts" });
//     }

//     try {
//       const tx = await connection.getTransaction(txSig, {
//         commitment: "confirmed",
//         maxSupportedTransactionVersion: 0,
//       });

//       if (!tx) {
//         return res
//           .status(402)
//           .json({ ok: false, error: "tx_not_found", txSig });
//       }

//       const msg = tx.transaction.message;
//       let accounts = [];
//       const anyMsg = msg;

//       if (Array.isArray(anyMsg.accountKeys)) {
//         accounts = anyMsg.accountKeys.map((k) =>
//           typeof k.toBase58 === "function" ? k.toBase58() : String(k)
//         );
//       } else if (typeof anyMsg.getAccountKeys === "function") {
//         const keys = anyMsg.getAccountKeys();
//         const all = [
//           ...(keys.staticAccountKeys || []),
//           ...(keys.accountKeys || []),
//         ];
//         accounts = all.map((k) =>
//           typeof k.toBase58 === "function" ? k.toBase58() : String(k)
//         );
//       }

//       // verify each configured payout got at least requested lamports
//       for (const target of payoutKeys) {
//         const idx = accounts.indexOf(target.pubkey.toBase58());
//         if (idx === -1) {
//           return res.status(402).json({
//             ok: false,
//             error: "missing_payout",
//             missing: target.to,
//           });
//         }

//         const pre =
//           (tx.meta?.preBalances && tx.meta.preBalances[idx]) ?? 0;
//         const post =
//           (tx.meta?.postBalances && tx.meta.postBalances[idx]) ?? 0;
//         const delta = post - pre;

//         if (delta < target.lamports) {
//           return res.status(402).json({
//             ok: false,
//             error: "insufficient_payout",
//             to: target.to,
//             required: target.lamports,
//             got: delta,
//           });
//         }
//       }

//       return next();
//     } catch (e) {
//       console.error("[split-paywall] verify error", e);
//       return res.status(500).json({
//         ok: false,
//         error: "verification_error",
//         detail: String(e?.message || e),
//       });
//     }
//   });
// }

// // ---------- Products / widget config ----------

// const products = [
//   // EVM single pay
//   {
//     id: "evm-hello",
//     label: "EVM Hello (x402)",
//     chain: "evm",
//     method: "GET",
//     path: "/evm/hello",
//     price: "$0.01",
//     payouts: [{ address: EVM_MERCHANT_ADDRESS, percent: 100 }],
//     description: "Simple x402-gated hello endpoint.",
//   },
//   {
//     id: "evm-ai",
//     label: "EVM AI (x402)",
//     chain: "evm",
//     method: "POST",
//     path: "/evm/ai",
//     price: "$0.05",
//     payouts: [{ address: EVM_MERCHANT_ADDRESS, percent: 100 }],
//     description: "Stub AI endpoint behind x402.",
//   },
//   {
//     id: "evm-sub-pro",
//     label: "EVM Pro Subscription",
//     chain: "evm",
//     method: "POST",
//     path: "/sub/evm/pro",
//     price: "$5.00",
//     type: "subscription",
//     payouts: [{ address: EVM_MERCHANT_ADDRESS, percent: 100 }],
//     description: "Demo subscription unlocking /sub/pro/resource.",
//   },

//   // Solana single pay
//   {
//     id: "sol-hello",
//     label: "Solana Hello",
//     chain: "solana",
//     method: "GET",
//     path: "/sol/hello",
//     priceSol: 0.001,
//     payouts: [{ address: SOL_MERCHANT_MAIN, percent: 100 }],
//     description: "Hello endpoint paid on Solana.",
//   },

//   // Solana split pay
//   {
//     id: "sol-split-ai",
//     label: "Solana Split AI",
//     chain: "solana",
//     method: "POST",
//     path: "/sol/split-ai",
//     priceSol: 0.003,
//     payouts: [
//       { address: SOL_MERCHANT_MAIN, percent: 50 },
//       { address: SOL_MERCHANT_CREATOR, percent: 30 },
//       { address: SOL_MERCHANT_REFERRER, percent: 20 },
//     ],
//     description:
//       "AI endpoint where payment is split across multiple Solana wallets.",
//   },
// ];

// // Widget config endpoint
// app.get("/zynapse/config", (req, res) => {
//   res.json({
//     ok: true,
//     config: {
//       chains: {
//         evm: {
//           id: "evm",
//           label: "Base Sepolia (x402)",
//           network: EVM_NETWORK,
//           facilitatorUrl: EVM_FACILITATOR_URL,
//           merchant: EVM_MERCHANT_ADDRESS,
//         },
//         solana: {
//           id: "solana",
//           label: "Solana Devnet",
//           rpcUrl: SOLANA_RPC_URL,
//         },
//       },
//       products,
//     },
//   });
// });

// // ---------- EVM: x402 paywalls ----------

// if (EVM_MERCHANT_ADDRESS) {
//   initPaidRoutes(app, {
//     payTo: EVM_MERCHANT_ADDRESS,
//     facilitatorUrl: EVM_FACILITATOR_URL,
//     routes: {
//       "GET /evm/hello": {
//         price: "$0.01",
//         network: EVM_NETWORK,
//       },
//       "POST /evm/ai": {
//         price: "$0.05",
//         network: EVM_NETWORK,
//       },
//       "POST /sub/evm/pro": {
//         price: "$5.00",
//         network: EVM_NETWORK,
//       },
//     },
//   });
// }

// app.get("/evm/hello", (req, res) => {
//   res.json({
//     ok: true,
//     message: "Hello from EVM paid API (x402 + Zynapse).",
//   });
// });

// app.post("/evm/ai", (req, res) => {
//   const { prompt } = req.body || {};
//   res.json({
//     ok: true,
//     model: "demo-evm-model",
//     prompt,
//     result: `[stub] Paid EVM AI for: ${prompt || "(empty)"}`,
//   });
// });

// // subscription purchase (after x402 pays)
// app.post("/sub/evm/pro", (req, res) => {
//   const token = `sub_${Date.now()}_${Math.random()
//     .toString(36)
//     .slice(2)}`;
//   subscriptions.set(token, {
//     planId: "evm-pro",
//     createdAt: Date.now(),
//   });

//   res.json({
//     ok: true,
//     message: "EVM Pro subscription activated.",
//     subscription_token: token,
//   });
// });

// app.get("/sub/pro/resource", (req, res) => {
//   const token = req.headers["x-subscription-token"];
//   if (!token || Array.isArray(token) || !subscriptions.has(token)) {
//     return res.status(403).json({
//       ok: false,
//       error: "no_or_invalid_subscription",
//     });
//   }
//   res.json({
//     ok: true,
//     message:
//       "Welcome to Pro-only resource. (Demo in-memory subscription check.)",
//   });
// });

// // ---------- Solana: single-pay & split-pay endpoints ----------

// // Single-pay hello using SDK paywall
// if (SOL_MERCHANT_MAIN) {
//   initSolanaPaywall({
//     app,
//     path: "/sol/hello",
//     payTo: SOL_MERCHANT_MAIN,
//     priceLamports: Math.floor(0.001 * 1_000_000_000),
//     rpcUrl: SOLANA_RPC_URL,
//   });
// }

// app.get("/sol/hello", (req, res) => {
//   res.json({
//     ok: true,
//     message: "Hello from Solana single-pay endpoint.",
//   });
// });

// // Split-pay AI endpoint: use custom split paywall
// if (SOL_MERCHANT_MAIN && SOL_MERCHANT_CREATOR && SOL_MERCHANT_REFERRER) {
//   initSolanaSplitPaywall(app, "/sol/split-ai", {
//     payouts: [
//       {
//         to: SOL_MERCHANT_MAIN,
//         lamports: Math.floor(0.0015 * 1_000_000_000),
//       },
//       {
//         to: SOL_MERCHANT_CREATOR,
//         lamports: Math.floor(0.0009 * 1_000_000_000),
//       },
//       {
//         to: SOL_MERCHANT_REFERRER,
//         lamports: Math.floor(0.0006 * 1_000_000_000),
//       },
//     ],
//   });
// }

// app.post("/sol/split-ai", (req, res) => {
//   const { prompt } = req.body || {};
//   res.json({
//     ok: true,
//     model: "demo-solana-model",
//     prompt,
//     result: `[stub] Solana split-paid AI for: ${prompt || "(empty)"}`,
//   });
// });

// // ---------- Autonomous test endpoints for widget ----------

// app.post("/test/evm", async (req, res) => {
//   const productId = req.query.productId;
//   if (!EVM_PAYER_PRIVATE_KEY) {
//     return res.status(500).json({
//       ok: false,
//       error: "EVM_PAYER_PRIVATE_KEY not set",
//     });
//   }
//   if (!productId) {
//     return res.status(400).json({ ok: false, error: "missing_productId" });
//   }

//   const product = products.find(
//     (p) => p.id === productId && p.chain === "evm"
//   );
//   if (!product) {
//     return res.status(404).json({ ok: false, error: "product_not_found" });
//   }

//   try {
//     const { fetchWithPayment, account } = createAutonomousFetch({
//       privateKey: EVM_PAYER_PRIVATE_KEY,
//     });

//     const targetUrl = `${req.protocol}://${req.get("host")}${product.path}`;

//     const init =
//       product.method === "GET"
//         ? { method: "GET" }
//         : {
//             method: "POST",
//             headers: { "Content-Type": "application/json" },
//             body: JSON.stringify({ prompt: "Test from EVM agent" }),
//           };

//     const r = await fetchWithPayment(targetUrl, init);
//     const text = await r.text();
//     let body;
//     try {
//       body = JSON.parse(text);
//     } catch {
//       body = { raw: text };
//     }

//     if (!r.ok) {
//       return res.status(500).json({
//         ok: false,
//         error: "evm_autonomous_payment_failed",
//         status: r.status,
//         body,
//       });
//     }

//     res.json({
//       ok: true,
//       chain: "evm",
//       productId,
//       payer: account.address,
//       response: body,
//     });
//   } catch (e) {
//     console.error("[test/evm] error", e);
//     res.status(500).json({ ok: false, error: String(e) });
//   }
// });

// app.post("/test/sol", async (req, res) => {
//   const productId = req.query.productId;
//   if (!SOL_PAYER_SECRET_JSON) {
//     return res.status(500).json({
//       ok: false,
//       error: "SOL_PAYER_SECRET_JSON not set",
//     });
//   }
//   if (!productId) {
//     return res.status(400).json({ ok: false, error: "missing_productId" });
//   }

//   const product = products.find(
//     (p) => p.id === productId && p.chain === "solana"
//   );
//   if (!product) {
//     return res.status(404).json({ ok: false, error: "product_not_found" });
//   }

//   try {
//     const { fetchWithPayment, publicKey } = createSolanaAutonomousFetch({
//       secretKey: SOL_PAYER_SECRET_JSON,
//       rpcUrl: SOLANA_RPC_URL,
//     });

//     const targetUrl = `${req.protocol}://${req.get("host")}${product.path}`;

//     const init =
//       product.method === "GET"
//         ? { method: "GET" }
//         : {
//             method: "POST",
//             headers: { "Content-Type": "application/json" },
//             body: JSON.stringify({ prompt: "Test from Solana agent" }),
//           };

//     const r = await fetchWithPayment(targetUrl, init);
//     const text = await r.text();
//     let body;
//     try {
//       body = JSON.parse(text);
//     } catch {
//       body = { raw: text };
//     }

//     if (!r.ok) {
//       return res.status(500).json({
//         ok: false,
//         error: "sol_autonomous_payment_failed",
//         status: r.status,
//         body,
//       });
//     }

//     res.json({
//       ok: true,
//       chain: "solana",
//       productId,
//       payer: publicKey,
//       response: body,
//     });
//   } catch (e) {
//     console.error("[test/sol] error", e);
//     res.status(500).json({ ok: false, error: String(e) });
//   }
// });

// // ---------- Static frontend ----------

// app.use(express.static(PUBLIC_DIR));

// // Root -> widget UI
// app.get("/", (req, res) => {
//   res.sendFile(path.join(PUBLIC_DIR, "index.html"));
// });

// // ---------- Start ----------

// const PORT = process.env.PORT || 4040;
// app.listen(PORT, () => {
//   console.log(
//     `Zynapse Multichain Widget Demo running at http://localhost:${PORT}`
//   );
//   console.log(`- Widget UI:        http://localhost:${PORT}/`);
//   console.log(`- Widget config:    http://localhost:${PORT}/zynapse/config`);
// });

import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";
import {
  initPaidRoutes,
  initSolanaPaywall,
  createAutonomousFetch,
  createSolanaAutonomousFetch,
} from "@zynapse/node";
import {
  Connection,
  PublicKey,
} from "@solana/web3.js";

dotenv.config();

const app = express();
app.use(express.json());

// ---------- Paths ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "..", "public");

// ---------- Env ----------
const EVM_NETWORK = process.env.EVM_NETWORK || "base-sepolia";
const EVM_FACILITATOR_URL =
  process.env.EVM_FACILITATOR_URL || "https://x402.org/facilitator";
const EVM_MERCHANT_ADDRESS = process.env.EVM_MERCHANT_ADDRESS || "";

const EVM_PAYER_PRIVATE_KEY = process.env.EVM_PAYER_PRIVATE_KEY || "";

const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const SOL_PAYER_SECRET_JSON = process.env.SOL_PAYER_SECRET_JSON || "";

const SOL_MERCHANT_MAIN = process.env.SOL_MERCHANT_MAIN || "";
const SOL_MERCHANT_CREATOR = process.env.SOL_MERCHANT_CREATOR || "";
const SOL_MERCHANT_REFERRER = process.env.SOL_MERCHANT_REFERRER || "";

const connection = new Connection(SOLANA_RPC_URL, "confirmed");

// Simple helper
function isValidPubkey(v) {
  try {
    if (!v) return false;
    new PublicKey(v);
    return true;
  } catch {
    return false;
  }
}

// ---------- In-memory product config ----------
//
// productsStatic: examples baked in.
// productsDynamic: created via frontend (POST /zynapse/admin/product).
// /zynapse/config returns both.

const productsStatic = [
  // EVM single pay
  {
    id: "evm-hello",
    label: "EVM Hello (x402)",
    chain: "evm",
    method: "GET",
    path: "/evm/hello",
    price: "$0.01",
    payouts: [{ address: EVM_MERCHANT_ADDRESS, percent: 100 }],
    description: "Simple x402-gated hello endpoint.",
  },
  {
    id: "evm-ai",
    label: "EVM AI (x402)",
    chain: "evm",
    method: "POST",
    path: "/evm/ai",
    price: "$0.05",
    payouts: [{ address: EVM_MERCHANT_ADDRESS, percent: 100 }],
    description: "Stub AI endpoint behind x402.",
  },
  // Subscription example
  {
    id: "evm-sub-pro",
    label: "EVM Pro Subscription",
    chain: "evm",
    method: "POST",
    path: "/sub/evm/pro",
    price: "$5.00",
    type: "subscription",
    payouts: [{ address: EVM_MERCHANT_ADDRESS, percent: 100 }],
    description: "Demo subscription unlocking /sub/pro/resource.",
  },
  // Solana single pay
  {
    id: "sol-hello",
    label: "Solana Hello",
    chain: "solana",
    method: "GET",
    path: "/sol/hello",
    priceSol: 0.001,
    payouts: [{ address: SOL_MERCHANT_MAIN, percent: 100 }],
    description: "Hello endpoint paid on Solana devnet.",
  },
  // Solana split example
  {
    id: "sol-split-ai",
    label: "Solana Split AI",
    chain: "solana",
    method: "POST",
    path: "/sol/split-ai",
    priceSol: 0.003,
    payouts: [
      { address: SOL_MERCHANT_MAIN, percent: 50 },
      { address: SOL_MERCHANT_CREATOR, percent: 30 },
      { address: SOL_MERCHANT_REFERRER, percent: 20 },
    ],
    description:
      "AI endpoint where payment is split across multiple Solana wallets.",
  },
];

const productsDynamic = []; // pushed from frontend

function getAllProducts() {
  return [...productsStatic, ...productsDynamic];
}

// In-memory subscription store (demo)
const subscriptions = new Map(); // token -> { planId, createdAt }

// ---------- Solana split paywall (example-level helper) ----------

function initSolanaSplitPaywall(app, pathUrl, { payouts }) {
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

    const { txSig, payouts: paidPayouts } = payload || {};
    if (!txSig || !Array.isArray(paidPayouts)) {
      return res
        .status(400)
        .json({ ok: false, error: "missing_txSig_or_payouts" });
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

      // Collect account keys
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

      // Check each target payout got at least lamports
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

// ---------- 1) Widget config endpoint ----------

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
        },
      },
      products: getAllProducts(),
    },
  });
});

// ---------- 2) Admin: add products from frontend ----------
// This is intentionally simple + in-memory for hackathon use.
// In production: authentication + persistence.

app.post("/zynapse/admin/product", (req, res) => {
  const {
    id,
    label,
    chain,
    method,
    path: routePath,
    price,
    priceSol,
    payouts,
    type,
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

  const normMethod = String(method).toUpperCase();
  const product = {
    id,
    label,
    chain,
    method: normMethod,
    path: routePath,
    description: req.body.description || "",
    type: type === "subscription" ? "subscription" : undefined,
    payouts: Array.isArray(payouts) ? payouts : [],
  };

  try {
    if (chain === "evm") {
      if (!EVM_MERCHANT_ADDRESS) {
        return res.status(400).json({
          ok: false,
          error: "EVM_MERCHANT_ADDRESS_not_configured",
        });
      }
      if (!price) {
        return res.status(400).json({
          ok: false,
          error: "price_required_for_evm",
        });
      }

      // Attach x402 paywall for this route
      initPaidRoutes(app, {
        payTo: EVM_MERCHANT_ADDRESS,
        facilitatorUrl: EVM_FACILITATOR_URL,
        routes: {
          [`${normMethod} ${routePath}`]: {
            price,
            network: EVM_NETWORK,
            config: { dynamic: true, id },
          },
        },
      });

      product.price = price;
    } else if (chain === "solana") {
      if (!priceSol) {
        return res.status(400).json({
          ok: false,
          error: "priceSol_required_for_solana",
        });
      }
      const lamports = Math.floor(Number(priceSol) * 1_000_000_000);

      const validPayouts = (product.payouts || []).filter((p) =>
        isValidPubkey(p.address)
      );

      // If multiple payouts -> use split paywall
      if (validPayouts.length > 1) {
        initSolanaSplitPaywall(app, routePath, {
          payouts: validPayouts.map((p) => ({
            to: p.address,
            lamports: Math.floor((lamports * (p.percent || 0)) / 100),
          })),
        });
      } else {
        // Single pay-to, use SDK helper
        const payTo =
          validPayouts[0]?.address || SOL_MERCHANT_MAIN || null;
        if (!payTo || !isValidPubkey(payTo)) {
          return res.status(400).json({
            ok: false,
            error:
              "no_valid_solana_payee (set payouts[0].address or SOL_MERCHANT_MAIN)",
          });
        }
        initSolanaPaywall({
          app,
          path: routePath,
          payTo,
          priceLamports: lamports,
          rpcUrl: SOLANA_RPC_URL,
        });
      }

      product.priceSol = Number(priceSol);
    } else {
      return res.status(400).json({
        ok: false,
        error: "unsupported_chain",
      });
    }

    productsDynamic.push(product);

    return res.json({
      ok: true,
      product,
    });
  } catch (e) {
    console.error("[admin/product] error", e);
    return res.status(500).json({
      ok: false,
      error: String(e),
    });
  }
});

// ---------- 3) Static core handlers for static products ----------

// EVM statics
if (EVM_MERCHANT_ADDRESS) {
  initPaidRoutes(app, {
    payTo: EVM_MERCHANT_ADDRESS,
    facilitatorUrl: EVM_FACILITATOR_URL,
    routes: {
      "GET /evm/hello": { price: "$0.01", network: EVM_NETWORK },
      "POST /evm/ai": { price: "$0.05", network: EVM_NETWORK },
      "POST /sub/evm/pro": { price: "$5.00", network: EVM_NETWORK },
    },
  });
}

app.get("/evm/hello", (req, res) => {
  res.json({
    ok: true,
    message: "Hello from EVM paid API (x402 + Zynapse).",
  });
});

app.post("/evm/ai", (req, res) => {
  const { prompt } = req.body || {};
  res.json({
    ok: true,
    model: "demo-evm-model",
    prompt,
    result: `[stub] Paid EVM AI for: ${prompt || "(empty)"}`,
  });
});

app.post("/sub/evm/pro", (req, res) => {
  const token = `sub_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}`;
  subscriptions.set(token, {
    planId: "evm-pro",
    createdAt: Date.now(),
  });

  res.json({
    ok: true,
    message: "EVM Pro subscription activated.",
    subscription_token: token,
  });
});

app.get("/sub/pro/resource", (req, res) => {
  const token = req.headers["x-subscription-token"];
  if (!token || Array.isArray(token) || !subscriptions.has(token)) {
    return res.status(403).json({
      ok: false,
      error: "no_or_invalid_subscription",
    });
  }
  res.json({
    ok: true,
    message:
      "Welcome to Pro-only resource. (Demo in-memory subscription check.)",
  });
});

// Solana static: hello
if (isValidPubkey(SOL_MERCHANT_MAIN)) {
  initSolanaPaywall({
    app,
    path: "/sol/hello",
    payTo: SOL_MERCHANT_MAIN,
    priceLamports: Math.floor(0.001 * 1_000_000_000),
    rpcUrl: SOLANA_RPC_URL,
  });
} else {
  console.warn(
    "[sol] Skipping /sol/hello: SOL_MERCHANT_MAIN invalid or missing"
  );
}

app.get("/sol/hello", (req, res) => {
  res.json({
    ok: true,
    message: "Hello from Solana single-pay endpoint.",
  });
});

// Solana static: split-ai
if (
  isValidPubkey(SOL_MERCHANT_MAIN) &&
  isValidPubkey(SOL_MERCHANT_CREATOR) &&
  isValidPubkey(SOL_MERCHANT_REFERRER)
) {
  initSolanaSplitPaywall(app, "/sol/split-ai", {
    payouts: [
      {
        to: SOL_MERCHANT_MAIN,
        lamports: Math.floor(0.0015 * 1_000_000_000),
      },
      {
        to: SOL_MERCHANT_CREATOR,
        lamports: Math.floor(0.0009 * 1_000_000_000),
      },
      {
        to: SOL_MERCHANT_REFERRER,
        lamports: Math.floor(0.0006 * 1_000_000_000),
      },
    ],
  });
} else {
  console.warn(
    "[sol] Skipping /sol/split-ai: one or more SOL_MERCHANT_* invalid"
  );
}

app.post("/sol/split-ai", (req, res) => {
  const { prompt } = req.body || {};
  res.json({
    ok: true,
    model: "demo-solana-model",
    prompt,
    result: `[stub] Solana split-paid AI for: ${prompt || "(empty)"}`,
  });
});

// ---------- 4) Autonomous test endpoints used by widget ----------

app.post("/test/evm", async (req, res) => {
  const productId = req.query.productId;
  if (!EVM_PAYER_PRIVATE_KEY) {
    return res.status(500).json({
      ok: false,
      error: "EVM_PAYER_PRIVATE_KEY not set",
    });
  }
  if (!productId) {
    return res.status(400).json({ ok: false, error: "missing_productId" });
  }

  const product = getAllProducts().find(
    (p) => p.id === productId && p.chain === "evm"
  );
  if (!product) {
    return res.status(404).json({ ok: false, error: "product_not_found" });
  }

  try {
    const { fetchWithPayment, account } = createAutonomousFetch({
      privateKey: EVM_PAYER_PRIVATE_KEY,
    });

    const targetUrl = `${req.protocol}://${req.get("host")}${product.path}`;

    const init =
      product.method === "GET"
        ? { method: "GET" }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: `Test from EVM agent for ${product.id}`,
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
    console.error("[test/evm] error", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post("/test/sol", async (req, res) => {
  const productId = req.query.productId;
  if (!SOL_PAYER_SECRET_JSON) {
    return res.status(500).json({
      ok: false,
      error: "SOL_PAYER_SECRET_JSON not set",
    });
  }
  if (!productId) {
    return res.status(400).json({ ok: false, error: "missing_productId" });
  }

  const product = getAllProducts().find(
    (p) => p.id === productId && p.chain === "solana"
  );
  if (!product) {
    return res.status(404).json({ ok: false, error: "product_not_found" });
  }

  try {
    const { fetchWithPayment, publicKey } = createSolanaAutonomousFetch({
      secretKey: SOL_PAYER_SECRET_JSON,
      rpcUrl: SOLANA_RPC_URL,
    });

    const targetUrl = `${req.protocol}://${req.get("host")}${product.path}`;

    const init =
      product.method === "GET"
        ? { method: "GET" }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: `Test from Solana agent for ${product.id}`,
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
        error: "sol_autonomous_payment_failed",
        status: r.status,
        body,
      });
    }

    res.json({
      ok: true,
      chain: "solana",
      productId,
      payer: publicKey,
      response: body,
    });
  } catch (e) {
    console.error("[test/sol] error", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ---------- 5) Static frontend ----------

app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// ---------- Start ----------

const PORT = process.env.PORT || 4040;
app.listen(PORT, () => {
  console.log(
    `Zynapse Multichain Widget Demo running at http://localhost:${PORT}`
  );
  console.log(`- Widget UI:        http://localhost:${PORT}/`);
  console.log(`- Widget config:    http://localhost:${PORT}/zynapse/config`);
});

