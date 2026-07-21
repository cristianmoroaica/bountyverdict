import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { PAYAN_API, PAYAN_PROVIDER_ID } from "../src/payan.ts";
import {
  evaluateAndBidPayanRequest,
  fetchPayanRequestDetail,
  fulfillAcceptedPayanRequest,
  parsePayanOpenRequests,
  type PayanDemandDecision,
} from "../src/payan-demand.ts";

const apiKey = process.env.PAYAN_API_KEY;
const agentId = process.env.PAYAN_AGENT_ID;
const bidEnabled = process.env.PAYAN_BID === "YES";
const fulfillEnabled = process.env.PAYAN_FULFILL === "YES";
const stateFile = process.env.PAYAN_DEMAND_STATE_FILE ||
  `${homedir()}/.local/state/bountyverdict/payan-demand.json`;
if (!apiKey || !/^pk_live_[A-Za-z0-9_-]+$/.test(apiKey)) throw new Error("PAYAN_API_KEY is missing or invalid.");
if (agentId !== PAYAN_PROVIDER_ID) throw new Error("PAYAN_AGENT_ID does not match the pinned provider.");

type DemandRecord = {
  request_id: string;
  bid_id: string;
  decision: PayanDemandDecision;
  first_seen_at: string;
  updated_at: string;
  request_status: string;
  bid_status: string;
  fulfilled_at?: string;
  approved_at?: string;
  settlement_receipt_id?: string;
  last_error?: string;
};

type DemandState = {
  schema_version: 1;
  provider_id: string;
  checked_at: string;
  records: Record<string, DemandRecord>;
  last_run?: Record<string, unknown>;
};

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

let state: DemandState = {
  schema_version: 1,
  provider_id: PAYAN_PROVIDER_ID,
  checked_at: new Date(0).toISOString(),
  records: {},
};
try {
  const parsed = JSON.parse(await readFile(stateFile, "utf8")) as DemandState;
  if (parsed.schema_version !== 1 || parsed.provider_id !== PAYAN_PROVIDER_ID ||
    !parsed.records || typeof parsed.records !== "object" || Array.isArray(parsed.records)) {
    throw new Error("Payan demand state is malformed.");
  }
  state = parsed;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const checkedAt = new Date().toISOString();
const summary = {
  open_requests_seen: 0,
  exact_matches: 0,
  bids_created: 0,
  existing_bids_recovered: 0,
  accepted: 0,
  fulfilled: 0,
  approved: 0,
  errors: 0,
};

for (const [requestId, record] of Object.entries(state.records)) {
  try {
    const detail = await fetchPayanRequestDetail({ request_id: requestId, api_key: apiKey });
    const ourBid = detail.bids.find(({ _id, bidderId }) => _id === record.bid_id && bidderId === PAYAN_PROVIDER_ID);
    if (!ourBid) throw new Error("Stored Payan bid is missing from request detail.");
    record.request_status = detail.request.status;
    record.bid_status = ourBid.status;
    record.updated_at = checkedAt;
    delete record.last_error;
    if (detail.request.providerId === PAYAN_PROVIDER_ID && ourBid.status === "accepted") {
      summary.accepted += 1;
      if (detail.request.status === "accepted" && !record.fulfilled_at && fulfillEnabled) {
        await fulfillAcceptedPayanRequest({
          detail,
          decision: record.decision,
          bid_id: record.bid_id,
          api_key: apiKey,
        });
        record.fulfilled_at = checkedAt;
        record.request_status = "fulfilled";
      }
    }
    if (["fulfilled", "completing", "approved"].includes(record.request_status)) summary.fulfilled += 1;
    if (record.request_status === "approved") {
      summary.approved += 1;
      record.approved_at ||= checkedAt;
      if (detail.request.settlementReceiptId) record.settlement_receipt_id = detail.request.settlementReceiptId;
    }
  } catch (error) {
    summary.errors += 1;
    record.updated_at = checkedAt;
    record.last_error = error instanceof Error ? error.message.slice(0, 500) : "Unknown Payan demand error.";
  }
}

const feedResponse = await fetch(`${PAYAN_API}/requests?status=open&limit=200`, {
  redirect: "error",
  headers: { "User-Agent": "bountyverdict-payan-demand/1.0" },
  signal: AbortSignal.timeout(15_000),
});
if (!feedResponse.ok) throw new Error(`Payan request feed returned HTTP ${feedResponse.status}.`);
const openRequests = parsePayanOpenRequests(await feedResponse.json());
summary.open_requests_seen = openRequests.length;

for (const request of openRequests) {
  if (state.records[request._id]) continue;
  try {
    const result = await evaluateAndBidPayanRequest({
      request,
      api_key: apiKey,
      place_bid: bidEnabled,
    });
    if (result.action === "ignored") continue;
    summary.exact_matches += 1;
    if (result.action === "eligible") continue;
    if (!result.decision || !result.bid_id) throw new Error("Payan bid result omitted its contract.");
    if (result.action === "bid") summary.bids_created += 1;
    if (result.action === "existing_bid") summary.existing_bids_recovered += 1;
    state.records[request._id] = {
      request_id: request._id,
      bid_id: result.bid_id,
      decision: result.decision,
      first_seen_at: checkedAt,
      updated_at: checkedAt,
      request_status: "open",
      bid_status: "pending",
    };
  } catch (error) {
    summary.errors += 1;
    console.error(`Payan request ${request._id} evaluation failed:`, error instanceof Error ? error.message : "unknown error");
  }
}

const recordEntries = Object.entries(state.records).sort((left, right) =>
  Date.parse(right[1].updated_at) - Date.parse(left[1].updated_at)
).slice(0, 200);
state = {
  schema_version: 1,
  provider_id: PAYAN_PROVIDER_ID,
  checked_at: checkedAt,
  records: Object.fromEntries(recordEntries),
  last_run: {
    ...summary,
    bid_enabled: bidEnabled,
    fulfill_enabled: fulfillEnabled,
    tracked_requests: recordEntries.length,
  },
};
await atomicWrite(stateFile, `${JSON.stringify(state, null, 2)}\n`);
console.log(JSON.stringify({ checked_at: checkedAt, ...state.last_run }, null, 2));
