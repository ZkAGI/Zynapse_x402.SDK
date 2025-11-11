import { paymentMiddleware } from "x402-express";
import { wrapFetchWithPayment } from "x402-fetch";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import fetch from "node-fetch";

type RoutesConfig = {
  [route: string]: {
    price: string;              // "$0.01"
    network: string;            // "base-sepolia"
    config?: Record<string, any>;
  };
};

export function initPaidRoutes(
  app: any,
  {
    payTo,
    routes,
    facilitatorUrl = "https://x402.org/facilitator",
  }: {
    payTo: string;
    routes: RoutesConfig;
    facilitatorUrl?: string;
  }
) {
  app.use(
    paymentMiddleware(
      payTo,
      routes,
      { url: facilitatorUrl }
    )
  );
}

/**
 * Create an autonomous fetch wrapper that:
 *  - uses viem wallet client with the given private key
 *  - uses x402-fetch to auto-handle 402 + x402 payments
 */
export function createAutonomousFetch({
  privateKey,
  chain = baseSepolia,
}: {
  privateKey: `0x${string}`;
  chain?: any;
}) {
  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({
    account,
    chain,
    transport: http(),
  });

  // x402-fetch extends fetch with payment handling
  const fetchWithPayment = wrapFetchWithPayment(fetch as any, client);

  return {
    fetchWithPayment,
    account,
  };
}
