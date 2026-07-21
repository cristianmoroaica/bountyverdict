import { THE402_API, THE402_LISTINGS } from "./the402-catalog.ts";
import type { The402Product } from "./the402.ts";

const postingIdPattern = /^post_[A-Za-z0-9_-]{1,160}$/;
const githubIssuePattern = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/issues\/[1-9][0-9]*(?:[?#].*)?$/;
const githubRepoPattern = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+(?:\.git)?$/;
const githubRunPattern = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/actions\/runs\/[1-9][0-9]*$/;
const MAX_UNVERIFIED_BUDGET_USD = 25;

export type The402RequestCreated = {
  type: "request.created";
  posting_id: string;
};

export type The402BidDecision = {
  product: The402Product;
  service_id: string;
  price_usd: number;
  eta_hours: number;
  pitch: string;
};

type Posting = {
  posting_id: string;
  is_subcontract?: boolean;
  title: string;
  brief: Record<string, unknown>;
  category?: string;
  budget_min_usd: number;
  budget_max_usd: number;
  deadline?: string | null;
  status: string;
  expires_at: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const keys = Object.keys(value).sort();
  const permitted = [...required, ...optional];
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => permitted.includes(key));
}

function finiteBudget(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function minimumBudget(value: unknown): number | null {
  if (value === null) return 0;
  return finiteBudget(value) ? value : null;
}

function parsePosting(value: unknown, expectedId: string): Posting {
  if (!isObject(value) || value.posting_id !== expectedId || !postingIdPattern.test(expectedId)) {
    throw new Error("the402 posting identity is invalid.");
  }
  const budgetMinUsd = minimumBudget(value.budget_min_usd);
  if (
    typeof value.title !== "string" || !value.title || value.title.length > 500 ||
    !isObject(value.brief) || typeof value.status !== "string" ||
    typeof value.expires_at !== "string" || budgetMinUsd === null ||
    !finiteBudget(value.budget_max_usd) || budgetMinUsd > value.budget_max_usd
  ) {
    throw new Error("the402 posting contract is invalid.");
  }
  return { ...value, budget_min_usd: budgetMinUsd } as unknown as Posting;
}

export function parseThe402RequestCreated(rawBody: string): The402RequestCreated | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error("the402 webhook body must be valid JSON.");
  }
  if (!isObject(parsed)) throw new Error("the402 webhook body must be an object.");
  if (parsed.type !== "request.created") return null;
  if (typeof parsed.posting_id !== "string" || !postingIdPattern.test(parsed.posting_id)) {
    throw new Error("the402 request posting_id is invalid.");
  }
  const expectedPostingUrl = `/v1/postings/${parsed.posting_id}`;
  const expectedBidsUrl = `${expectedPostingUrl}/bids`;
  if (parsed.posting_url !== expectedPostingUrl || parsed.bids_url !== expectedBidsUrl) {
    throw new Error("the402 request URLs do not match the posting identity.");
  }
  return { type: "request.created", posting_id: parsed.posting_id };
}

