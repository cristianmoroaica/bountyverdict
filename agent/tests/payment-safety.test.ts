import test from "node:test";
import assert from "node:assert/strict";
import { validatePaymentChallenge } from "../src/payment-safety.ts";

function challenge(amount: string, network = "eip155:84532") {
  return { accepts: [{ amount, network, asset: "0xasset", payTo: "0xrecipient" }] };
}

test("payment safety enforces the atomic price cap", () => {
  assert.throws(
    () => validatePaymentChallenge(challenge("50001"), {
      maximumAtomic: 50_000n,
      executePayment: true,
      allowMainnet: false,
    }),
    /exceeds safety cap/,
  );
});

test("mainnet can be inspected but cannot be paid accidentally", () => {
  assert.equal(validatePaymentChallenge(challenge("50000", "eip155:8453"), {
    maximumAtomic: 50_000n,
    executePayment: false,
    allowMainnet: false,
  }).network, "eip155:8453");

  assert.throws(
    () => validatePaymentChallenge(challenge("50000", "eip155:8453"), {
      maximumAtomic: 50_000n,
      executePayment: true,
      allowMainnet: false,
    }),
    /Mainnet payment refused/,
  );
});
