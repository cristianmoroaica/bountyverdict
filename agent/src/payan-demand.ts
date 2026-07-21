import { createHash } from "node:crypto";
import { PAYAN_API, PAYAN_OFFERS, PAYAN_PROVIDER_ID } from "./payan.ts";
import type { The402Product } from "./the402.ts";

const idPattern = /^[a-z0-9]{20,64}$/;
const githubIssuePattern = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/issues\/[1-9][0-9]*$/;
const githubRepoPattern = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+(?:\.git)?$/;
const githubRunPattern = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/actions\/runs\/[1-9][0-9]*$/;
const requestStatuses = new Set(["open", "accepted", "fulfilled", "completing", "approved", "cancelled", "disputed"]);
const bidStatuses = new Set(["pending", "accepted", "rejected", "withdrawn"]);
const maximumOutputBytes = 1_048_576;
const productionOrigin = "https://bountyverdict-agent-production.mimirslab.workers.dev";

export type PayanRequest = {
  _id: string;
  buyerId: string;
  providerId?: string;
  title: string;
  description: string;
  budgetMaxCents: number;
  agreedPriceCents?: number;
  escrow: boolean;
  status: string;
  inputPayload?: string;
  outputPayload?: string;
  settlementReceiptId?: string;
};

export type PayanBid = {
  _id: string;
  requestId: string;
  bidderId: string;
  priceCents: number;
  estimatedDurationSeconds?: number;
  message?: string;
  status: string;
};

export type PayanRequestDetail = { request: PayanRequest; bids: PayanBid[] };

export type PayanDemandDecision = {
  product: Exclude<The402Product, "mcpdrift">;
  input: Record<string, unknown>;
  input_sha256: string;
  price_cents: number;
  estimated_duration_seconds: number;
  message: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseId(value: unknown, label: string): string {
  if (typeof value !== "string" || !idPattern.test(value)) throw new Error(`Payan ${label} is invalid.`);
  return value;
}

function parseOptionalId(value: unknown, label: string): string | undefined {
  return value === undefined || value === null ? undefined : parseId(value, label);
}

function parsePositiveCents(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 10_000_000) {
    throw new Error(`Payan ${label} is invalid.`);
  }
  return Number(value);
}

export function parsePayanRequest(value: unknown, expectedId?: string): PayanRequest {
  if (!isObject(value)) throw new Error("Payan request is malformed.");
  const id = parseId(value._id, "request ID");
  if (expectedId && id !== expectedId) throw new Error("Payan request identity changed.");
  if (
    typeof value.title !== "string" || !value.title || value.title.length > 200 ||
    typeof value.description !== "string" || !value.description || value.description.length > 5_000 ||
    typeof value.escrow !== "boolean" || typeof value.status !== "string" || !requestStatuses.has(value.status)
  ) throw new Error("Payan request contract is invalid.");
  const inputPayload = value.inputPayload;
  const outputPayload = value.outputPayload;
  if (inputPayload !== undefined && typeof inputPayload !== "string") throw new Error("Payan input payload is invalid.");
  if (outputPayload !== undefined && typeof outputPayload !== "string") throw new Error("Payan output payload is invalid.");
  return {
    _id: id,
    buyerId: parseId(value.buyerId, "buyer ID"),
    providerId: parseOptionalId(value.providerId, "provider ID"),
    title: value.title,
    description: value.description,
    budgetMaxCents: parsePositiveCents(value.budgetMaxCents, "budget"),
    agreedPriceCents: value.agreedPriceCents === undefined
      ? undefined
      : parsePositiveCents(value.agreedPriceCents, "agreed price"),
    escrow: value.escrow,
    status: value.status,
    inputPayload,
    outputPayload,
    settlementReceiptId: parseOptionalId(value.settlementReceiptId, "settlement receipt ID"),
  };
}

function parsePayanBid(value: unknown, expectedRequestId: string): PayanBid {
  if (!isObject(value)) throw new Error("Payan bid is malformed.");
  if (value.requestId !== expectedRequestId || typeof value.status !== "string" || !bidStatuses.has(value.status)) {
    throw new Error("Payan bid contract is invalid.");
  }
  if (value.estimatedDurationSeconds !== undefined &&
    (!Number.isSafeInteger(value.estimatedDurationSeconds) || Number(value.estimatedDurationSeconds) < 1)) {
    throw new Error("Payan bid duration is invalid.");
  }
  if (value.message !== undefined && (typeof value.message !== "string" || value.message.length > 2_000)) {
    throw new Error("Payan bid message is invalid.");
  }
  return {
    _id: parseId(value._id, "bid ID"),
    requestId: expectedRequestId,
    bidderId: parseId(value.bidderId, "bidder ID"),
    priceCents: parsePositiveCents(value.priceCents, "bid price"),
    estimatedDurationSeconds: value.estimatedDurationSeconds as number | undefined,
    message: value.message as string | undefined,
    status: value.status,
  };
}