function matchingProduct(posting: Posting): The402Product | null {
  const { brief } = posting;
  const intent = `${posting.title} ${posting.category || ""} ${JSON.stringify(brief)}`.toLowerCase();
  if (
    exactKeys(brief, ["issue_urls"]) && Array.isArray(brief.issue_urls) &&
    brief.issue_urls.length >= 2 && brief.issue_urls.length <= 10 &&
    new Set(brief.issue_urls).size === brief.issue_urls.length &&
    brief.issue_urls.every((url) => typeof url === "string" && githubIssuePattern.test(url)) &&
    /rank|compare|portfolio|best.{0,20}bount|which.{0,20}bount/.test(intent)
  ) return "portfolio";
  if (
    exactKeys(brief, ["issue_url"]) && typeof brief.issue_url === "string" &&
    githubIssuePattern.test(brief.issue_url) && /bount|reward|worth.{0,20}(pursu|work)/.test(intent)
  ) return "single";
  if (
    exactKeys(brief, ["repo_url"]) && typeof brief.repo_url === "string" &&
    githubRepoPattern.test(brief.repo_url) &&
    /agents?\.md|claude\.md|gemini\.md|coding.agent|agent instruction|agent harness/.test(intent)
  ) return "harness";
  if (
    exactKeys(brief, ["run_url"], ["attempt"]) && typeof brief.run_url === "string" &&
    githubRunPattern.test(brief.run_url) &&
    (brief.attempt === undefined || Number.isSafeInteger(brief.attempt) && Number(brief.attempt) > 0) &&
    /flak|retry|intermittent|nondetermin/.test(intent)
  ) return "flake";
  if (
    exactKeys(brief, ["run_url"]) && typeof brief.run_url === "string" &&
    githubRunPattern.test(brief.run_url) &&
    /diagnos|root cause|why.{0,20}fail|failure.{0,20}cause|failed.{0,20}workflow|actions.{0,20}fail/.test(intent)
  ) return "run";
  if (
    exactKeys(brief, ["contract_version", "subject", "annotation_source_trust", "baseline", "current"]) &&
    brief.contract_version === "mcp-drift/1" && isObject(brief.subject) &&
    (brief.annotation_source_trust === "trusted" || brief.annotation_source_trust === "untrusted") &&
    isObject(brief.baseline) && isObject(brief.current) && /mcp|tools\/list|schema drift/.test(intent)
  ) return "mcpdrift";
  return null;
}

export function selectThe402Bid(value: unknown, now = new Date()): The402BidDecision | null {
  if (!isObject(value) || typeof value.posting_id !== "string") return null;
  const posting = parsePosting(value, value.posting_id);
  if (posting.status !== "open" || posting.is_subcontract === true) return null;
  const expiry = Date.parse(posting.expires_at);
  const deadline = posting.deadline ? Date.parse(posting.deadline) : null;
  if (!Number.isFinite(expiry) || expiry <= now.getTime() || deadline !== null && (!Number.isFinite(deadline) || deadline <= now.getTime())) {
    return null;
  }
  if (posting.budget_max_usd > MAX_UNVERIFIED_BUDGET_USD) return null;
  const product = matchingProduct(posting);
  if (!product) return null;
  const listing = THE402_LISTINGS.find((entry) => entry.product === product);
  if (!listing) return null;
  const basePrice = Number(listing.price.replace(/^\$/, ""));
  const price = Math.ceil(Math.max(basePrice, posting.budget_min_usd) * 100) / 100;
  if (!Number.isFinite(price) || price > posting.budget_max_usd || price > MAX_UNVERIFIED_BUDGET_USD) return null;
  return {
    product,
    service_id: listing.service_id,
    price_usd: price,
    eta_hours: 1,
    pitch: `${listing.name} is an existing automated, evidence-linked service with a published exact input and deliverable contract. Delivery is within one hour and normally completes in seconds.`,
  };
}

export async function evaluateAndBidThe402Request(input: {
  request: The402RequestCreated;
  api_key: string;
  fetch_impl?: typeof fetch;
}): Promise<{ action: "bid" | "ignored"; posting_id: string; product?: The402Product }> {
  const fetchImpl = input.fetch_impl || fetch;
  const detailUrl = `${THE402_API}/postings/${input.request.posting_id}`;
  const detail = await fetchImpl(detailUrl, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (detail.status === 404) return { action: "ignored", posting_id: input.request.posting_id };
  if (!detail.ok) throw new Error(`the402 posting detail returned HTTP ${detail.status}.`);
  const posting = parsePosting(await detail.json(), input.request.posting_id);
  const decision = selectThe402Bid(posting);
  if (!decision) return { action: "ignored", posting_id: input.request.posting_id };
  const response = await fetchImpl(`${detailUrl}/bids`, {
    method: "POST",
    redirect: "error",
    headers: { "X-API-Key": input.api_key, "Content-Type": "application/json" },
    body: JSON.stringify({
      price_usd: decision.price_usd,
      eta_hours: decision.eta_hours,
      service_id: decision.service_id,
      pitch: decision.pitch,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`the402 bid returned HTTP ${response.status}.`);
  return { action: "bid", posting_id: input.request.posting_id, product: decision.product };
}
