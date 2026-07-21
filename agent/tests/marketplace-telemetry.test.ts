import assert from "node:assert/strict";
import test from "node:test";
import {
  appendCdpMerchantQualityHistory,
  normalizeCdpMerchantQuality,
  normalizeThe402ServiceOutcome,
} from "../src/marketplace-telemetry.ts";

const detail = {
  id: "svc_expected",
  listed_at: "2026-07-20T17:12:24.022Z",
  updated_at: "2026-07-20T19:43:15.566Z",
  service_reputation: {
    score: 75,
    confidence: 0.5,
    dimensions: { quality: 75, speed: 80, reliability: 70, communication: 75 },
    total_jobs: 3,
    successful_jobs: 1,
    failed_jobs: 1,
    disputed_jobs: 1,
  },
};

test("normalizes exact per-service marketplace outcomes", () => {
  assert.deepEqual(normalizeThe402ServiceOutcome(detail, "svc_expected"), {
    service_id: "svc_expected",
    listed_at: detail.listed_at,
    updated_at: detail.updated_at,
    score: 75,
    confidence: 0.5,
    dimensions: detail.service_reputation.dimensions,
    total_jobs: 3,
    successful_jobs: 1,
    failed_jobs: 1,
    disputed_jobs: 1,
  });
});

test("rejects wrong identities and inconsistent or malformed outcome telemetry", () => {
  assert.throws(() => normalizeThe402ServiceOutcome({ ...detail, id: "svc_other" }, "svc_expected"), /another service/);
  assert.throws(() => normalizeThe402ServiceOutcome({
    ...detail,
    service_reputation: { ...detail.service_reputation, total_jobs: 1 },
  }, "svc_expected"), /inconsistent/);
  assert.throws(() => normalizeThe402ServiceOutcome({
    ...detail,
    service_reputation: { ...detail.service_reputation, confidence: 2 },
  }, "svc_expected"), /confidence/);
  assert.throws(() => normalizeThe402ServiceOutcome({ ...detail, updated_at: "not-a-date" }, "svc_expected"), /updated_at/);
});

const merchantResource = {
  resource: "https://example.test/api/verdict",
  lastUpdated: "2026-07-20T10:44:05.955Z",
  quality: {
    l30DaysTotalCalls: 2,
    l30DaysUniquePayers: 2,
    lastCalledAt: "2026-07-21T00:01:00.000Z",
  },
};

test("turns CDP merchant activity changes into reconciliation signals, never revenue", () => {
  const snapshot = normalizeCdpMerchantQuality(
    merchantResource,
    merchantResource.resource,
    "2026-07-21T00:02:00.000Z",
    {
      reported_calls_30d: 1,
      reported_unique_payers_30d: 1,
      last_called_at: "2026-07-20T10:44:05.648Z",
    },
  );
  assert.equal(snapshot.delta_calls_30d, 1);
  assert.equal(snapshot.delta_unique_payers_30d, 1);
  assert.equal(snapshot.call_recency_advanced, true);
  assert.equal(snapshot.requires_settlement_reconciliation, true);
  assert.equal(snapshot.quality_available, true);
  assert.equal(snapshot.baseline_owner_contaminated, true);
  assert.equal("revenue" in snapshot, false);
});

test("accepts newly indexed CDP resources while quality counters are pending", () => {
  for (const resource of [
    { ...merchantResource, quality: null },
    { resource: merchantResource.resource, lastUpdated: merchantResource.lastUpdated },
  ]) {
    const pending = normalizeCdpMerchantQuality(
      resource,
      merchantResource.resource,
      "2026-07-21T00:00:00.000Z",
    );
    assert.equal(pending.quality_available, false);
    assert.equal(pending.reported_calls_30d, 0);
    assert.equal(pending.reported_unique_payers_30d, 0);
    assert.equal(pending.last_called_at, null);
    assert.equal(pending.requires_settlement_reconciliation, false);
  }
});

test("seeds owner-contaminated CDP baselines and retains only changed history points", () => {
  const baseline = normalizeCdpMerchantQuality(
    merchantResource,
    merchantResource.resource,
    "2026-07-21T00:00:00.000Z",
  );
  assert.equal(baseline.delta_calls_30d, null);
  assert.equal(baseline.requires_settlement_reconciliation, false);
  const first = appendCdpMerchantQualityHistory(undefined, { single: baseline });
  const unchanged = appendCdpMerchantQualityHistory(first, {
    single: { ...baseline, observed_at: "2026-07-21T00:05:00.000Z" },
  });
  assert.equal(unchanged.single.length, 1);
  const changed = appendCdpMerchantQualityHistory(unchanged, {
    single: { ...baseline, reported_calls_30d: 3, delta_calls_30d: 1 },
  });
  assert.equal(changed.single.length, 2);
});

test("rejects malformed CDP merchant counters and history", () => {
  assert.throws(() => normalizeCdpMerchantQuality(
    { ...merchantResource, quality: { ...merchantResource.quality, l30DaysUniquePayers: 3 } },
    merchantResource.resource,
    "2026-07-21T00:00:00.000Z",
  ), /inconsistent/);
  assert.throws(() => normalizeCdpMerchantQuality(
    merchantResource,
    "https://example.test/api/other",
    "2026-07-21T00:00:00.000Z",
  ), /identity/);
  assert.throws(() => appendCdpMerchantQualityHistory({ single: [null] }, {
    single: normalizeCdpMerchantQuality(merchantResource, merchantResource.resource, "2026-07-21T00:00:00.000Z"),
  }), /history/);
});
