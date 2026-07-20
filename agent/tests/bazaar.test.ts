import test from "node:test";
import assert from "node:assert/strict";
import { validateDiscoveryExtension, validateDiscoveryExtensionSpec } from "@x402/extensions/bazaar";
import { discoveryExtension, portfolioDiscoveryExtension } from "../src/discovery.ts";

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
