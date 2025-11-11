# Zynapse SDK

> **Add blockchain micropayments to any API in ~10 lines of code.**

The **Zynapse SDK** makes it quick and easy to add on-chain, per-request payments to any HTTP API.
It is built around the **x402 pattern** (HTTP 402 Payment Required), supports **Solana** and **EVM (via x402)**, and is designed to be:

* reusable
* declarative
* agent-friendly (autonomous payments)
* ready for multi-party revenue splitting.

This README also documents the **reusable pattern** implemented in the `zynapse-multichain` example so teams can:

* define paid API products from a UI
* wire paywalls + handlers automatically
* plug in custom business logic (Pixtral, your own APIs, etc.)

---

## Reusable Pattern Overview (Core Idea)

The core abstraction is a **Product**:

```ts
{
  id: string;                             // unique handle
  label: string;                          // human-readable name
  chain: "evm" | "solana";                // which network/paywall engine
  method: "GET" | "POST";                 // HTTP method
  path: string;                           // e.g. "/ai/pixtral-sol-1"
  price?: string;                         // for EVM, like "$0.10"
  priceSol?: number;                      // for Solana, in SOL
  payouts?: { address: string; percent: number }[]; // optional multi-recipient split
  aiBackend?: "pixtral" | "hello" | string; // which backend logic to run
  model?: string;                         // e.g. "pixtral-12b-2409" (if AI)
  description?: string;                   // docs for UIs
}
```

For each product, the Zynapse server does two things:

1. **Register a paywall** for `(method, path)`

   * EVM: via x402 (e.g. Base Sepolia) using a facilitator.
   * Solana: via on-chain verification (`initSolanaPaywall`) or split-paywall wrapper.
2. **Register a handler** behind the paywall

   * For `aiBackend: "pixtral"`: call Pixtral/Mistral-style chat API.
   * For `aiBackend: "hello"` (or your own): run any custom code you define.

This pattern is implemented in `examples/zynapse-multichain/src/server.mjs` and can be reused as:

> **Product in → Paid endpoint out**, without duplicating paywall code each time.

---

## Zynapse_x402.SDK (Concept)

This SDK enables x402 micropayments for APIs. Protect any endpoint with on-chain payments that can split across multiple wallets.

**Use Cases:**

* API monetization (AI, data, compute)
* Usage-based billing ($0.001 - $10 per call)
* Autonomous agent payments (bots paying bots)
* Multi-stakeholder revenue splits (creator/referrer/platform/DAO)

**Key Features:**

* ✅ x402 protocol (HTTP 402 Payment Required)
* ✅ Automatic payment splitting across wallets
* ✅ TEE-secured payment verification (roadmap / infra dependent)
* ✅ Autonomous payment agents
* ✅ Multi-chain (Solana, Base; Ethereum soon)

---

## Quick Start (Direct SDK)

If you just want to protect a single endpoint (no UI, no products yet):

**Install:**

```bash
npm install @zynapse/node @solana/web3.js dotenv
```

**.env:**

```env
MERCHANT_SOL_ADDRESS=your_solana_pubkey
SOLANA_RPC_URL=https://api.devnet.solana.com
```

**server.js:**

```js
import express from 'express';
import { initSolanaPaywall } from '@zynapse/node';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

const app = express();
app.use(express.json());

initSolanaPaywall({
  app,
  path: '/api/inference',
  payTo: process.env.MERCHANT_SOL_ADDRESS,
  priceLamports: Math.floor(0.01 * LAMPORTS_PER_SOL), // 0.01 SOL
  rpcUrl: process.env.SOLANA_RPC_URL,
});

app.post('/api/inference', async (req, res) => {
  const result = await yourLogic(req.body);
  res.json({ ok: true, result });
});

app.listen(4060, () => console.log('✅ Paid API running'));
```

Run:

```bash
node server.js
```

First call (without payment) returns `402 Payment Required`. Clients/agents then pay and retry.

---

## Zynapse Multichain Example (Recommended Pattern)

Directory:

```text
examples/zynapse-multichain/
  src/server.mjs         # reusable backend
  public/admin.html      # admin widget (define products)
  public/solana-pixtral-chat.html  # client widget (chat-style consumer)
```

### 1. Setup

