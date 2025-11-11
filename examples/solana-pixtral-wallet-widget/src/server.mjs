// // Solana Pixtral Wallet Widget Example
// //
// // Features:
// //  1. "Create Wallet" button in the frontend:
// //       - Calls POST /wallet/create
// //       - Backend generates a new Solana devnet Keypair
// //       - Stores secret in agent-wallet.json (server-side only)
// //       - Requests ~10 SOL airdrop (devnet) for testing
// //       - Returns ONLY public key + status
// //
// //  2. Paid Pixtral AI endpoint:
// //       - POST /ai/pixtral
// //       - Protected by initSolanaPaywall from @zynapse/node
// //       - Requires PIXTRAL_PRICE_SOL (e.g. 0.1 SOL) to MERCHANT_SOL_ADDRESS
// //
// //  3. Autonomous test endpoint:
// //       - POST /test/pixtral
// //       - Uses the internally stored payer wallet
// //       - Automatically:
// //           * pays via Solana paywall
// //           * calls /ai/pixtral
// //           * returns Pixtral (or stub) response
// //
// //  4. Widget:
// //       - GET /wallet/status  -> see if agent wallet exists & funded
// //       - POST /wallet/create -> create & fund agent wallet
// //       - POST /test/pixtral  -> trigger autonomous paid Pixtral call
// //       - GET /zynapse/config -> describe the product to the widget
// //
// //  Private key is NEVER exposed via any endpoint.

// import express from "express";
// import dotenv from "dotenv";
// import fetch from "node-fetch";
// import path from "path";
// import fs from "fs";
// import { fileURLToPath } from "url";
// import {
//   Connection,
//   Keypair,
//   PublicKey,
//   LAMPORTS_PER_SOL,
// } from "@solana/web3.js";
// import {
//   initSolanaPaywall,
//   createSolanaAutonomousFetch,
// } from "@zynapse/node";

// dotenv.config();

// const app = express();
// app.use(express.json());

// // ---------- Paths ----------
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);
// const PUBLIC_DIR = path.join(__dirname, "..", "public");
// const AGENT_WALLET_FILE = path.join(__dirname, "agent-wallet.json");

// // ---------- Env ----------

// const SOLANA_RPC_URL =
//   process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

// const MERCHANT_SOL_ADDRESS = process.env.MERCHANT_SOL_ADDRESS || "";
// const PIXTRAL_API_KEY = process.env.PIXTRAL_API_KEY || "";
// const PIXTRAL_MODEL =
//   process.env.PIXTRAL_MODEL || "pixtral-12b-2409";
// const PIXTRAL_PRICE_SOL = Number(
//   process.env.PIXTRAL_PRICE_SOL || "0.1"
// ); // 0.1 SOL default
// const PIXTRAL_PRICE_LAMPORTS = Math.floor(
//   PIXTRAL_PRICE_SOL * LAMPORTS_PER_SOL
// );

// if (!MERCHANT_SOL_ADDRESS) {
//   console.warn(
//     "[warn] MERCHANT_SOL_ADDRESS missing. Set it in .env (devnet pubkey)."
//   );
// }

// const connection = new Connection(SOLANA_RPC_URL, "confirmed");

// // ---------- Helpers: agent wallet management ----------

// // Load agent Keypair from file if exists; otherwise return null.
// function loadAgentKeypairOrNull() {
//   if (!fs.existsSync(AGENT_WALLET_FILE)) return null;
//   const raw = fs.readFileSync(AGENT_WALLET_FILE, "utf8");
//   try {
//     const arr = JSON.parse(raw);
//     return Keypair.fromSecretKey(Uint8Array.from(arr));
//   } catch (e) {
//     console.error("[agent] Failed to parse agent-wallet.json", e);
//     return null;
//   }
// }

// // Save agent Keypair secret to file (server-only).
// function saveAgentKeypair(kp) {
//   fs.writeFileSync(
//     AGENT_WALLET_FILE,
//     JSON.stringify(Array.from(kp.secretKey), null, 2)
//   );
// }

