import dotenv from "dotenv";
import { createAutonomousFetch } from "@zynapse/node";

dotenv.config();


const BUYER_PRIVATE_KEY = process.env.BUYER_PRIVATE_KEY;
if (!BUYER_PRIVATE_KEY) {
  throw new Error("BUYER_PRIVATE_KEY missing in .env");
}

const { fetchWithPayment, account } = createAutonomousFetch({
  privateKey: BUYER_PRIVATE_KEY,
});

(async () => {
  try {
    const res = await fetchWithPayment("http://localhost:4001/pixtral-paid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Explain quantum computing in one sentence.",
      }),
    });

    const data = await res.json().catch(async () => ({
      raw: await res.text(),
    }));

    console.log("Status:", res.status);
    console.log("Payer wallet:", account.address);
    console.log("Response:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error calling pixtral-paid via x402:", err);
  }
})();
