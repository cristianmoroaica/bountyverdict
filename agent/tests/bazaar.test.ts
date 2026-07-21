import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateDiscoveryExtension, validateDiscoveryExtensionSpec } from "@x402/extensions/bazaar";
import {
  discoveryExtension,
  exampleVerdict,
  portfolioDiscoveryExtension,
  portfolioExample,
} from "../src/discovery.ts";
import { harnessDiscoveryExtension } from "../src/harness-discovery.ts";
import { skillDiscoveryExtension } from "../src/skill-discovery.ts";
import { runDiscoveryExtension } from "../src/run-discovery.ts";
import { flakeDiscoveryExtension } from "../src/flake-discovery.ts";
import app from "../src/index.ts";

const crawlerEnv = {
  PAY_TO_ADDRESS: "0x1111111111111111111111111111111111111111",
  X402_NETWORK: "eip155:84532",
  X402_FACILITATOR_URL: "https://facilitator.invalid",
  FLAKE_RATE_LIMITER: { limit: async () => ({ success: true }) },
};

test("build-time method enrichment creates valid Bazaar metadata", () => {
  const extension = discoveryExtension.bazaar;

  assert.equal(extension.info.input.method, "GET");
  assert.deepEqual(validateDiscoveryExtensionSpec(extension), { valid: true });
  assert.deepEqual(validateDiscoveryExtension(extension), { valid: true });
});

test("portfolio POST declaration passes Bazaar schema and protocol validation", () => {
  const extension = portfolioDiscoveryExtension.bazaar;
  assert.equal(extension.info.input.method, "POST");
  assert.equal(extension.info.input.bodyType, "json");
  assert.deepEqual(validateDiscoveryExtensionSpec(extension), { valid: true });
  assert.deepEqual(validateDiscoveryExtension(extension), { valid: true });
});

test("public bounty samples exactly match the real evidence snapshots advertised to agents", async () => {
  const [single, portfolio] = await Promise.all([
    readFile(new URL("../../samples/verdict.json", import.meta.url), "utf8"),
    readFile(new URL("../../samples/portfolio.json", import.meta.url), "utf8"),
  ]);
  assert.deepEqual(JSON.parse(single), exampleVerdict);
  assert.deepEqual(JSON.parse(portfolio), portfolioExample);
  assert.match(exampleVerdict.issue.title, /Migration generation drops and creates columns/);
  assert.equal(portfolioExample.best_candidate, "https://github.com/tenstorrent/tt-metal/issues/50522");
  assert.deepEqual(portfolioExample.counts, {
    submitted: 2,
    checked: 2,
    viable: 1,
    caution: 0,
    avoid: 1,
    failed: 0,
  });
});

test("HarnessVerdict GET declaration passes Bazaar schema and protocol validation", () => {
  const extension = harnessDiscoveryExtension.bazaar;
  assert.equal(extension.info.input.method, "GET");
  assert.deepEqual(validateDiscoveryExtensionSpec(extension), { valid: true });
  assert.deepEqual(validateDiscoveryExtension(extension), { valid: true });
});

test("SkillVerdict GET declaration passes Bazaar schema and protocol validation", () => {
  const extension = skillDiscoveryExtension.bazaar;
  assert.equal(extension.info.input.method, "GET");
  assert.deepEqual(validateDiscoveryExtensionSpec(extension), { valid: true });
  assert.deepEqual(validateDiscoveryExtension(extension), { valid: true });
});

test("RunVerdict GET declaration passes Bazaar schema and protocol validation", () => {
  const extension = runDiscoveryExtension.bazaar;
  assert.equal(extension.info.input.method, "GET");
  assert.deepEqual(validateDiscoveryExtensionSpec(extension), { valid: true });
  assert.deepEqual(validateDiscoveryExtension(extension), { valid: true });
});

test("FlakeVerdict GET declaration passes Bazaar schema and protocol validation", () => {
  const extension = flakeDiscoveryExtension.bazaar;
  assert.equal(extension.info.input.method, "GET");
  assert.deepEqual(validateDiscoveryExtensionSpec(extension), { valid: true });
  assert.deepEqual(validateDiscoveryExtension(extension), { valid: true });
});

test("every advertised GET example survives preflight and returns a payable crawler challenge", async () => {
  const routes = [
    ["/api/verdict", discoveryExtension],
    ["/api/harness", harnessDiscoveryExtension],
    ["/api/skill", skillDiscoveryExtension],
    ["/api/run", runDiscoveryExtension],
    ["/api/flake", flakeDiscoveryExtension],
  ] as const;
  for (const [path, declaration] of routes) {
    const input = declaration.bazaar.info.input;
    assert.equal(input.method, "GET");
    assert.ok(input.queryParams && Object.keys(input.queryParams).length > 0);
    const query = new URLSearchParams(Object.entries(input.queryParams).map(([key, value]) => [key, String(value)]));
    const response = await app.request(`${path}?${query}`, {}, crawlerEnv);
    assert.equal(response.status, 402, `${path} must challenge the exact advertised Bazaar input`);
    assert.ok(response.headers.get("payment-required"));
  }
});