// // Try airdrop 10 SOL to a pubkey (best-effort).
// async function airdrop10Sol(pubkey) {
//   try {
//     const sig = await connection.requestAirdrop(
//       pubkey,
//       2 * LAMPORTS_PER_SOL
//     );
//     await connection.confirmTransaction(sig, "confirmed");
//     return { ok: true, txSig: sig };
//   } catch (e) {
//     console.warn("[airdrop] Failed to airdrop 10 SOL:", e?.message || e);
//     return {
//       ok: false,
//       error:
//         "Airdrop failed (maybe faucet limit). You can manually fund this devnet wallet.",
//     };
//   }
// }

// // ---------- 1) Wallet endpoints (used by widget) ----------

// // Get current agent wallet status (public only)
// app.get("/wallet/status", async (req, res) => {
//   const kp = loadAgentKeypairOrNull();
//   if (!kp) {
//     return res.json({
//       ok: true,
//       exists: false,
//       message: "No agent wallet yet. Use /wallet/create.",
//     });
//   }

//   try {
//     const balance = await connection.getBalance(kp.publicKey);
//     return res.json({
//       ok: true,
//       exists: true,
//       publicKey: kp.publicKey.toBase58(),
//       balanceLamports: balance,
//       balanceSol: balance / LAMPORTS_PER_SOL,
//       note:
//         "This is the autonomous payer wallet. Private key is stored server-side only.",
//     });
//   } catch (e) {
//     return res.json({
//       ok: true,
//       exists: true,
//       publicKey: kp.publicKey.toBase58(),
//       balanceError: String(e),
//     });
//   }
// });

// // Create agent wallet + fund with 10 SOL devnet (best-effort)
// app.post("/wallet/create", async (req, res) => {
//   // If already exists, just return its status.
//   const existing = loadAgentKeypairOrNull();
//   if (existing) {
//     const balance = await connection.getBalance(existing.publicKey);
//     return res.json({
//       ok: true,
//       alreadyExists: true,
//       publicKey: existing.publicKey.toBase58(),
//       balanceSol: balance / LAMPORTS_PER_SOL,
//       message:
//         "Agent wallet already exists. Using existing wallet for payments.",
//     });
//   }

//   // Create new wallet
//   const kp = Keypair.generate();
//   saveAgentKeypair(kp);

//   // Airdrop 10 SOL
//   const airdropRes = await airdrop10Sol(kp.publicKey);

//   return res.json({
//     ok: true,
//     created: true,
//     publicKey: kp.publicKey.toBase58(),
//     airdrop: airdropRes,
//     note:
//       "Agent wallet created. Private key is stored internally and never exposed.",
//   });
// });

// // ---------- 2) Widget config endpoint ----------
// //
// // Frontend reads this to discover the paid Pixtral product.

// app.get("/zynapse/config", (req, res) => {
//   res.json({
//     ok: true,
//     config: {
//       chains: {
//         solana: {
//           id: "solana",
//           label: "Solana Devnet",
//           rpcUrl: SOLANA_RPC_URL,
//           merchant: MERCHANT_SOL_ADDRESS || null,
//         },
//       },
//       products: [
//         {
//           id: "pixtral-sol-basic",
//           label: "Pixtral Solana Paid AI",
//           chain: "solana",
//           method: "POST",
//           path: "/ai/pixtral",
//           priceSol: PIXTRAL_PRICE_SOL,
//           description:
//             `Pixtral completion paywalled at ${PIXTRAL_PRICE_SOL} SOL on Solana devnet.`,
//           payouts: [
//             {
//               address: MERCHANT_SOL_ADDRESS,
//               percent: 100,
//             },
//           ],
//           aiBackend: "pixtral",
//           model: PIXTRAL_MODEL,
//         },
//       ],
//     },
//   });
// });

// // ---------- 3) Protect /ai/pixtral with Solana paywall ----------
// //
// // Uses @zynapse/node -> initSolanaPaywall.
// // Clients/agents must:
// //  - pay PIXTRAL_PRICE_SOL to MERCHANT_SOL_ADDRESS
// //  - include correct X-PAYMENT
// // Our autonomous agent will handle that for users.

