import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAndBidPayanRequest,
  fulfillAcceptedPayanRequest,
  parsePayanRequestDetail,
  resolveAcceptedPayanInput,
  selectPayanDemandBid,
} from "../src/payan-demand.ts";
import { PAYAN_PROVIDER_ID } from "../src/payan.ts";

const requestId = "ks7aadkccsnmnec57j1dmrxgts8aw2zw";
const buyerId = "j578982hsn0xjzgdfy6m0y4xed8ax62x";
const bidId = "jd72hr60a499bkzjsbt3c3naqh8axj28";
const request = {
  _id: requestId,
  buyerId,
  title: "Diagnose this failed GitHub Actions workflow root cause",
  description: "Use https://github.com/openai/codex/actions/runs/29728148711 and explain why the workflow failed.",
  budgetMaxCents: 4,
  escrow: false,
  status: "open",
};

test("Payan exact matcher selects only complete existing URL contracts at the exact price", () => {
  const selected = selectPayanDemandBid(request);
  assert.equal(selected?.product, "run");
  assert.equal(selected?.price_cents, 4);
  assert.deepEqual(selected?.input, { run_url: "https://github.com/openai/codex/actions/runs/29728148711" });
  assert.match(selected?.input_sha256 || "", /^[a-f0-9]{64}$/);
  assert.match(selected?.message || "", /hidden input drift will be rejected/);

  assert.equal(selectPayanDemandBid({ ...request, budgetMaxCents: 3 }), null);
  assert.equal(selectPayanDemandBid({ ...request, description: "Please inspect the workflow generally." }), null);
  assert.equal(selectPayanDemandBid({ ...request, description: `${request.description} Also inspect https://github.com/openai/codex.` }), null);
  assert.equal(selectPayanDemandBid({ ...request, buyerId: PAYAN_PROVIDER_ID }), null);
});

test("Payan matcher separates flake, bounty, portfolio, and harness intent", () => {
  assert.equal(selectPayanDemandBid({
    ...request,
    title: "Should I retry this flaky CI failure?",
    description: "Classify https://github.com/actions/runner/actions/runs/29423388605 before retrying.",
    budgetMaxCents: 7,
  })?.product, "flake");
  assert.equal(selectPayanDemandBid({
    ...request,
    title: "Is this bounty still claimable and worth pursuing?",
    description: "Check https://github.com/typeorm/typeorm/issues/3357 before coding.",
    budgetMaxCents: 5,
  })?.product, "single");
  assert.equal(selectPayanDemandBid({
    ...request,
    title: "Compare these GitHub bounties and rank the best",
    description: "Compare https://github.com/a/b/issues/1 with https://github.com/c/d/issues/2.",
    budgetMaxCents: 40,
  })?.product, "portfolio");
  assert.equal(selectPayanDemandBid({
    ...request,
    title: "Audit repository coding-agent instructions",
    description: "Check AGENTS.md and CLAUDE.md in https://github.com/openai/codex.",
    budgetMaxCents: 3,
  })?.product, "harness");
});

test("Payan bid evaluation recovers an existing provider bid and never duplicates it", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const result = await evaluateAndBidPayanRequest({
    request,
    api_key: "pk_live_test",
    place_bid: true,
    fetch_impl: async (url, init) => {
      calls.push({ url: String(url), method: init?.method || "GET" });
      return Response.json({
        request,
        bids: [{ _id: bidId, requestId, bidderId: PAYAN_PROVIDER_ID, priceCents: 4, status: "pending" }],
      });
    },
  });
  assert.equal(result.action, "existing_bid");
  assert.equal(result.bid_id, bidId);
  assert.deepEqual(calls.map(({ method }) => method), ["GET"]);
});

test("Payan bid evaluation sends one exact bid only after authenticated detail", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const result = await evaluateAndBidPayanRequest({
    request,
    api_key: "pk_live_test",
    place_bid: true,
    fetch_impl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (!init?.method) return Response.json({ request, bids: [] });
      return Response.json({ bidId }, { status: 201 });
    },
  });
  assert.equal(result.action, "bid");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init?.method, "POST");
  const body = JSON.parse(String(calls[1].init?.body));
  assert.equal(body.priceCents, 4);
  assert.match(body.message, /SHA-256/);
});

test("accepted Payan input must equal the public contract exactly", () => {
  const decision = selectPayanDemandBid(request)!;
  const acceptedRequest = {
    ...request,
    status: "accepted",
    providerId: PAYAN_PROVIDER_ID,
    agreedPriceCents: 4,
    inputPayload: JSON.stringify({ input: decision.input }),
  };
  const detail = parsePayanRequestDetail({
    request: acceptedRequest,
    bids: [{ _id: bidId, requestId, bidderId: PAYAN_PROVIDER_ID, priceCents: 4, status: "accepted" }],
  }, requestId);
  assert.deepEqual(resolveAcceptedPayanInput(detail, decision), decision.input);
  const mismatch = parsePayanRequestDetail({
    request: { ...acceptedRequest, inputPayload: JSON.stringify({ run_url: "https://github.com/actions/runner/actions/runs/1" }) },
    bids: detail.bids,
  }, requestId);
  assert.throws(() => resolveAcceptedPayanInput(mismatch, decision), /does not match/);
});

test("Payan fulfillment validates the production result before one callback", async () => {
  const decision = selectPayanDemandBid(request)!;
  const detail = parsePayanRequestDetail({
    request: { ...request, status: "accepted", providerId: PAYAN_PROVIDER_ID, agreedPriceCents: 4 },
    bids: [{ _id: bidId, requestId, bidderId: PAYAN_PROVIDER_ID, priceCents: 4, status: "accepted" }],
  }, requestId);
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const result = await fulfillAcceptedPayanRequest({
    detail,
    decision,
    bid_id: bidId,
    api_key: "pk_live_test",
    fetch_impl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("/api/near-market/")) {
        return Response.json({ product: "RunVerdict", version: "1.0", verdict: "FIX" });
      }
      return Response.json({ ok: true });
    },
  });
  assert.ok(result.output_bytes > 0);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/api\/near-market\/run$/);
  assert.match(String(new Headers(calls[0].init?.headers).get("User-Agent")), /owner-automation/);
  assert.match(calls[1].url, /\/requests\/.+\/fulfill$/);
  const callback = JSON.parse(String(calls[1].init?.body));
  assert.equal(JSON.parse(callback.outputPayload).product, "RunVerdict");
});

test("Payan detail parser rejects wrong identities and duplicate bid IDs", () => {
  assert.throws(() => parsePayanRequestDetail({ request, bids: [] }, "aaaaaaaaaaaaaaaaaaaa"), /identity/);
  const duplicate = { _id: bidId, requestId, bidderId: PAYAN_PROVIDER_ID, priceCents: 4, status: "pending" };
  assert.throws(() => parsePayanRequestDetail({ request, bids: [duplicate, duplicate] }, requestId), /duplicated/);
});
