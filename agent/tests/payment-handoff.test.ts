import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPaymentHandoff,
  exactRestRequestForProduct,
} from "../src/payment-handoff.ts";

const origin = "https://bountyverdict-agent-production.mimirslab.workers.dev";

test("canonical migrated products use exact POST bodies without query leakage", () => {
  assert.deepEqual(exactRestRequestForProduct(origin, "harness", {
    repo_url: "https://github.com/openai/codex",
  }), {
    method: "POST",
    url: `${origin}/api/repository-agent-instructions-audit`,
    body: { repo_url: "https://github.com/openai/codex" },
  });
  assert.deepEqual(exactRestRequestForProduct(origin, "run", {
    run_url: "https://github.com/openai/codex/actions/runs/29728148711",
  }), {
    method: "POST",
    url: `${origin}/api/github-actions-run-diagnosis`,
    body: { run_url: "https://github.com/openai/codex/actions/runs/29728148711" },
  });
  assert.deepEqual(exactRestRequestForProduct(origin, "flake", {
    run_url: "https://github.com/actions/runner/actions/runs/29423388605",
    attempt: 1,
  }), {
    method: "POST",
    url: `${origin}/api/github-actions-flake-retry-gate`,
    body: {
      run_url: "https://github.com/actions/runner/actions/runs/29423388605",
      attempt: 1,
    },
  });
});

test("canonical POST handoffs disclose advisory body hashes and pinned awal argv", async () => {
  for (const [product, args, expectedBody] of [
    ["harness", { repo_url: "https://github.com/openai/codex" }, { repo_url: "https://github.com/openai/codex" }],
    ["run", { run_url: "https://github.com/openai/codex/actions/runs/29728148711" }, { run_url: "https://github.com/openai/codex/actions/runs/29728148711" }],
    ["flake", { run_url: "https://github.com/actions/runner/actions/runs/29423388605", attempt: 1 }, {
      run_url: "https://github.com/actions/runner/actions/runs/29423388605",
      attempt: 1,
    }],
  ] as const) {
    const request = exactRestRequestForProduct(origin, product, args);
    const handoff = await buildPaymentHandoff(request, "70000");
    assert.equal(handoff.authorization_scope, "resource_url_not_post_body");
    assert.deepEqual(handoff.exact_request.body, expectedBody);
    assert.match(handoff.exact_request.normalized_body_sha256 || "", /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(handoff.agentic_wallet.argv, [
      "awal@2.12.0",
      "x402",
      "pay",
      request.url,
      "-X",
      "POST",
      "-d",
      JSON.stringify(expectedBody),
      "--max-amount",
      "70000",
      "--json",
    ]);
  }
});

test("flake handoff rejects invalid attempts before any payment request is built", () => {
  assert.throws(() => exactRestRequestForProduct(origin, "flake", {
    run_url: "https://github.com/actions/runner/actions/runs/29423388605",
    attempt: 0,
  }), /Invalid normalized attempt/);
});