// if (MERCHANT_SOL_ADDRESS) {
//   try {
//     // Validate merchant key early to avoid runtime base58 errors.
//     new PublicKey(MERCHANT_SOL_ADDRESS);

//     initSolanaPaywall({
//       app,
//       path: "/ai/pixtral",
//       payTo: MERCHANT_SOL_ADDRESS,
//       priceLamports: PIXTRAL_PRICE_LAMPORTS,
//       rpcUrl: SOLANA_RPC_URL,
//     });
//   } catch (e) {
//     console.error(
//       "[error] MERCHANT_SOL_ADDRESS is not a valid Solana public key:",
//       e?.message || e
//     );
//   }
// } else {
//   console.warn(
//     "[warn] Skipping paywall: MERCHANT_SOL_ADDRESS not set. Set it in .env."
//   );
// }

// // ---------- 4) Pixtral handler (runs AFTER payment is verified) ----------
// //
// // This is executed only if initSolanaPaywall verified a valid on-chain payment.

// app.post("/ai/pixtral", async (req, res) => {
//   const { prompt } = req.body || {};
//   const finalPrompt =
//     prompt || "Explain in one sentence: paid AI via Zynapse on Solana.";

//   try {
//     if (!PIXTRAL_API_KEY) {
//       // Stub if no real Pixtral key set.
//       return res.json({
//         ok: true,
//         paid: true,
//         backend: "pixtral",
//         model: PIXTRAL_MODEL,
//         prompt: finalPrompt,
//         stub: true,
//         message:
//           "[stub] Payment verified. Configure PIXTRAL_API_KEY to call Pixtral for real.",
//       });
//     }

//     const resp = await fetch(
//       "https://api.mistral.ai/v1/chat/completions",
//       {
//         method: "POST",
//         headers: {
//           Authorization: `Bearer ${PIXTRAL_API_KEY}`,
//           "Content-Type": "application/json",
//         },
//         body: JSON.stringify({
//           model: PIXTRAL_MODEL,
//           messages: [
//             {
//               role: "user",
//               content: finalPrompt,
//             },
//           ],
//         }),
//       }
//     );

//     const data = await resp.json();

//     return res.json({
//       ok: true,
//       paid: true,
//       backend: "pixtral",
//       model: PIXTRAL_MODEL,
//       prompt: finalPrompt,
//       pixtral_raw: data,
//     });
//   } catch (e) {
//     console.error("[/ai/pixtral] error", e);
//     return res.status(500).json({
//       ok: false,
//       error: "pixtral_request_failed",
//       detail: String(e),
//     });
//   }
// });

// // ---------- 5) Autonomous test endpoint (uses created agent wallet) ----------
// //
// // Frontend calls this to demonstrate:
// //   - No wallets on client
// //   - Server-side agent wallet pays
// //   - /ai/pixtral returns paid response

// app.post("/test/pixtral", async (req, res) => {
//   const kp = loadAgentKeypairOrNull();
//   if (!kp) {
//     return res.status(400).json({
//       ok: false,
//       error: "no_agent_wallet",
//       message:
//         "Create the agent wallet first via POST /wallet/create (use the button in the UI).",
//     });
//   }

//   const { prompt } = req.body || {};
//   const testPrompt =
//     prompt ||
//     "Very briefly describe how this Pixtral call is paid via an autonomous Solana wallet.";

//   try {
//     // secretKey passed as stored JSON string
//     const secretJson = fs.readFileSync(AGENT_WALLET_FILE, "utf8");

//     const { fetchWithPayment, publicKey } =
//       createSolanaAutonomousFetch({
//         secretKey: secretJson,
//         rpcUrl: SOLANA_RPC_URL,
//       });

//     const targetUrl = `${req.protocol}://${req.get(
//       "host"
//     )}/ai/pixtral`;

//     const resp = await fetchWithPayment(targetUrl, {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ prompt: testPrompt }),
//     });

//     const text = await resp.text();
//     let body;
//     try {
//       body = JSON.parse(text);
//     } catch {
//       body = { raw: text };
//     }

