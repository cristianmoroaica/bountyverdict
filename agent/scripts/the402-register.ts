import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

if (process.env.THE402_REGISTER !== "YES") {
  throw new Error("Set THE402_REGISTER=YES to authorize the capped $0.01 provider registration.");
}

const url = "https://api.the402.ai/v1/register";
const body = JSON.stringify({
  name: "BountyVerdict",
  description: "Agent-native preflight decisions for public GitHub work, harnesses, CI failures, flakes, and MCP schema drift.",
  type: "provider",
  webhook_url: "https://bountyverdict-agent-production.mimirslab.workers.dev/api/the402/webhook",
  capabilities: ["github", "security", "ci", "agent-safety", "mcp"],
});
const configFile = process.env.THE402_CONFIG_FILE ||
  `${homedir()}/.config/bountyverdict/the402.env`;
const privateKey = process.env.BUYER_PRIVATE_KEY;
if (!privateKey || !/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
  throw new Error("BUYER_PRIVATE_KEY is missing or invalid.");
}

function sanitized(value: string): string {
  return value
    .replace(/sk_[A-Za-z0-9_-]+/g, "sk_[redacted]")
    .replace(/whsec_[A-Za-z0-9_-]+/g, "whsec_[redacted]")
    .slice(0, 2_000);
}

const account = privateKeyToAccount(privateKey as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, {
  signer: account,
  policies: [(version, requirements) => requirements.filter((requirement: any) =>
    version === 1 &&
    requirement.scheme === "exact" &&
    requirement.network === "base" &&
    requirement.maxAmountRequired === "10000" &&
    requirement.asset?.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" &&
    requirement.payTo?.toLowerCase() === "0x21bce104282d6a089539c34addde152d42a02d0e" &&
    requirement.resource === url
  )],
});
const fetchWithPayment = wrapFetchWithPayment(fetch, client);
const response = await fetchWithPayment(url, {
  method: "POST",
  redirect: "error",
  headers: { "Content-Type": "application/json" },
  body,
  signal: AbortSignal.timeout(30_000),
});
const responseBody = await response.text();
if (!response.ok) {
  throw new Error(`the402 registration returned HTTP ${response.status}: ${sanitized(responseBody)}`);
}
let output: unknown;
try {
  output = JSON.parse(responseBody);
} catch {
  throw new Error(`the402 registration returned invalid JSON: ${sanitized(responseBody)}`);
}

function findString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  if (!Array.isArray(value) && typeof (value as Record<string, unknown>)[key] === "string") {
    return (value as Record<string, string>)[key];
  }
  for (const nested of Object.values(value)) {
    const found = findString(nested, key);
    if (found) return found;
  }
  return null;
}

const participantId = findString(output, "participant_id");
const apiKey = findString(output, "api_key");
const webhookSecret = findString(output, "webhook_secret");
const wallet = findString(output, "wallet");
if (!participantId || !/^p_[A-Za-z0-9_-]{1,160}$/.test(participantId)) {
  throw new Error("the402 registration did not return a valid participant ID.");
}
if (!apiKey || !/^sk_[A-Za-z0-9_-]{8,}$/.test(apiKey)) {
  throw new Error("the402 registration did not return a valid API key.");
}
if (!webhookSecret || !/^whsec_[A-Za-z0-9_-]{8,}$/.test(webhookSecret)) {
  throw new Error("the402 registration did not return a valid webhook secret.");
}
if (wallet && !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
  throw new Error("the402 registration returned an invalid provider wallet.");
}

await mkdir(dirname(configFile), { recursive: true, mode: 0o700 });
const temporary = `${configFile}.${process.pid}.tmp`;
await writeFile(temporary, [
  `THE402_PARTICIPANT_ID=${participantId}`,
  `THE402_API_KEY=${apiKey}`,
  `THE402_WEBHOOK_SECRET=${webhookSecret}`,
  ...(wallet ? [`THE402_PROVIDER_WALLET=${wallet}`] : []),
  "",
].join("\n"), { mode: 0o600 });
await rename(temporary, configFile);

console.log(JSON.stringify({
  participant_id: participantId,
  provider_wallet: wallet,
  owner_buyer_wallet: account.address,
  registration_cost_usdc: "0.01",
  credentials: "stored_outside_repository",
  config_file: configFile,
}, null, 2));