export function parsePayanRequestDetail(value: unknown, expectedId: string): PayanRequestDetail {
  if (!isObject(value) || !Array.isArray(value.bids)) throw new Error("Payan request detail is malformed.");
  const request = parsePayanRequest(value.request, expectedId);
  const bids = value.bids.map((bid) => parsePayanBid(bid, expectedId));
  const bidIds = new Set(bids.map(({ _id }) => _id));
  if (bidIds.size !== bids.length) throw new Error("Payan request detail duplicated a bid.");
  return { request, bids };
}

export function parsePayanOpenRequests(value: unknown): PayanRequest[] {
  if (!isObject(value) || !Array.isArray(value.requests) || value.requests.length > 200) {
    throw new Error("Payan request list is malformed.");
  }
  const requests = value.requests.map((request) => parsePayanRequest(request));
  if (requests.some(({ status }) => status !== "open")) throw new Error("Payan open request list contained a non-open request.");
  const ids = new Set(requests.map(({ _id }) => _id));
  if (ids.size !== requests.length) throw new Error("Payan request list duplicated a request.");
  return requests;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function stablePayanInput(input: Record<string, unknown>): string {
  return JSON.stringify(stableValue(input));
}

function inputHash(input: Record<string, unknown>): string {
  return createHash("sha256").update(stablePayanInput(input)).digest("hex");
}

function publicGithubUrls(text: string): string[] {
  const values = text.match(/https:\/\/github\.com\/[^\s<>"'`]+/gi) || [];
  return [...new Set(values.map((value) => value.replace(/[),.;:!?\]}]+$/g, "")))];
}

function decision(
  product: PayanDemandDecision["product"],
  input: Record<string, unknown>,
): PayanDemandDecision {
  const offer = PAYAN_OFFERS.find((entry) => entry.product === product);
  if (!offer) throw new Error(`Payan offer is missing for ${product}.`);
  const inputSha256 = inputHash(input);
  return {
    product,
    input,
    input_sha256: inputSha256,
    price_cents: offer.priceCents,
    estimated_duration_seconds: 180,
    message: `${offer.title} can fulfill only the complete public JSON input identified by SHA-256 ${inputSha256}. It is an existing automated, read-only service with the published exact output contract; any hidden input drift will be rejected rather than substituted. Typical delivery is under three minutes after acceptance.`,
  };
}

export function selectPayanDemandBid(value: unknown): PayanDemandDecision | null {
  const request = parsePayanRequest(value);
  if (request.status !== "open" || request.buyerId === PAYAN_PROVIDER_ID) return null;
  const text = `${request.title}\n${request.description}`;
  const intent = text.toLowerCase();
  const urls = publicGithubUrls(text);
  let selected: PayanDemandDecision | null = null;
  if (
    urls.length >= 2 && urls.length <= 10 && urls.every((url) => githubIssuePattern.test(url)) &&
    /rank|compare|portfolio|best.{0,20}bount|which.{0,20}bount/.test(intent)
  ) selected = decision("portfolio", { issue_urls: urls });
  else if (
    urls.length === 1 && githubIssuePattern.test(urls[0]) &&
    /bount|reward|worth.{0,20}(pursu|work)|eligib|claim/.test(intent)
  ) selected = decision("single", { issue_url: urls[0] });
  else if (
    urls.length === 1 && githubRepoPattern.test(urls[0]) &&
    /agents?\.md|claude\.md|gemini\.md|coding.agent|agent instruction|agent harness|repository instruction/.test(intent)
  ) selected = decision("harness", { repo_url: urls[0] });
  else if (
    urls.length === 1 && githubRunPattern.test(urls[0]) &&
    /flak|retry|intermittent|nondetermin/.test(intent)
  ) selected = decision("flake", { run_url: urls[0] });
  else if (
    urls.length === 1 && githubRunPattern.test(urls[0]) &&
    /diagnos|root cause|why.{0,20}fail|failure.{0,20}cause|failed.{0,20}workflow|actions.{0,20}fail/.test(intent)
  ) selected = decision("run", { run_url: urls[0] });
  if (!selected || selected.price_cents > request.budgetMaxCents) return null;
  return selected;
}

