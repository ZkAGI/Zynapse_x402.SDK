// import { paymentMiddleware } from "x402-express";
// import { wrapFetchWithPayment } from "x402-fetch";
// import { createWalletClient, http } from "viem";
// import { privateKeyToAccount } from "viem/accounts";
// import { baseSepolia } from "viem/chains";
// import fetch from "node-fetch";

// type RoutesConfig = {
//   [route: string]: {
//     price: string;              // "$0.01"
//     network: string;            // "base-sepolia"
//     config?: Record<string, any>;
//   };
// };

// export function initPaidRoutes(
//   app: any,
//   {
//     payTo,
//     routes,
//     facilitatorUrl = "https://x402.org/facilitator",
//   }: {
//     payTo: string;
//     routes: RoutesConfig;
//     facilitatorUrl?: string;
//   }
// ) {
//   app.use(
//     paymentMiddleware(
//       payTo,
//       routes,
//       { url: facilitatorUrl }
//     )
//   );
// }

// /**
//  * Create an autonomous fetch wrapper that:
//  *  - uses viem wallet client with the given private key
//  *  - uses x402-fetch to auto-handle 402 + x402 payments
//  */
// export function createAutonomousFetch({
//   privateKey,
//   chain = baseSepolia,
// }: {
//   privateKey: `0x${string}`;
//   chain?: any;
// }) {
//   const account = privateKeyToAccount(privateKey);
//   const client = createWalletClient({
//     account,
//     chain,
//     transport: http(),
//   });

//   // x402-fetch extends fetch with payment handling
//   const fetchWithPayment = wrapFetchWithPayment(fetch as any, client);

//   return {
//     fetchWithPayment,
//     account,
//   };
// }

import { paymentMiddleware } from "x402-express";
import { wrapFetchWithPayment } from "x402-fetch";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fetch, { RequestInit, Response as FetchResponse } from "node-fetch";

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";

// ========== Types ==========

export type RoutesConfig = {
  [route: string]: {
    price: string; // e.g. "$0.01"
    network: string; // e.g. "base-sepolia"
    config?: Record<string, any>;
  };
};

export interface InitPaidRoutesOpts {
  payTo: string;
  routes: RoutesConfig;
  facilitatorUrl?: string;
}

export interface EvmAutonomousOpts {
  privateKey: `0x${string}`;
  chain?: any;
}

export interface SolanaPaywallConfig {
  app: any; // Express app or compatible
  path: string; // e.g. "/sol-paid"
  payTo: string; // Solana pubkey (base58)
  priceLamports: number; // required lamports
  rpcUrl?: string;
}

export interface SolanaAutonomousOpts {
  secretKey: string | number[]; // base58, JSON array string, or number[]
  rpcUrl?: string;
}

// ========== EVM / x402 server helper ==========

/**
 * Attach x402 paywalls to routes using x402-express.
 * Use for EVM-style networks supported by the x402 facilitator.
 */
export function initPaidRoutes(
  app: any,
  { payTo, routes, facilitatorUrl = "https://x402.org/facilitator" }: InitPaidRoutesOpts
): void {
  app.use(
    paymentMiddleware(payTo, routes, {
      url: facilitatorUrl,
    })
  );
}

// ========== EVM autonomous client (x402) ==========

/**
 * EVM: Autonomous fetch wrapper:
 *  - Uses viem wallet client with the given private key.
 *  - Uses x402-fetch to auto-handle 402 + x402 payments.
 */
export function createAutonomousFetch({
  privateKey,
  chain = baseSepolia,
}: EvmAutonomousOpts) {
  const account = privateKeyToAccount(privateKey);

  const client = createWalletClient({
    account,
    chain,
    transport: http(),
  });

  const fetchWithPayment = wrapFetchWithPayment(fetch as any, client);

  return {
    fetchWithPayment,
    account,
  };
}

// ========== Internal: Solana key handling ==========

function toSolanaKeypair(secretKey: string | number[]): Keypair {
  if (Array.isArray(secretKey)) {
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }

  const trimmed = secretKey.trim();

  // JSON array string (Solana keypair file)
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const arr = JSON.parse(trimmed);
    if (!Array.isArray(arr)) {
      throw new Error("Solana secretKey JSON must be an array");
    }
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }

  // base58 secret key
  try {
    const decoded = bs58.decode(trimmed);
    return Keypair.fromSecretKey(decoded);
  } catch (err: any) {
    throw new Error(
      `Invalid Solana secretKey format. ` +
        `Provide base58 or JSON array. Inner error: ${err?.message || err}`
    );
  }
}

// ========== Solana server helper: initSolanaPaywall ==========

/**
 * Solana: Attach a simple on-chain-verified paywall to one path.
 *
 * Protocol:
 *  - If no X-PAYMENT:
 *      -> 402 JSON with `how_to_pay` instructions.
 *  - If X-PAYMENT:
 *      X-PAYMENT = base64({"txSig":"...", "amountLamports":N})
 *      We verify on devnet:
 *        - tx exists
 *        - transfer to `payTo`
 *        - amount >= priceLamports
 *      If ok -> call next handler.
 *
 * This is self-contained and does NOT depend on any x402-solana package.
 */
