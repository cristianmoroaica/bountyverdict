import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { CdpX402Client } from "@coinbase/cdp-sdk/x402";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { validatePaymentChallenge } from "../src/payment-safety.ts";

const defaultIssue = "https://github.com/typeorm/typeorm/issues/3357";
const defaultRepo = "https://github.com/openai/codex";
const defaultPortfolio = [
  "https://github.com/godotengine/godot/issues/70796",
  defaultIssue,
];
const baseUrl = process.env.RESOURCE_SERVER_URL || "http://127.0.0.1:8787";
const issueUrl = process.env.ISSUE_URL || defaultIssue;
const product = process.env.PRODUCT === "portfolio"
  ? "portfolio"
  : process.env.PRODUCT === "harness"
    ? "harness"
    : process.env.PRODUCT === "skill"
      ? "skill"
    : "single";
const issueUrls = process.env.ISSUE_URLS
  ? process.env.ISSUE_URLS.split(",").map((value) => value.trim()).filter(Boolean)
  : defaultPortfolio;
const url = new URL(product === "portfolio" ? "/api/portfolio" : product === "harness" ? "/api/harness" : product === "skill" ? "/api/skill" : "/api/verdict", baseUrl);
if (product === "single") url.searchParams.set("issue_url", issueUrl);
if (product === "harness") url.searchParams.set("repo_url", process.env.REPO_URL || defaultRepo);
if (product === "skill") {
  url.searchParams.set("repo_url", process.env.SKILL_REPO_URL || "https://github.com/coinbase/agentic-wallet-skills");
  url.searchParams.set("skill_path", process.env.SKILL_PATH || "skills/agentic-wallet");
}
const requestInit: RequestInit = product === "portfolio"
  ? {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ issue_urls: issueUrls }),
    }
  : { headers: { Accept: "application/json" } };

function decodeHeader(value: string): any {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}

const unpaid = await fetch(url, requestInit);
if (unpaid.status !== 402) {
  throw new Error(`Expected an unpaid HTTP 402 response, received ${unpaid.status}.`);
}
const paymentHeader = unpaid.headers.get("payment-required");
if (!paymentHeader) throw new Error("The 402 response omitted PAYMENT-REQUIRED.");
const challenge = decodeHeader(paymentHeader);
const defaultMaximumAtomic = product === "portfolio" ? "400000" : product === "harness" ? "30000" : product === "skill" ? "60000" : "50000";
const maximumAtomic = BigInt(process.env.MAX_PAYMENT_ATOMIC || defaultMaximumAtomic);
const executePayment = process.env.EXECUTE_PAYMENT === "YES";
const requirement = validatePaymentChallenge(challenge, {
  maximumAtomic,
  executePayment,
  allowMainnet: process.env.ALLOW_MAINNET_PAYMENT === "YES",
});

console.log(JSON.stringify({
  phase: "payment_challenge_verified",
  product,
  resource: challenge.resource?.url,
  service: challenge.resource?.serviceName,
  network: requirement.network,
  amount_atomic: requirement.amount,
  asset: requirement.asset,
  pay_to: requirement.payTo,
  bazaar_method: challenge.extensions?.bazaar?.info?.input?.method,
  execute_payment: executePayment,
}, null, 2));

if (!executePayment) process.exit(0);

const hasCdpWallet = Boolean(
  process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET && process.env.CDP_WALLET_SECRET,
);
let payer: string;
let client: x402Client;
if (hasCdpWallet) {
  const cdpClient = new CdpX402Client({
    walletConfig: { type: "eoa", accountName: "bountyverdict-test-buyer" },
    spendControls: {
      maxAmountPerPayment: { atomic: maximumAtomic, asset: requirement.asset },
      maxCumulativeSpend: { atomic: maximumAtomic, asset: requirement.asset },
      maxCumulativeSpendWindow: "24h",
      allowedNetworks: [requirement.network as `${string}:${string}`],
      allowedAssets: [requirement.asset],
      allowedPayees: [requirement.payTo],
    },
  });
  payer = (await cdpClient.getAddresses()).evmAddress;
  client = cdpClient;
} else {
  const privateKey = process.env.BUYER_PRIVATE_KEY;
  if (!privateKey || !/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
    throw new Error(
      "Set CDP_API_KEY_ID, CDP_API_KEY_SECRET, and CDP_WALLET_SECRET, or provide a funded test-only BUYER_PRIVATE_KEY.",
    );
  }
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  payer = account.address;
  client = new x402Client()
    .register(requirement.network as `${string}:${string}`, new ExactEvmScheme(account))
    .registerPolicy((_version, requirements) =>
      requirements.filter((candidate) => BigInt(candidate.amount) <= maximumAtomic),
    );
}
const paidFetch = wrapFetchWithPayment(fetch, client);
const paid = await paidFetch(url, requestInit);
const responseBody = await paid.json() as {
  verdict?: string;
  score?: number;
  risk_score?: number;
  recommendation?: string;
  checked_at?: string;
};
if (!paid.ok) {
  throw new Error(`Paid request failed with HTTP ${paid.status}: ${JSON.stringify(responseBody)}`);
}
const settlementHeader = paid.headers.get("payment-response");
if (!settlementHeader) throw new Error("Successful response omitted PAYMENT-RESPONSE.");
const settlement = decodeHeader(settlementHeader);

console.log(JSON.stringify({
  phase: "payment_settled",
  product,
  payer,
  status: paid.status,
  transaction: settlement.transaction,
  network: settlement.network,
  verdict: responseBody.verdict,
  score: responseBody.score,
  risk_score: responseBody.risk_score,
  recommendation: responseBody.recommendation,
  checked_at: responseBody.checked_at,
}, null, 2));
