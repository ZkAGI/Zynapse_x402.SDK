## Zynapse_x402 SDK

**Add blockchain micropayments to any API in 10 lines of code.** 

The Zynapse Payment SDK makes it quick and easy to build an excellent payment experience for your API-based and usage-based digital products. We provide powerful integration tools that handle Solana micropayments, with plans for advanced features like multi-party payment splitting, privacy-preserving transactions, and multi-coin acceptance.

> **Charge per API call on chain of your choice with automatic multi-party revenue splitting.**

-----

## What is Zynapse\_x402.SDK?

This SDK enables x402 micropayments for APIs. Protect any endpoint with on-chain payments that automatically split across multiple wallets.

**Use Cases:**

  * API monetization (AI, data, compute)
  * Usage-based billing ($0.001 - $10 per call)
  * Autonomous agent payments (bots paying bots)
  * Multi-stakeholder revenue splits (creator/referrer/platform/DAO)

**Key Features:**

  * ✅ x402 protocol (HTTP 402 Payment Required)
  * ✅ Automatic payment splitting across wallets
  * ✅ TEE-secured payment verification
  * ✅ Autonomous payment agents
  * ✅ Multi-chain (Solana, Base, Ethereum soon)

-----

## Architecture

<div align="center">
  <img width="424" height="424" alt="Endpoints" src="https://github.com/user-attachments/assets/2ff721c7-06c9-4a24-9b3f-ebcc200bed48" />
  <p><strong>SDK Architecture</strong></p>
</div>

<div align="center">
  <img width="424" height="424" alt="402 Payment Flow" src="https://github.com/user-attachments/assets/227d121f-b3db-4d08-acb5-b73319d7a445" />
  <p><strong>402 Protocol Flow</strong></p>
</div>

## Quick Start

**Install:**

```bash
pnpm install @zynapse/node @solana/web3.js dotenv
```

**Setup (5 minutes):**
Create **.env**:

```env
MERCHANT_SOL_ADDRESS=your_solana_pubkey
SOLANA_RPC_URL=https://api.devnet.solana.com
```

Create **server.js**:

```javascript
import express from 'express';
import { initSolanaPaywall } from '@zynapse/node';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

const app = express();
app.use(express.json());

// Protect your endpoint
initSolanaPaywall({
  app,
  path: '/api/inference',
  payTo: process.env.MERCHANT_SOL_ADDRESS,
  priceLamports: Math.floor(0.01 * LAMPORTS_PER_SOL), // 0.01 SOL
  rpcUrl: process.env.SOLANA_RPC_URL,
});

// Your API logic (runs after payment verified)
app.post('/api/inference', async (req, res) => {
  const result = await yourLogic(req.body);
  res.json({ ok: true, result });
});

app.listen(4060, () => console.log('✅ Paid API running'));
```

**Run:**

```bash
node server.js
```

**Test:**

```bash
curl -X POST http://localhost:4060/api/inference \
  -d '{"input": "test"}' \
  -H "Content-Type: application/json"
```

**Response: 402 Payment Required**
🎉 **Done\!** Your API now requires payment.

-----

## Payment Splitting

Automatically split revenue across multiple wallets:

```javascript
initSolanaPaywall({
  app,
  path: '/api/inference',
  payTo: ESCROW_ADDRESS,
  priceLamports: Math.floor(0.01 * LAMPORTS_PER_SOL),
  rpcUrl: SOLANA_RPC_URL,
  splits: [
    { address: CREATOR_WALLET, percent: 60 },   // Creator
    { address: REFERRER_WALLET, percent: 20 },  // Affiliate
    { address: PLATFORM_WALLET, percent: 10 },  // Platform fee
    { address: LIQUIDITY_POOL, percent: 10 }    // Token buyback
  ]
});
```

**Use Cases:**

  * Affiliate commissions
  * Platform fees
  * DAO funding
  * Token buyback mechanisms

-----

## Documentation

📚 **[Integration Guide](https://www.google.com/search?q=./INTEGRATION_GUIDE.md)** 

🎯 **[Examples](https://www.google.com/search?q=./examples/)**

-----

## How It Works

1.  Client → POST /api/endpoint
2.  Server → 402 Payment Required (if no payment)
3.  Client → Pay on Solana/Base blockchain
4.  Client → Retry with payment proof header
5.  Server → Verify on-chain & execute
6.  (Optional) Split payment across wallets

-----

## Supported Networks

| Network | Status | Use Case |
|---------|--------|----------|
| Solana Devnet | ✅ Live | Testing |
| Solana Mainnet | 🚧 Q4 2025 | Production |
| Base Sepolia | ✅ Live | Testing |
| Base Mainnet | 🚧 Q4 2025 | Production |
| Ethereum | 🚧 Q1 2026 | Production |

-----

## Examples

**AI Inference:**

```javascript
initSolanaPaywall({
  app,
  path: '/api/inference',
  payTo: MERCHANT_WALLET,
  priceLamports: Math.floor(0.01 * LAMPORTS_PER_SOL),
  rpcUrl: SOLANA_RPC_URL,
});

app.post('/api/inference', async (req, res) => {
  const result = await callAIModel(req.body.prompt);
  res.json({ ok: true, result });
});
```

**Autonomous Agent:**

```javascript
import { createSolanaAutonomousFetch } from '@zynapse/node';

const { fetchWithPayment } = createSolanaAutonomousFetch({
  secretKey: process.env.AGENT_WALLET_SECRET,
  rpcUrl: SOLANA_RPC_URL
});

// Agent automatically handles payment
const response = await fetchWithPayment('https://api.example.com/paid');
```

See **[examples/](https://www.google.com/search?q=./examples/)** for complete working code.

-----

## Roadmap

**Current**

  * ✅ TEE‑first key lifecycle (generate, seal, sign in‑enclave)
  * ✅ Paywalls (402/x402) for API endpoints
  * ✅ Single‑destination settlement → one primary vault/wallet
  * ✅ Any‑asset → preferred asset (limited) via facilitator; settle SOL/USDC
  * ✅ Examples: Solana devnet paywall; Base‑Sepolia x402 + Pixtral demo
  * ✅ Splits + Scheduler: Multi-recipient revenue splits with hourly/daily/threshold payouts, all enforced inside the TEE.

**Future Scope**

  * Develop client side widgit and dashboard to make it easier for users to integrate and maange
  * Adding template and examples to make onboarding easier for enterprises

-----

## Requirements

  * Node.js 23+
  * Express.js 4.x+
  * Solana wallet for receiving payments

-----

## Support

  * **Email:** support@zkagi.ai
  * **Docs:** [https://docs.zkagi.ai](https://docs.zkagi.ai)

-----

## License

Apache 2.0