//     if (!resp.ok) {
//       return res.status(500).json({
//         ok: false,
//         error: "autonomous_payment_or_pixtral_failed",
//         status: resp.status,
//         body,
//       });
//     }

//     return res.json({
//       ok: true,
//       note:
//         "Autonomous agent wallet paid the Solana paywall and fetched Pixtral response.",
//       agent_public_key: publicKey,
//       merchant_public_key: MERCHANT_SOL_ADDRESS,
//       price_sol: PIXTRAL_PRICE_SOL,
//       response: body,
//     });
//   } catch (e) {
//     console.error("[/test/pixtral] error", e);
//     return res.status(500).json({
//       ok: false,
//       error: String(e),
//     });
//   }
// });

// // ---------- 6) Static frontend ----------

// app.use(express.static(PUBLIC_DIR));

// // Root -> widget UI
// app.get("/", (req, res) => {
//   res.sendFile(path.join(PUBLIC_DIR, "index.html"));
// });

// // ---------- Start server ----------

// const PORT = process.env.PORT || 4060;
// app.listen(PORT, () => {
//   console.log(
//     `Solana Pixtral Wallet Widget running at http://localhost:${PORT}`
//   );
//   console.log(`- UI:              http://localhost:${PORT}/`);
//   console.log(`- Wallet status:   GET  /wallet/status`);
//   console.log(`- Create wallet:   POST /wallet/create`);
//   console.log(`- Test Pixtral:    POST /test/pixtral`);
// });

// Solana Pixtral Wallet Widget Example (full server.mjs)
//
// Features:
//  1. "Create Wallet" (UI -> POST /wallet/create)
//       - Generates a new Solana devnet Keypair
//       - Saves secret in agent-wallet.json (server-side only; NEVER exposed)
//       - Requests ~1 SOL airdrop on devnet (best-effort)
//       - Returns ONLY publicKey + status
//
//  2. Wallet Status (GET /wallet/status)
//       - Shows if agent wallet exists + balance (public info)
//
//  3. Paid Pixtral AI endpoint (POST /ai/pixtral)
//       - Protected by initSolanaPaywall from @zynapse/node
//       - Requires PIXTRAL_PRICE_SOL (e.g. 0.1 SOL) paid to MERCHANT_SOL_ADDRESS
//
//  4. Autonomous test endpoint (POST /test/pixtral)
//       - Uses the internally stored agent wallet
//       - Ensures sufficient balance (tries airdrop if low)
//       - Calls fetchWithPayment(...) from createSolanaAutonomousFetch
//       - That pays the paywall + calls /ai/pixtral
//       - Returns Pixtral (or stub) response
//
//  5. Widget:
//       - GET / -> public/index.html UI
//       - GET /zynapse/config -> product metadata for the widget
//
// Notes:
//  - Private key is never returned in any API.
//  - If airdrop fails or devnet is flaky, you can manually fund the agent wallet
//    using the public key shown in the responses.

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
  initSolanaPaywall,
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

// ---------- Env ----------

const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

const MERCHANT_SOL_ADDRESS = process.env.MERCHANT_SOL_ADDRESS || ""; // devnet pubkey (receiver)
const PIXTRAL_API_KEY = process.env.PIXTRAL_API_KEY || "";
const PIXTRAL_MODEL = process.env.PIXTRAL_MODEL || "pixtral-12b-2409";
const PIXTRAL_PRICE_SOL = Number(process.env.PIXTRAL_PRICE_SOL || "0.1"); // default 0.1 SOL
const PIXTRAL_PRICE_LAMPORTS = Math.floor(
  PIXTRAL_PRICE_SOL * LAMPORTS_PER_SOL
);

if (!MERCHANT_SOL_ADDRESS) {
  console.warn(
    "[warn] MERCHANT_SOL_ADDRESS missing. Set it in .env (Solana devnet public key)."
  );
}

const connection = new Connection(SOLANA_RPC_URL, "confirmed");

// ---------- Agent wallet helpers ----------

// Load agent Keypair from disk (if exists)
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

