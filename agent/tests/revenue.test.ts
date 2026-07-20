import test from "node:test";
import assert from "node:assert/strict";
import {
  PORTFOLIO_PAYMENT_ATOMIC,
  SINGLE_PAYMENT_ATOMIC,
  summarizeRevenue,
} from "../src/revenue.ts";

test("revenue summary recognizes only exact product settlements", () => {
  const summary = summarizeRevenue([
    { amount: SINGLE_PAYMENT_ATOMIC, transaction_hash: "0x1", log_index: 0 },
    { amount: PORTFOLIO_PAYMENT_ATOMIC, transaction_hash: "0x2", log_index: 0 },
    { amount: 10_000_000n, transaction_hash: "0x3", log_index: 0 },
  ]);

  assert.equal(summary.recognized_usdc, "0.45");
  assert.equal(summary.remaining_usdc, "999.55");
  assert.equal(summary.progress_percent, 0.045);
  assert.deepEqual(summary.purchases, { single: 1, portfolio: 1, total: 2 });
  assert.equal(summary.unrecognized_transfers.length, 1);
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
