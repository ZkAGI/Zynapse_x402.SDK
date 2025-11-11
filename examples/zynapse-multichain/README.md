# Zynapse Multichain Example

A reference implementation of *Zynapse SDK + x402* for building *paid AI APIs* across *EVM (Base Sepolia)* and *Solana devnet*, with:

* A reusable backend (server.mjs) that wires:

  * on-chain paywalls (EVM via x402, Solana via custom/SDK paywalls), and
  * backend handlers (Pixtral / Mistral-style models, or your own APIs).
* An *Admin widget* (/admin) to define products (paid endpoints) without touching code.
* A *Solana Pixtral Chat widget* (/chat/solana-pixtral) that consumes those products using an autonomous payer wallet.
* Clean patterns you can reuse to make *any* HTTP endpoint paid with minimal, declarative config.

---

### 1. Getting Started


#### Install & Build

From repo root (where your workspace is configured):
```
bash
pnpm install
pnpm --filter @zynapse/node build
pnpm --filter zynapse-multichain dev
```

This runs examples/zynapse-multichain/src/server.mjs on port 4040 by default.

#### Configure .env

In examples/zynapse-multichain/.env:

```
env
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

> *Tip*: For local dev, you can leave PIXTRAL_API_KEY empty to use stubbed responses after successful payment.

---

## 2. What This Example Implements

### Core Idea

A *Product* is a declarative description of a paid endpoint:

ts
{
  id: string;
  label: string;
  chain: "evm" | "solana";
  method: "GET" | "POST";
  path: string;               // e.g. "/ai/pixtral-sol-1"
  price?: string;             // for EVM, like "$0.10"
  priceSol?: number;          // for Solana, in SOL
  payouts?: { address: string; percent: number }[]; // optional split
  aiBackend: "pixtral" | "your-backend";
  model?: string;             // e.g. "pixtral-12b-2409"
  description?: string;
}


Given a product, server.mjs does two things:

1. *Registers a paywall* for method path:

   * EVM: via initPaidRoutes (x402 + facilitator)
   * Solana: via initSolanaPaywall (single payout) or initSolanaSplitPaywall (demo splitter)
2. *Registers a handler* behind the paywall:

   * For Pixtral products: calls the Pixtral/Mistral API and returns the response.
   * For your own products: you plug in your own backend logic in the same pattern.

Additionally:

* All products are exposed via GET /zynapse/config.
* Test endpoints:

  * POST /test/evm?productId=...: uses EVM_PAYER_PRIVATE_KEY + x402 to pay and call the product.
  * POST /test/sol?productId=...: uses an internally stored Solana agent wallet to pay and call the product.
* Solana agent wallet:

  * GET /wallet/status
  * POST /wallet/create

---

## 3. Admin Widget: Defining Pixtral Products

Open:

```
http://localhost:4040/admin
```

Here you can define products without editing code.

### Example: Solana Pixtral Product

Fill the form as:

* *ID*: pixtral-sol-1
* *Label*: Pixtral Solana Paid AI
* *Chain*: Solana
* *HTTP Method*: POST
* *Path*: /ai/pixtral-sol-1
* *Description*: Pixtral completion paywalled on Solana devnet
* *Price*: 0.1  (this means 0.1 SOL)
* *Payouts*: YourSolMerchantDevnetPubkey:100
* *Pixtral Model*: pixtral-12b-2409 (optional)

Click *Create & Wire*.

The backend will:

1. Store this product in memory.
2. Wire a Solana paywall for POST /ai/pixtral-sol-1.
3. Register a Pixtral handler behind that paywall.
4. Update /zynapse/config so other UIs can discover it.
5. Allow POST /test/sol?productId=pixtral-sol-1 to exercise it via the agent wallet.

### Example: EVM Pixtral Product

* *ID*: pixtral-evm-1
* *Chain*: EVM (x402)
* *Path*: /ai/pixtral-evm-1
* *Price*: $0.10
* *Payouts*: 0xYourEvmMerchantOnBaseSepolia:100

This uses initPaidRoutes to apply an x402 paywall, then the Pixtral handler.

You can immediately test via the *"Test via backend agent"* button on the card, which calls /test/evm or /test/sol as appropriate.

---

## 4. Solana Pixtral Wallet Widget (Chat-style Client)

Open:

```
http://localhost:4040/chat/solana-pixtral
```

This UI:

1. Reads /zynapse/config, finds the first chain=solana & aiBackend=pixtral product.
2. Lets you *Create Agent Wallet* via POST /wallet/create:

   * Server generates a Solana devnet keypair.
   * Private key saved to agent-wallet.json (server only).
   * Tries airdrop; or you can fund manually.
3. Lets you send prompts:

   * Calls POST /test/sol?productId=<your-product-id>.
   * Server uses the agent wallet + Zynapse SDK to:

     * pay the on-chain paywall
     * call your Pixtral endpoint
     * return the AI response.

This is a concrete example of:

* "App team" defines products in /admin.
* "Client team" just consumes them via /zynapse/config + /test/sol without touching paywall logic.

---

## 5. Creating Your Own Paid API Product (Reusable Pattern)

Let’s say you don’t want Pixtral.
You want a *simple paid endpoint*:

> GET /hello → returns "Learn how to use x402" (only if paid).

There are *two ways* to do this.

### Option A: Use the Admin API (recommended)

1. Decide which chain you want. Example: EVM.
2. Call from terminal or code:

```
bash
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

