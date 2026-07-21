import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCT_CATALOG,
  PRODUCT_KEYS,
  productForAtomicAmount,
  productForTransport,
} from "../src/product-catalog.ts";

test("product catalog has unique service, route, sample, and accounting price", () => {
  for (const field of ["service", "path", "samplePath", "priceUsd", "amountAtomic"] as const) {
    const values = PRODUCT_KEYS.map(product => PRODUCT_CATALOG[product][field]);
    assert.equal(new Set(values).size, values.length, `${field} must remain unique`);
  }
});

test("canonical POST and legacy GET transports remain one BountyVerdict product", () => {
  assert.equal(PRODUCT_CATALOG.single.path, "/api/bounty-preflight");
  assert.equal(PRODUCT_CATALOG.single.method, "POST");
  assert.equal(productForTransport("/api/bounty-preflight", "POST"), "single");
  assert.equal(productForTransport("/api/verdict", "GET"), "single");
  assert.equal(productForTransport("/api/bounty-preflight", "GET"), null);
  assert.equal(productForTransport("/api/verdict", "POST"), null);
  assert.equal(productForTransport("/api/bounty-preflight", "PUT"), null);
});

test("product catalog preserves all public payment contracts", () => {
  assert.deepEqual(PRODUCT_KEYS, ["single", "portfolio", "harness", "skill", "run", "flake", "mcpdrift"]);
  assert.equal(productForAtomicAmount(50_000n), "single");
  assert.equal(productForAtomicAmount(400_000n), "portfolio");
  assert.equal(productForAtomicAmount(30_000n), "harness");
  assert.equal(productForAtomicAmount(60_000n), "skill");
  assert.equal(productForAtomicAmount(40_000n), "run");
  assert.equal(productForAtomicAmount(70_000n), "flake");
  assert.equal(productForAtomicAmount(20_000n), "mcpdrift");
  assert.equal(productForAtomicAmount(1n), null);
});
