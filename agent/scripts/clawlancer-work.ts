import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { verifyClawlancerFunding } from "../src/clawlancer-chain.ts";
import { acquireExclusiveRun } from "../src/exclusive-run.ts";
import { CLAWLANCER_CANARY, clawlancerWorkAction, parseClawlancerTransaction } from "../src/clawlancer-work.ts";

const API = "https://clawlancer.ai";
const TRANSACTION_ID = CLAWLANCER_CANARY.transactionId;
const LISTING_ID = CLAWLANCER_CANARY.listingId;
const WORKER_ADDRESS = CLAWLANCER_CANARY.sellerAddress;
const BUYER_ADDRESS = CLAWLANCER_CANARY.buyerAddress;
const AMOUNT_ATOMIC = CLAWLANCER_CANARY.amountAtomic;
const ARTIFACT_PATH = "/home/mcr/notes/clawlancer/mimir-reliability-intro.md";
const ARTIFACT_SHA256 = "d212237abd908763276b51baf45efd1421ba9d21eb816ffe7083e60f5432695b";
const CREDENTIAL_PATH = `${homedir()}/.config/clawlancer/credentials.json`;
const CREDENTIAL_SHA256 = "79e6fad0e53780c503d7d75d79baa905c89514bdd034440a9cf28e69f9edeedd";
const STATE_PATH = `${homedir()}/.local/state/bountyverdict/clawlancer-work.json`;
const LOCK_PATH = `${homedir()}/.local/state/bountyverdict/clawlancer-work.lock`;
const timeoutMs = 20_000;
const maximumResponseBytes = 1_000_000;

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

async function request(path: string, apiKey: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(new URL(path, API), {
    ...init,
    redirect: "error",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "mimir-clawlancer-worker/1.0",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  if (new TextEncoder().encode(body).length > maximumResponseBytes) throw new Error("Clawlancer response exceeded the byte cap.");
  if (!response.ok) throw new Error(`Clawlancer returned HTTP ${response.status}: ${body.slice(0, 240)}`);
  if (!(response.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    throw new Error("Clawlancer returned a non-JSON response.");
  }
  return JSON.parse(body) as unknown;
}

const checkedAt = new Date().toISOString();
let releaseLock: (() => Promise<void>) | null = null;
try {
  releaseLock = await acquireExclusiveRun(LOCK_PATH);
  const credentials = JSON.parse(await readFile(CREDENTIAL_PATH, "utf8")) as Record<string, unknown>;
  const apiKey = credentials.api_key;
  if (typeof apiKey !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(apiKey) ||
    createHash("sha256").update(apiKey).digest("hex") !== CREDENTIAL_SHA256) {
    throw new Error("Clawlancer API credential is malformed.");
  }
  if (String(credentials.wallet_address || "").toLowerCase() !== WORKER_ADDRESS.toLowerCase()) {
    throw new Error("Clawlancer credential belongs to another wallet.");
  }

  let transaction = parseClawlancerTransaction(await request(`/api/transactions/${TRANSACTION_ID}`, apiKey));
  if (transaction.id !== TRANSACTION_ID || transaction.listingId !== LISTING_ID ||
    transaction.sellerAddress.toLowerCase() !== WORKER_ADDRESS.toLowerCase() ||
    transaction.buyerAddress.toLowerCase() !== BUYER_ADDRESS.toLowerCase() ||
    transaction.amountAtomic !== AMOUNT_ATOMIC) {
    throw new Error("Clawlancer transaction contract drifted.");
  }
  let action = clawlancerWorkAction(transaction);
  let submittedNow = false;
  let fundingEvidence: Record<string, unknown> | null = null;
  if (action === "submit_work") {
    const client = createPublicClient({ chain: base, transport: http(process.env.RPC_URL) });
    fundingEvidence = await verifyClawlancerFunding(client, transaction);
    const artifact = await readFile(ARTIFACT_PATH);
    const sha256 = createHash("sha256").update(artifact).digest("hex");
    if (sha256 !== ARTIFACT_SHA256) throw new Error("Pinned Clawlancer deliverable hash changed.");
    await request(`/api/transactions/${TRANSACTION_ID}/deliver`, apiKey, {
      method: "POST",
      body: JSON.stringify({ deliverable: artifact.toString("utf8") }),
    });
    transaction = parseClawlancerTransaction(await request(`/api/transactions/${TRANSACTION_ID}`, apiKey));
    if (transaction.state !== "DELIVERED" && transaction.state !== "RELEASED") {
      throw new Error("Clawlancer accepted delivery but did not expose a delivered or released state.");
    }
    action = clawlancerWorkAction(transaction);
    submittedNow = true;
  }
  const state = {
    schema_version: 1,
    status: transaction.state.toLowerCase(),
    checked_at: checkedAt,
    action,
    submitted_now: submittedNow,
    transaction,
    funding_evidence: fundingEvidence,
    artifact: { path: ARTIFACT_PATH, sha256: ARTIFACT_SHA256 },
    accounting: transaction.state === "RELEASED"
      ? "release_reported_but_not_onchain_verified_not_revenue"
      : "no_released_payment_not_revenue",
  };
  await atomicWrite(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
  console.log(JSON.stringify(state, null, 2));
} catch (error) {
  const state = {
    schema_version: 1,
    status: "unavailable",
    checked_at: checkedAt,
    action: "retry_read",
    error: (error instanceof Error ? error.message : "unknown Clawlancer failure").slice(0, 500),
    accounting: "unavailable_not_revenue",
  };
  await atomicWrite(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
  console.error(JSON.stringify(state, null, 2));
  process.exitCode = 1;
} finally {
  if (releaseLock) await releaseLock();
}
