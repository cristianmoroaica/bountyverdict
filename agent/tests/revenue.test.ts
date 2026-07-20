import test from "node:test";
import assert from "node:assert/strict";
import {
  KNOWN_NON_REVENUE_TX_HASHES,
  HARNESS_PAYMENT_ATOMIC,
  SKILL_PAYMENT_ATOMIC,
  PORTFOLIO_PAYMENT_ATOMIC,
  SINGLE_PAYMENT_ATOMIC,
  summarizeRevenue,
} from "../src/revenue.ts";

test("revenue summary recognizes only exact product settlements", () => {
  const summary = summarizeRevenue([
    { amount: SINGLE_PAYMENT_ATOMIC, transaction_hash: "0x1", log_index: 0 },
    { amount: PORTFOLIO_PAYMENT_ATOMIC, transaction_hash: "0x2", log_index: 0 },
    { amount: HARNESS_PAYMENT_ATOMIC, transaction_hash: "0x4", log_index: 0 },
    { amount: SKILL_PAYMENT_ATOMIC, transaction_hash: "0x5", log_index: 0 },
    { amount: 10_000_000n, transaction_hash: "0x3", log_index: 0 },
  ]);

  assert.equal(summary.recognized_usdc, "0.54");
  assert.equal(summary.remaining_usdc, "999.46");
  assert.equal(summary.progress_percent, 0.054);
  assert.deepEqual(summary.purchases, { single: 1, portfolio: 1, harness: 1, skill: 1, total: 4 });
  assert.equal(summary.unrecognized_transfers.length, 1);
  assert.equal(summary.excluded_transfers.length, 0);
});

test("revenue summary excludes the owner-funded production proofs", () => {
  const proofAmounts = [SINGLE_PAYMENT_ATOMIC, PORTFOLIO_PAYMENT_ATOMIC, HARNESS_PAYMENT_ATOMIC];
  const proofs = KNOWN_NON_REVENUE_TX_HASHES.map((transaction_hash, index) => ({
    amount: proofAmounts[index]!,
    transaction_hash,
    log_index: index,
  }));
  const customer = {
    amount: SINGLE_PAYMENT_ATOMIC,
    transaction_hash: "0xcustomer",
    log_index: 1,
  };
  const summary = summarizeRevenue([...proofs, customer]);

  assert.equal(summary.recognized_usdc, "0.05");
  assert.deepEqual(summary.purchases, { single: 1, portfolio: 0, harness: 0, skill: 0, total: 1 });
  assert.deepEqual(summary.excluded_transfers, proofs);
  assert.deepEqual(summary.recognized_transfers, [customer]);
});

test("revenue progress stops at zero remaining after the target", () => {
  const transfers = Array.from({ length: 2_500 }, (_, index) => ({
    amount: PORTFOLIO_PAYMENT_ATOMIC,
    transaction_hash: `0x${index}`,
    log_index: 0,
  }));
  const summary = summarizeRevenue(transfers);

  assert.equal(summary.recognized_usdc, "1000");
  assert.equal(summary.remaining_usdc, "0");
  assert.equal(summary.progress_percent, 100);
});
