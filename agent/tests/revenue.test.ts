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
  assert.equal(summary.excluded_transfers.length, 0);
});

test("revenue summary excludes the owner-funded production proof", () => {
  const proof = {
    amount: SINGLE_PAYMENT_ATOMIC,
    transaction_hash: "0x6d308dcf6a53aae946b3a5ee55ab5afab8579acfbde7147fa18734ebb11fc7d4",
    log_index: 330,
  };
  const customer = {
    amount: SINGLE_PAYMENT_ATOMIC,
    transaction_hash: "0xcustomer",
    log_index: 1,
  };
  const summary = summarizeRevenue([proof, customer]);

  assert.equal(summary.recognized_usdc, "0.05");
  assert.deepEqual(summary.purchases, { single: 1, portfolio: 0, total: 1 });
  assert.deepEqual(summary.excluded_transfers, [proof]);
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