// Save agent Keypair to disk (secret kept server-side only)
function saveAgentKeypair(kp) {
  fs.writeFileSync(
    AGENT_WALLET_FILE,
    JSON.stringify(Array.from(kp.secretKey), null, 2)
  );
}

// Best-effort airdrop helper (for devnet)
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
        "Airdrop failed (faucet limit/network issue). You might need to fund this devnet wallet manually.",
    };
  }
}

// ---------- 1) Wallet status & creation endpoints ----------

// GET /wallet/status -> show if agent wallet exists + balance
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
      balanceLamports: balance,
      balanceSol: balance / LAMPORTS_PER_SOL,
      note:
        "This is the autonomous payer wallet. Private key is stored server-side only.",
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

// POST /wallet/create -> create + airdrop (idempotent)
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

  const airdropRes = await airdropSol(kp.publicKey, 1); // 1 SOL is enough for multiple calls

  return res.json({
    ok: true,
    created: true,
    publicKey: kp.publicKey.toBase58(),
    airdrop: airdropRes,
    note:
      "Agent wallet created. Private key is stored internally and never exposed.",
  });
});

// ---------- 2) Widget config endpoint ----------
//
// Frontend reads this to know there is a single Pixtral-Solana paid product.

app.get("/zynapse/config", (req, res) => {
  res.json({
    ok: true,
    config: {
      chains: {
        solana: {
          id: "solana",
          label: "Solana Devnet",
          rpcUrl: SOLANA_RPC_URL,
          merchant: MERCHANT_SOL_ADDRESS || null,
        },
      },
      products: [
        {
          id: "pixtral-sol-basic",
          label: "Pixtral Solana Paid AI",
          chain: "solana",
          method: "POST",
          path: "/ai/pixtral",
          priceSol: PIXTRAL_PRICE_SOL,
          description: `Pixtral completion paywalled at ${PIXTRAL_PRICE_SOL} SOL on Solana devnet.`,
          payouts: MERCHANT_SOL_ADDRESS
            ? [{ address: MERCHANT_SOL_ADDRESS, percent: 100 }]
            : [],
          aiBackend: "pixtral",
          model: PIXTRAL_MODEL,
        },
      ],
    },
  });
});

// ---------- 3) Configure Solana paywall for /ai/pixtral ----------

if (MERCHANT_SOL_ADDRESS) {
  try {
    // Validate merchant key to avoid runtime base58 issues.
    // Throws if invalid.
    // eslint-disable-next-line no-new
    new PublicKey(MERCHANT_SOL_ADDRESS);

    initSolanaPaywall({
      app,
      path: "/ai/pixtral",
      payTo: MERCHANT_SOL_ADDRESS,
      priceLamports: PIXTRAL_PRICE_LAMPORTS,
      rpcUrl: SOLANA_RPC_URL,
    });
  } catch (e) {
    console.error(
      "[error] MERCHANT_SOL_ADDRESS is not a valid Solana public key:",
      e?.message || e
    );
  }
} else {
  console.warn(
    "[warn] Skipping paywall: MERCHANT_SOL_ADDRESS not set. Configure it in .env."
  );
}

// ---------- 4) Pixtral handler (executes AFTER payment is verified) ----------

app.post("/ai/pixtral", async (req, res) => {
  const { prompt } = req.body || {};
  const finalPrompt =
    prompt ||
    "Explain briefly how this Pixtral API call is protected and paid via an autonomous Solana wallet using Zynapse.";

  try {
    if (!PIXTRAL_API_KEY) {
      // Stub when no real Pixtral key is configured
      return res.json({
        ok: true,
        paid: true,
        backend: "pixtral",
        model: PIXTRAL_MODEL,
        prompt: finalPrompt,
        stub: true,
        message:
          "[stub] Payment verified. Set PIXTRAL_API_KEY in .env to hit Pixtral for real.",
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
          model: PIXTRAL_MODEL,
          messages: [{ role: "user", content: finalPrompt }],
        }),
      }
    );

    const data = await resp.json();

    return res.json({
      ok: true,
      paid: true,
      backend: "pixtral",
      model: PIXTRAL_MODEL,
      prompt: finalPrompt,
      pixtral_raw: data,
    });
  } catch (e) {
    console.error("[/ai/pixtral] error", e);
    return res.status(500).json({
      ok: false,
      error: "pixtral_request_failed",
      detail: String(e),
    });
  }
});