export function initSolanaPaywall({
  app,
  path,
  payTo,
  priceLamports,
  rpcUrl = "https://api.devnet.solana.com",
}: SolanaPaywallConfig): void {
  const connection = new Connection(rpcUrl, "confirmed");
  const payee = new PublicKey(payTo);

  app.use(path, async (req: any, res: any, next: any) => {
    const header = req.headers["x-payment"];

    if (!header || Array.isArray(header)) {
      return res.status(402).json({
        ok: false,
        error: "payment_required",
        how_to_pay: {
          network: "solana-devnet",
          to: payTo,
          min_lamports: priceLamports,
          header_format:
            'X-PAYMENT: base64({"txSig":"<signature>", "amountLamports":<lamports>})',
        },
      });
    }

    let payload: any;
    try {
      const raw = Buffer.from(String(header), "base64").toString("utf8");
      payload = JSON.parse(raw);
    } catch {
      return res
        .status(400)
        .json({ ok: false, error: "invalid_x_payment_encoding" });
    }

    const { txSig, amountLamports } = payload || {};
    if (!txSig || typeof amountLamports !== "number") {
      return res
        .status(400)
        .json({ ok: false, error: "missing_txSig_or_amount" });
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

      // Handle both legacy & v0 messages
      const msg: any = tx.transaction.message as any;
      let accounts: string[] = [];

      if (Array.isArray(msg.accountKeys)) {
        // Legacy: accountKeys: PublicKey[]
        accounts = msg.accountKeys.map((k: any) =>
          typeof k?.toBase58 === "function" ? k.toBase58() : String(k)
        );
      } else if (typeof msg.getAccountKeys === "function") {
        // Versioned: use getAccountKeys()
        const keys = msg.getAccountKeys();
        const all = [
          ...(keys.staticAccountKeys || []),
          ...(keys.accountKeys || []),
        ];
        accounts = all.map((k: any) =>
          typeof k?.toBase58 === "function" ? k.toBase58() : String(k)
        );
      } else {
        return res.status(402).json({
          ok: false,
          error: "unable_to_read_accounts",
        });
      }

      const payeeBase58 = payee.toBase58();
      const payeeIndex = accounts.indexOf(payeeBase58);

      if (payeeIndex === -1) {
        return res.status(402).json({
          ok: false,
          error: "no_transfer_to_payee",
        });
      }

      const pre =
        (tx.meta?.preBalances && tx.meta.preBalances[payeeIndex]) ?? 0;
      const post =
        (tx.meta?.postBalances && tx.meta.postBalances[payeeIndex]) ?? 0;
      const delta = post - pre;

      if (delta < priceLamports) {
        return res.status(402).json({
          ok: false,
          error: "insufficient_amount",
          required: priceLamports,
          got: delta,
        });
      }

      // Payment verified ✅
      return next();
    } catch (e: any) {
      console.error("[initSolanaPaywall] verify error", e);
      return res.status(500).json({
        ok: false,
        error: "verification_error",
        detail: String(e?.message || e),
      });
    }
  });
}

// ========== Solana autonomous client ==========

/**
 * Solana: Autonomous fetch for the above manual paywall.
 *
 * Flow:
 *  - Call URL.
 *  - If 402 + `how_to_pay` for solana-devnet:
 *      - send tx from provided keypair to `how.to`
 *      - build X-PAYMENT = base64({txSig, amountLamports})
 *      - retry with that header.
 */
export function createSolanaAutonomousFetch({
  secretKey,
  rpcUrl = "https://api.devnet.solana.com",
}: SolanaAutonomousOpts) {
  const keypair = toSolanaKeypair(secretKey);
  const connection = new Connection(rpcUrl, "confirmed");

  async function fetchWithPayment(
    url: string,
    init: RequestInit = {}
  ): Promise<FetchResponse> {
    // 1) Initial attempt
    const first = await fetch(url, init);

    if (first.status !== 402) {
      return first;
    }

    let body: any;
    try {
      body = await first.json();
    } catch {
      return first;
    }

    const how = body?.how_to_pay;
    if (
      !how ||
      !how.to ||
      typeof how.min_lamports !== "number" ||
      typeof how.network !== "string" ||
      !how.network.includes("solana")
    ) {
      return first;
    }

    const payee = new PublicKey(how.to);
    const amountLamports = how.min_lamports as number;

    // 2) Send tx
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: payee,
        lamports: amountLamports,
      })
    );

    const txSig = await sendAndConfirmTransaction(connection, tx, [keypair]);

    // 3) Build X-PAYMENT header (base64 JSON)
    const payload = {
      txSig,
      amountLamports,
    };

    const xPayment = Buffer.from(
      JSON.stringify(payload),
      "utf8"
    ).toString("base64");

    const headers: any = {
      ...(init.headers || {}),
      "X-PAYMENT": xPayment,
    };

    // 4) Retry with proof
    const second = await fetch(url, {
      ...init,
      headers,
    });

    return second;
  }

  return {
    fetchWithPayment,
    publicKey: keypair.publicKey.toBase58(),
  };
}