```bash
pnpm install
pnpm --filter @zynapse/node build
pnpm --filter zynapse-multichain dev
```

In `examples/zynapse-multichain/.env`:

```env
# EVM / x402
EVM_NETWORK=base-sepolia
EVM_FACILITATOR_URL=https://x402.org/facilitator
EVM_MERCHANT_ADDRESS=0xYourEvmMerchantOnBaseSepolia
EVM_PAYER_PRIVATE_KEY=0xYourEvmPayerPrivateKeyWithFunds

# Solana\ nSOLANA_RPC_URL=https://api.devnet.solana.com
SOL_MERCHANT_MAIN=YourSolMerchantDevnetPubkey

# Pixtral / Mistral
PIXTRAL_API_KEY=your_mistral_or_pixtral_api_key_here
PIXTRAL_MODEL=pixtral-12b-2409

# Defaults
DEFAULT_PIXTRAL_PRICE_USD=0.10
DEFAULT_PIXTRAL_PRICE_SOL=0.1
```

Then open:

* Admin: `http://localhost:4040/admin`
* Solana Pixtral chat: `http://localhost:4040/chat/solana-pixtral`
* Config JSON: `http://localhost:4040/zynapse/config`

### 2. Flow

1. **Define products** in `/admin` (no code changes):

   * Choose chain, path, price, payouts, backend (`aiBackend`), model.
2. **server.mjs** wires:

   * appropriate paywall (`initPaidRoutes` for EVM / `initSolanaPaywall` or split-paywall for Solana), and
   * the corresponding handler (Pixtral or custom).
3. **Clients** (widgets, agents, or your apps) discover products via `/zynapse/config` and call:

   * `POST /test/evm?productId=...` or
   * `POST /test/sol?productId=...`
     which use autonomous wallets to pay + call your paid endpoints.

This pattern keeps your paywall logic centralized and your product logic declarative.

---

## Example: Creating a Pixtral Product (UI)

In **Admin UI** (`/admin`), create a Solana Pixtral product:

* ID: `pixtral-sol-1`
* Label: `Pixtral Solana Paid AI`
* Chain: `Solana`
* Method: `POST`
* Path: `/ai/pixtral-sol-1`
* Price: `0.1` (SOL)
* Payouts: `YourSolMerchantDevnetPubkey:100`
* Pixtral Model: `pixtral-12b-2409`

Click **Create & Wire**.

The backend now:

* protects `POST /ai/pixtral-sol-1` with a Solana paywall,
* runs a Pixtral completion handler after payment,
* exposes this product via `/zynapse/config`,
* allows `POST /test/sol?productId=pixtral-sol-1` to:

  * use an autonomous Solana wallet,
  * pay the fee,
  * execute the Pixtral call.

On `http://localhost:4040/chat/solana-pixtral`, the widget automatically:

* loads `/zynapse/config`,
* finds the Solana+Pixtral product,
* lets you **Create Agent Wallet** (`/wallet/create`),
* sends prompts via `/test/sol?productId=...` as a paid chat.

---

## Example: Make Your Own Paid API ("/hello")

You want:

> `GET /hello` → returns `"Learn how to use x402"` **only after payment**.

### Step 1: Create product via Admin API

```bash
curl -X POST http://localhost:4040/zynapse/admin/product \
  -H "Content-Type: application/json" \
  -d '{
    "id": "hello-x402-evm",
    "label": "Hello x402 Paid Guide",
    "chain": "evm",
    "method": "GET",
    "path": "/hello",
    "price": "$0.05",
    "payouts": [
      { "address": "0xYourEvmMerchantOnBaseSepolia", "percent": 100 }
    ],
    "aiBackend": "hello"
  }'
```

This tells Zynapse:

* protect `GET /hello` on EVM with `$0.05` x402 paywall,
* when paid, run the `hello` backend.

### Step 2: Implement reusable handler routing

In `server.mjs`, instead of only `registerPixtralHandler`, use a generic router, e.g.:

