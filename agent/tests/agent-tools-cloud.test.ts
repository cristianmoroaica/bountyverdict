import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentToolsCloudContractDrift,
  parseAgentToolsCloudListing,
} from "../src/agent-tools-cloud.ts";
import { PRODUCT_CATALOG, PRODUCT_KEYS } from "../src/product-catalog.ts";

const productionOrigin = "https://bountyverdict-agent-production.mimirslab.workers.dev";
const slug = "bountyverdict-agent-production-mimirslab-workers-dev-bazaar";
const revenueWallet = "0x4aa55988fA032FBbB8DDEf496b0f194FEc62D614";
const expectedResources = PRODUCT_KEYS.map((product) => ({
  product,
  url: `${productionOrigin}${PRODUCT_CATALOG[product].path}`,
}));
const listedResources = expectedResources.filter(({ product }) => product !== "mcpdrift");

function payload(overrides: Record<string, unknown> = {}) {
  const prices = listedResources.map(({ product }) => Number(PRODUCT_CATALOG[product].priceUsd.slice(1)));
  return {
    slug,
    url: productionOrigin,
    name: new URL(productionOrigin).host,
    well_known_url: `${productionOrigin}/.well-known/x402`,
    description: "FlakeVerdict retry decision",
    resource_count: listedResources.length,
    resource_samples: listedResources.map(({ url }) => ({ url, kind: "http" })),
    payment: {
      currency: "USDC",
      chains: ["eip155:8453"],
      pay_to: revenueWallet,
      price_min_usd: Math.min(...prices),
      price_max_usd: Math.max(...prices),
    },
    health: "ok",
    http_status: 200,
    latency_ms: 96,
    x402_ok: 0,
    health_checked: 1_784_592_290,
    last_seen: 1_784_582_728,
    ...overrides,
  };
}

const search = { count: 1, services: [{ slug }] };
const options = { productionOrigin, slug, revenueWallet, expectedResources };

test("Agent Tools Cloud keeps a failed payment probe visible on a partial organic listing", () => {
  const parsed = parseAgentToolsCloudListing(search, payload(), options);
  assert.equal(parsed.status, "listed_partial_probe_failed");
  assert.equal(parsed.x402_probe_ok, false);
  assert.equal(parsed.x402_probe_status, "failed");
  assert.deepEqual(parsed.missing_products, ["mcpdrift"]);
  assert.equal(parsed.description_coverage, "narrow_or_incomplete");
});

test("Agent Tools Cloud recognizes a complete suite-wide payable listing", () => {
  const prices = expectedResources.map(({ product }) => Number(PRODUCT_CATALOG[product].priceUsd.slice(1)));
  const parsed = parseAgentToolsCloudListing(search, payload({
    description: "Bounty, repository instruction, GitHub Actions CI workflow, and MCP checks",
    resource_count: expectedResources.length,
    resource_samples: expectedResources.map(({ url }) => ({ url, kind: "http" })),
    payment: {
      currency: "USDC",
      chains: ["eip155:8453"],
      pay_to: revenueWallet,
      price_min_usd: Math.min(...prices),
      price_max_usd: Math.max(...prices),
    },
    x402_ok: 1,
  }), options);
  assert.equal(parsed.status, "listed");
  assert.equal(parsed.x402_probe_ok, true);
  assert.equal(parsed.description_coverage, "suite_wide");
});

test("Agent Tools Cloud rejects wrong-wallet, unknown-route, and invalid probe telemetry as contract drift", () => {
  assert.throws(() => parseAgentToolsCloudListing(search, payload({
    payment: { ...payload().payment, pay_to: "0x1111111111111111111111111111111111111111" },
  }), options), AgentToolsCloudContractDrift);
  assert.throws(() => parseAgentToolsCloudListing(search, payload({
    resource_samples: [{ url: "https://attacker.example/api", kind: "http" }],
    resource_count: 1,
  }), options), AgentToolsCloudContractDrift);
  assert.throws(() => parseAgentToolsCloudListing(search, payload({ x402_ok: 2 }), options), AgentToolsCloudContractDrift);
  assert.throws(() => parseAgentToolsCloudListing(search, payload({
    payment: { ...payload().payment, pay_to: 42 },
  }), options), AgentToolsCloudContractDrift);
  assert.throws(() => parseAgentToolsCloudListing(search, payload({
    resource_samples: [null],
    resource_count: 1,
  }), options), AgentToolsCloudContractDrift);
});