3. Adjust server.mjs to handle aiBackend: "hello":

   * Currently, registerPixtralHandler is specialized for aiBackend = "pixtral".
   * To generalize, you can:
```
   js
   function registerHandlerForProduct(product) {
     const method = (product.method || "POST").toLowerCase();
     const routePath = product.path;

     if (!routePath) return;
     if (app._router?.stack?.some(
       (l) => l.route && l.route.path === routePath && l.route.methods[method]
     )) {
       return;
     }

     // Example: custom backend type "hello"
     if (product.aiBackend === "hello") {
       app[method](routePath, (req, res) => {
         res.json({
           ok: true,
           paid: true,
           message: "Learn how to use x402",
         });
       });
       return;
     }

     // Existing Pixtral behavior
     if (product.aiBackend === "pixtral") {
       // (use the existing Pixtral handler code here)
     }
   }
   ```

   * Replace calls to registerPixtralHandler(product) with registerHandlerForProduct(product).
   * Now your /hello route is:

     * protected by the automatically wired paywall, and
     * returns static JSON once paid.

### Option B: Declare product in code (no admin UI)

Instead of POSTing to /zynapse/admin/product, you can directly create a product object in server.mjs during startup and call the same helpers:
```
js
const helloProduct = {
  id: "hello-x402-evm",
  label: "Hello x402 Paid Guide",
  chain: "evm",
  method: "GET",
  path: "/hello",
  price: "$0.05",
  aiBackend: "hello",
  payouts: [
    { address: EVM_MERCHANT_ADDRESS, percent: 100 },
  ],
};

registerPaywallForProduct(helloProduct);
registerHandlerForProduct(helloProduct);
products.push(helloProduct);
```

This keeps the format reusable: *any* product is just:

1. A config object.
2. registerPaywallForProduct(product) to enforce payment.
3. registerHandlerForProduct(product) to define behavior.

---

## 6. Calling Your Paid API with curl

### 6.1. Using the built-in test endpoints (no manual signing)

For quick demos, use the autonomous test routes.

Example for a Solana Pixtral product:
```
bash
curl -X POST \
  "http://localhost:4040/test/sol?productId=pixtral-sol-1" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Say hi from a paid Solana Pixtral endpoint"}'
```

This will:

* Use the agent wallet (created via /wallet/create).
* Pay the on-chain paywall.
* Call your Pixtral handler.
* Return the paid response.

### 6.2. Direct paid call from your own client

In production, you would:

1. Hit /hello (or your Pixtral path).
2. Get 402 Payment Required with x402/Solana payment instructions.
3. Pay from your wallet.
4. Retry the request with the appropriate X-PAYMENT header.

This flow is handled for you by:

* createAutonomousFetch (EVM/x402)
* createSolanaAutonomousFetch (Solana)

in @zynapse/node. Your apps just use those wrappers instead of bare fetch.
