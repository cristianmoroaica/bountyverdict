import { CdpClient } from "@coinbase/cdp-sdk";
import { CdpX402Client } from "@coinbase/cdp-sdk/x402";

const required = ["CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "CDP_WALLET_SECRET"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  throw new Error(`Missing CDP credentials: ${missing.join(", ")}.`);
}

const x402Client = new CdpX402Client({
  walletConfig: { type: "eoa", accountName: "bountyverdict-test-buyer" },
});
const { evmAddress } = await x402Client.getAddresses();
const requestFunds = process.env.REQUEST_FUNDS === "YES";
const transactions: Record<string, string> = {};

if (requestFunds) {
  const cdp = new CdpClient();
  for (const token of ["eth", "usdc"] as const) {
    const result = await cdp.evm.requestFaucet({
      address: evmAddress,
      network: "base-sepolia",
      token,
    });
    transactions[token] = result.transactionHash;
  }
}

console.log(JSON.stringify({
  wallet: "bountyverdict-test-buyer",
  address: evmAddress,
  network: "base-sepolia",
  funds_requested: requestFunds,
  faucet_transactions: transactions,
}, null, 2));
