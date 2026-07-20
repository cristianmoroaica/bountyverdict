import assert from "node:assert/strict";
import test from "node:test";
import app from "../src/index.ts";
import { BOUNTY_DISCOVERY_DESCRIPTION } from "../src/discovery.ts";
import { mcpDriftExampleInput } from "../src/mcp-drift-discovery.ts";

const env = {
  PAY_TO_ADDRESS: "0x1111111111111111111111111111111111111111",
  X402_NETWORK: "eip155:84532",
  X402_FACILITATOR_URL: "https://facilitator.invalid",
};

const cases = [
  {
    product: "BountyVerdict",
    url: "/api/verdict?issue_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Fissues%2F1",
    method: "GET",
    decisions: ["AVOID", "CAUTION", "VIABLE"],
    skill: "preflight-github-bounties",
  },
  {
    product: "BountyVerdict Portfolio",
    url: "/api/portfolio",
    method: "POST",
    body: { issue_urls: ["https://github.com/owner/repo/issues/1", "https://github.com/owner/repo/issues/2"] },
    decisions: ["ranked_verdicts", "best_candidate", "counts", "partial_failures"],
    skill: "preflight-github-bounties",
  },
  {
    product: "HarnessVerdict",
    url: "/api/harness?repo_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo",
    method: "GET",
    decisions: ["READY", "REVIEW", "REPAIR"],
    skill: "audit-agent-harness",
  },
  {
    product: "SkillVerdict",
    url: "/api/skill?repo_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo&skill_path=skills%2Fexample",
    method: "GET",
    decisions: ["LOW_RISK", "REVIEW", "BLOCK"],
    skill: "preflight-agent-skills",
  },
  {
    product: "RunVerdict",
    url: "/api/run?run_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Factions%2Fruns%2F1",
    method: "GET",
    decisions: ["PASS", "WAIT", "RETRY", "FIX", "INVESTIGATE"],
    skill: "diagnose-github-actions",
  },
  {
    product: "FlakeVerdict",
    url: "/api/flake?run_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Factions%2Fruns%2F1&attempt=1",
    method: "GET",
    decisions: ["CONFIRMED_FLAKE", "LIKELY_FLAKE", "RECURRING_FAILURE", "NEW_FAILURE", "INCONCLUSIVE", "NOT_FAILED"],
    skill: "classify-github-flakes",
  },
] as const;

for (const preview of cases) {
  test(`${preview.product} unpaid response routes an agent before payment`, async () => {
    const response = await app.request(preview.url, {
      method: preview.method,
      headers: preview.method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body: preview.method === "POST" ? JSON.stringify(preview.body) : undefined,
    }, env);
    assert.equal(response.status, 402);
    const body = await response.json() as any;
    assert.equal(body.error, "PAYMENT_REQUIRED");
    assert.equal(body.product, preview.product);
    assert.ok(body.use_when);
    assert.ok(body.not_for);
    assert.deepEqual(body.decision_returned, preview.decisions);
    assert.ok(body.why_pay);
    assert.match(body.free_sample, /^\/api\//);
    assert.equal(body.skill, `https://cristianmoroaica.github.io/bountyverdict/skills/${preview.skill}/SKILL.md`);
    assert.equal(body.documentation, "https://cristianmoroaica.github.io/bountyverdict/agents.html");
    assert.equal(body.payment.protocol, "x402 v2");
    assert.equal(body.payment.network, "Base");
    assert.equal(body.payment.asset, "USDC");
    assert.equal(body.payment.inspect_challenge_before_signing, true);
    assert.match(body.payment.max_amount_atomic, /^\d+$/);
    assert.equal(body.payment.exact_request.method, preview.method);
    assert.match(body.payment.exact_request.url, new RegExp(preview.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    if (preview.method === "POST") assert.deepEqual(body.payment.exact_request.body, preview.body);
    assert.equal(body.payment.agentic_wallet.executable, "npx");
    assert.deepEqual(body.payment.agentic_wallet.argv.slice(0, 4), [
      "awal@2.12.0",
      "x402",
      "pay",
      body.payment.exact_request.url,
    ]);
    assert.deepEqual(body.payment.agentic_wallet.argv.slice(-3), [
      "--max-amount",
      body.payment.max_amount_atomic,
      "--json",
    ]);
    assert.equal(body.payment.agentic_wallet.execute_as_argument_vector, true);
    assert.equal(body.payment.agentic_wallet.do_not_join_into_shell_string, true);
    assert.equal(body.payment.retry_semantics.payment_header, "Payment-Signature");
    assert.equal(body.payment.retry_semantics.never_raise_max_amount_without_new_authorization, true);
  });
}

test("BountyVerdict challenge leads with exact eligibility and claimability intent", async () => {
  const response = await app.request(
    "/api/verdict?issue_url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Fissues%2F1",
    {},
    env,
  );
  assert.equal(response.status, 402);
  const encoded = response.headers.get("payment-required");
  assert.ok(encoded);
  const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  assert.equal(decoded.resource.description, BOUNTY_DISCOVERY_DESCRIPTION);
  assert.deepEqual(decoded.resource.tags, [
    "github",
    "bounty",
    "eligibility",
    "claimability",
    "already-claimed",
    "assignment-status",
    "due-diligence",
  ]);
});

test("MCPDriftVerdict unpaid response identifies the compatibility boundary", async () => {
  const response = await app.request("/api/mcp-drift", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mcpDriftExampleInput),
  }, env);
  assert.equal(response.status, 402);
  const body = await response.json() as any;
  assert.equal(body.product, "MCPDriftVerdict");
  assert.deepEqual(body.decision_returned, ["UNCHANGED", "SAFE_ADDITIVE", "REVIEW", "INCONCLUSIVE", "BREAKING", "SECURITY_REGRESSION"]);
  assert.match(body.not_for, /Malware or prompt-injection scanning/);
  assert.match(body.payment.request_binding, /exact validated JSON body/);
  assert.deepEqual(body.payment.exact_request.body, mcpDriftExampleInput);
  assert.ok(body.payment.agentic_wallet.argv.includes(JSON.stringify(mcpDriftExampleInput)));
  assert.equal(body.payment.max_amount_atomic, "20000");
  assert.equal(body.skill, "https://cristianmoroaica.github.io/bountyverdict/skills/check-mcp-tool-drift/SKILL.md");
});