```js
function registerHandlerForProduct(product) {
  const method = (product.method || 'POST').toLowerCase();
  const routePath = product.path;
  if (!routePath) return;

  // Avoid duplicate binding
  if (app._router?.stack?.some(
    (l) => l.route && l.route.path === routePath && l.route.methods[method]
  )) return;

  if (product.aiBackend === 'hello') {
    app[method](routePath, (req, res) => {
      res.json({
        ok: true,
        paid: true,
        message: 'Learn how to use x402',
      });
    });
    return;
  }

  if (product.aiBackend === 'pixtral') {
    // existing Pixtral handler here (call Pixtral and return)
  }

  // Fallback: simple stub
  app[method](routePath, (req, res) => {
    res.json({ ok: true, paid: true, message: `Paid endpoint for ${product.id}` });
  });
}
```

And when creating products in `/zynapse/admin/product`, call:

```js
registerPaywallForProduct(product);
registerHandlerForProduct(product);
products.push(product);
```

You now have a **reusable format**:

* Any new paid endpoint = one JSON product + one `aiBackend` case.
* No need to touch paywall wiring each time.

### Step 3: Test with curl

Using the built-in autonomous test route (no manual signing):

```bash
curl -X POST "http://localhost:4040/test/evm?productId=hello-x402-evm"
```

This uses `EVM_PAYER_PRIVATE_KEY` to:

* pay the x402 challenge,
* call `/hello`,
* return the paid response.

In a real client, you would:

1. Call `/hello` → receive 402 + payment instructions.
2. Pay on-chain.
3. Retry `/hello` with `X-PAYMENT` header.
4. Or use `createAutonomousFetch` from `@zynapse/node` to automate 2–3.

---

## Payment Splitting (Pattern)

The SDK and examples support multi-recipient logic.
A typical Solana pattern:

```js
initSolanaPaywall({
  app,
  path: '/api/inference',
  payTo: ESCROW_ADDRESS,
  priceLamports: Math.floor(0.01 * LAMPORTS_PER_SOL),
  rpcUrl: SOLANA_RPC_URL,
  // your splitter (on-chain program or TEE-based)
});
```

The `zynapse-multichain` example also includes a demo `initSolanaSplitPaywall` to show how you could:

* accept one payment,
* verify it covers all recipients,
* enforce per-recipient minimums.

Use cases:

* Affiliate / referrer cuts
* Platform fees
* DAO / community treasury
* Token buyback / liquidity sinks

---

## How It Works (x402 Flow)

```text
1. Client → request /api/endpoint
2. Server → 402 Payment Required (with how-to-pay details)
3. Client / agent → pays on Solana/Base/etc.
4. Client / agent → retries with X-PAYMENT (proof / tx)
5. Server → verifies on-chain + executes
6. (Optional) Split / route funds to multiple wallets
```

The Zynapse SDK + helpers (`createAutonomousFetch`, `createSolanaAutonomousFetch`) handle steps 2–5 for autonomous flows.

---

## Supported Networks

| Network        | Status     | Use Case   |
| -------------- | ---------- | ---------- |
| Solana Devnet  | ✅ Live     | Testing    |
| Solana Mainnet | 🚧 Q4 2025 | Production |
| Base Sepolia   | ✅ Live     | Testing    |
| Base Mainnet   | 🚧 Q4 2025 | Production |
| Ethereum       | 🚧 Q1 2026 | Production |

*(Timeline indicative; adapt to your actual roadmap.)*

---

## Autonomous Agents

Examples (see `zynapse-multichain`):

```js
import { createSolanaAutonomousFetch } from '@zynapse/node';

const { fetchWithPayment } = createSolanaAutonomousFetch({
  secretKey: process.env.AGENT_WALLET_SECRET_JSON,
  rpcUrl: process.env.SOLANA_RPC_URL,
});

// Agent auto-pays and retries according to x402 responses
const res = await fetchWithPayment('https://your.api/paid');
```

Same pattern exists for x402/EVM via `createAutonomousFetch`.

---

## Requirements

* Node.js 16+
* Express.js 4+
* Solana / EVM wallets with testnet funds (for relevant networks)

---

## Docs & Examples

* `examples/zynapse-multichain/` – full reusable backend + widgets.
* (Extend with more examples as SDK evolves.)

For deeper integration details, deployment patterns, and TEE-backed verification, refer to your internal or public docs.

---

## Support

* Email: [support@zkagi.ai](mailto:support@zkagi.ai)
* Docs: [https://docs.zkagi.ai](https://docs.zkagi.ai) (or your canonical docs URL)

---

## License

Apache 2.0

