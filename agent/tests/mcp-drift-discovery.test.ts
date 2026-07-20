import test from "node:test";
import assert from "node:assert/strict";
import { validateDiscoveryExtension, validateDiscoveryExtensionSpec } from "@x402/extensions/bazaar";
import { readFile } from "node:fs/promises";
import { analyzeMcpDrift } from "../src/mcp-drift.ts";
import {
  mcpDriftDiscoveryExtension,
  mcpDriftExample,
  mcpDriftExampleInput,
  mcpDriftInputSchema,
  mcpDriftOutputSchema,
} from "../src/mcp-drift-discovery.ts";

test("MCPDriftVerdict publishes bounded POST discovery metadata", () => {
  const extension = mcpDriftDiscoveryExtension.bazaar;
  assert.equal(extension.info.input.method, "POST");
  assert.equal(extension.info.input.bodyType, "json");
  assert.deepEqual(validateDiscoveryExtensionSpec(extension), { valid: true });
  assert.deepEqual(validateDiscoveryExtension(extension), { valid: true });
  assert.ok(JSON.stringify(mcpDriftDiscoveryExtension).length < 7_000);
});

test("full contracts stay strict while catalog schemas remain opaque bounded data", () => {
  assert.equal(mcpDriftInputSchema.additionalProperties, false);
  assert.equal(mcpDriftInputSchema.properties.baseline.additionalProperties, false);
  assert.equal(mcpDriftInputSchema.properties.current.properties.tools.maxItems, 128);
  assert.equal(mcpDriftOutputSchema.additionalProperties, false);
  assert.equal(mcpDriftOutputSchema.properties.findings.maxItems, 256);
  assert.deepEqual(mcpDriftOutputSchema.properties.verdict.enum, [
    "UNCHANGED", "SAFE_ADDITIVE", "REVIEW", "INCONCLUSIVE", "BREAKING", "SECURITY_REGRESSION",
  ]);
});

test("the representative result is produced by the published representative request", async () => {
  assert.deepEqual(await analyzeMcpDrift(mcpDriftExampleInput), mcpDriftExample);
  const sample = JSON.parse(await readFile(new URL("../../samples/mcp-drift.json", import.meta.url), "utf8"));
  assert.deepEqual(sample, mcpDriftExample);
});
