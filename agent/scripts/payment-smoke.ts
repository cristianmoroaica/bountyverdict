import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { validatePaymentChallenge } from "../src/payment-safety.ts";

const defaultIssue = "https://github.com/typeorm/typeorm/issues/3357";
const baseUrl = process.env.RESOURCE_SERVER_URL || "http://127.0.0.1:8787";
const issueUrl = process.env.ISSUE_URL || defaultIssue;
const url = new URL("/api/verdict", baseUrl);
url.searchParams.set("issue_url", issueUrl);

function decodeHeader(value: string): any {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}

const unpaid = await fetch(url, { headers: { Accept: "application/json" } });
if (unpaid.status !== 402) {
  throw new Error(`Expected an unpaid HTTP 402 response, received ${unpaid.status}.`);
}
const paymentHeader = unpaid.headers.get("payment-required");
if (!paymentHeader) throw new Error("The 402 response omitted PAYMENT-REQUIRED.");
const challenge = decodeHeader(paymentHeader);
const maximumAtomic = BigInt(process.env.MAX_PAYMENT_ATOMIC || "50000");
const executePayment = process.env.EXECUTE_PAYMENT === "YES";
const requirement = validatePaymentChallenge(challenge, {
  maximumAtomic,
  executePayment,
  allowMainnet: process.env.ALLOW_MAINNET_PAYMENT === "YES",
});

console.log(JSON.stringify({
  phase: "payment_challenge_verified",
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

const privateKey = process.env.BUYER_PRIVATE_KEY;
if (!privateKey || !/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
  throw new Error("BUYER_PRIVATE_KEY must be set to a funded test wallet for payment execution.");
}
const account = privateKeyToAccount(privateKey as `0x${string}`);
const client = new x402Client()
  .register(requirement.network as `${string}:${string}`, new ExactEvmScheme(account))
  .registerPolicy((_version, requirements) =>
    requirements.filter((candidate) => BigInt(candidate.amount) <= maximumAtomic),
  );
const paidFetch = wrapFetchWithPayment(fetch, client);
const paid = await paidFetch(url, { headers: { Accept: "application/json" } });
const responseBody = await paid.json() as {
  verdict?: string;
  score?: number;
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
  status: paid.status,
  transaction: settlement.transaction,
  network: settlement.network,
  verdict: responseBody.verdict,
  score: responseBody.score,
  checked_at: responseBody.checked_at,
}, null, 2));