async function requestDetail(input: {
  request_id: string;
  api_key: string;
  fetch_impl: typeof fetch;
}): Promise<PayanRequestDetail> {
  const response = await input.fetch_impl(`${PAYAN_API}/requests/${input.request_id}`, {
    redirect: "error",
    headers: { Authorization: `Bearer ${input.api_key}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Payan request detail returned HTTP ${response.status}.`);
  return parsePayanRequestDetail(await response.json(), input.request_id);
}

export async function evaluateAndBidPayanRequest(input: {
  request: PayanRequest;
  api_key: string;
  provider_id?: string;
  place_bid: boolean;
  fetch_impl?: typeof fetch;
}): Promise<{
  action: "ignored" | "eligible" | "bid" | "existing_bid";
  request_id: string;
  decision?: PayanDemandDecision;
  bid_id?: string;
}> {
  const fetchImpl = input.fetch_impl || fetch;
  const providerId = input.provider_id || PAYAN_PROVIDER_ID;
  if (!idPattern.test(providerId)) throw new Error("Payan provider identity is invalid.");
  const detail = await requestDetail({ request_id: input.request._id, api_key: input.api_key, fetch_impl: fetchImpl });
  const current = detail.request;
  const selected = selectPayanDemandBid(current);
  if (!selected || current.status !== "open" || current.buyerId === providerId) {
    return { action: "ignored", request_id: current._id };
  }
  const existing = detail.bids.filter(({ bidderId }) => bidderId === providerId);
  if (existing.length > 1) throw new Error("Payan already contains duplicate bids from this provider.");
  if (existing.length === 1) {
    return { action: "existing_bid", request_id: current._id, decision: selected, bid_id: existing[0]._id };
  }
  if (!input.place_bid) return { action: "eligible", request_id: current._id, decision: selected };
  const response = await fetchImpl(`${PAYAN_API}/requests/${current._id}/bid`, {
    method: "POST",
    redirect: "error",
    headers: { Authorization: `Bearer ${input.api_key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      priceCents: selected.price_cents,
      estimatedDurationSeconds: selected.estimated_duration_seconds,
      message: selected.message,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 201) throw new Error(`Payan bid returned HTTP ${response.status}.`);
  const payload = await response.json() as Record<string, unknown>;
  const bidId = parseId(payload.bidId, "bid ID");
  return { action: "bid", request_id: current._id, decision: selected, bid_id: bidId };
}

export function resolveAcceptedPayanInput(
  detail: PayanRequestDetail,
  decision: PayanDemandDecision,
  providerId = PAYAN_PROVIDER_ID,
): Record<string, unknown> {
  if (detail.request.status !== "accepted" || detail.request.providerId !== providerId) {
    throw new Error("Payan request is not accepted by this provider.");
  }
  const currentDecision = selectPayanDemandBid({ ...detail.request, status: "open" });
  if (!currentDecision || currentDecision.product !== decision.product ||
    currentDecision.input_sha256 !== decision.input_sha256) {
    throw new Error("Payan public request input drifted after bidding.");
  }
  if (detail.request.inputPayload === undefined || detail.request.inputPayload === "") return decision.input;
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail.request.inputPayload);
  } catch {
    throw new Error("Payan accepted input payload is not JSON.");
  }
  if (isObject(parsed) && Object.keys(parsed).length === 1 && isObject(parsed.input)) parsed = parsed.input;
  if (!isObject(parsed) || stablePayanInput(parsed) !== stablePayanInput(decision.input)) {
    throw new Error("Payan hidden input does not match the public bid contract.");
  }
  return parsed;
}

const expectedProducts: Record<PayanDemandDecision["product"], string> = {
  single: "BountyVerdict",
  portfolio: "BountyVerdict Portfolio",
  harness: "HarnessVerdict",
  run: "RunVerdict",
  flake: "FlakeVerdict",
};

export async function fulfillAcceptedPayanRequest(input: {
  detail: PayanRequestDetail;
  decision: PayanDemandDecision;
  bid_id: string;
  api_key: string;
  provider_id?: string;
  fetch_impl?: typeof fetch;
}): Promise<{ output_bytes: number }> {
  const fetchImpl = input.fetch_impl || fetch;
  const providerId = input.provider_id || PAYAN_PROVIDER_ID;
  const ourBid = input.detail.bids.find(({ _id, bidderId }) =>
    _id === input.bid_id && bidderId === providerId
  );
  if (!ourBid || ourBid.status !== "accepted") throw new Error("Payan stored bid is not the accepted provider bid.");
  const workInput = resolveAcceptedPayanInput(input.detail, input.decision, providerId);
  const productResponse = await fetchImpl(`${productionOrigin}/api/near-market/${input.decision.product}`, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "bountyverdict-owner-automation/payan-demand-1.0",
    },
    body: JSON.stringify({ input: workInput }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!productResponse.ok) throw new Error(`Payan product fulfillment returned HTTP ${productResponse.status}.`);
  const outputText = await productResponse.text();
  const outputBytes = new TextEncoder().encode(outputText).length;
  if (outputBytes < 2 || outputBytes > maximumOutputBytes) throw new Error("Payan product output size is invalid.");
  let output: unknown;
  try {
    output = JSON.parse(outputText);
  } catch {
    throw new Error("Payan product output is not JSON.");
  }
  if (!isObject(output) || output.product !== expectedProducts[input.decision.product]) {
    throw new Error("Payan product output contract is invalid.");
  }
  const response = await fetchImpl(`${PAYAN_API}/requests/${input.detail.request._id}/fulfill`, {
    method: "POST",
    redirect: "error",
    headers: { Authorization: `Bearer ${input.api_key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ outputPayload: outputText }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Payan fulfill callback returned HTTP ${response.status}.`);
  const payload = await response.json() as Record<string, unknown>;
  if (payload.ok !== true) throw new Error("Payan fulfill callback did not confirm success.");
  return { output_bytes: outputBytes };
}

export async function fetchPayanRequestDetail(input: {
  request_id: string;
  api_key: string;
  fetch_impl?: typeof fetch;
}): Promise<PayanRequestDetail> {
  parseId(input.request_id, "request ID");
  return requestDetail({
    request_id: input.request_id,
    api_key: input.api_key,
    fetch_impl: input.fetch_impl || fetch,
  });
}