// ---------- 5) Autonomous test endpoint using agent wallet ----------
//
// Frontend calls this.
// It ensures balance, then uses createSolanaAutonomousFetch()
// to:
//   - pay the /ai/pixtral paywall
//   - retrieve the Pixtral response

app.post("/test/pixtral", async (req, res) => {
  const kp = loadAgentKeypairOrNull();
  if (!kp) {
    return res.status(400).json({
      ok: false,
      error: "no_agent_wallet",
      message:
        "Create the agent wallet first via /wallet/create (use the button in the UI).",
    });
  }

  const { prompt } = req.body || {};
  const testPrompt =
    prompt ||
    "Very briefly describe how this Pixtral call is autonomously paid via a Solana devnet wallet.";

  try {
    // 1) Ensure sufficient balance (price + small fee buffer)
    const minNeeded =
      PIXTRAL_PRICE_LAMPORTS + Math.floor(0.01 * LAMPORTS_PER_SOL); // +0.01 SOL buffer
    let balance = await connection.getBalance(kp.publicKey);

    if (balance < minNeeded) {
      const topup = await airdropSol(kp.publicKey, 1); // try +1 SOL
      balance = await connection.getBalance(kp.publicKey);

      if (balance < PIXTRAL_PRICE_LAMPORTS) {
        return res.status(400).json({
          ok: false,
          error: "insufficient_funds",
          message:
            "Agent wallet has insufficient SOL and faucet top-up failed. Please fund the devnet wallet manually.",
          agent_public_key: kp.publicKey.toBase58(),
          balanceSol: balance / LAMPORTS_PER_SOL,
          faucet: topup,
        });
      }
    }

    // 2) Use Zynapse SDK to perform paid request
    const secretJson = fs.readFileSync(AGENT_WALLET_FILE, "utf8");

    const { fetchWithPayment, publicKey } =
      createSolanaAutonomousFetch({
        secretKey: secretJson,
        rpcUrl: SOLANA_RPC_URL,
      });

    const targetUrl = `${req.protocol}://${req.get(
      "host"
    )}/ai/pixtral`;

    let resp;
    try {
      resp = await fetchWithPayment(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: testPrompt }),
      });
    } catch (e) {
      // e.g. SendTransactionError, RPC issues, etc.
      return res.status(500).json({
        ok: false,
        error: "send_transaction_failed",
        detail: String(e?.message || e),
        hint:
          "Usually means the agent wallet has low/no SOL or RPC issues. Check /wallet/status and fund if needed.",
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
        error: "autonomous_payment_or_pixtral_failed",
        status: resp.status,
        body,
      });
    }

    const newBalance =
      (await connection.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL;

    return res.json({
      ok: true,
      note:
        "Autonomous agent wallet paid the Solana paywall and fetched Pixtral response.",
      agent_public_key: publicKey,
      merchant_public_key: MERCHANT_SOL_ADDRESS,
      price_sol: PIXTRAL_PRICE_SOL,
      balance_after_sol: newBalance,
      response: body,
    });
  } catch (e) {
    console.error("[/test/pixtral] error", e);
    return res.status(500).json({
      ok: false,
      error: String(e),
    });
  }
});

// ---------- 6) Static frontend ----------

app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// ---------- Start ----------

const PORT = process.env.PORT || 4060;
app.listen(PORT, () => {
  console.log(
    `Solana Pixtral Wallet Widget running at http://localhost:${PORT}`
  );
  console.log(`- UI:              http://localhost:${PORT}/`);
  console.log(`- Wallet status:   GET  /wallet/status`);
  console.log(`- Create wallet:   POST /wallet/create`);
  console.log(`- Test Pixtral:    POST /test/pixtral`);
});
