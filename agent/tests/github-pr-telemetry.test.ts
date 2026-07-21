import assert from "node:assert/strict";
import test from "node:test";
import { githubPrFields, readGitHubPrStatus, type GitHubCliRunner } from "../src/github-pr-telemetry.ts";

const url = "https://github.com/example/catalog/pull/42";

test("authenticated GitHub PR telemetry validates identity and retains review state", async () => {
  let receivedArgs: readonly string[] = [];
  let receivedTimeout = 0;
  const run: GitHubCliRunner = async (args, timeoutMs) => {
    receivedArgs = args;
    receivedTimeout = timeoutMs;
    return JSON.stringify({
      number: 42,
      url,
      state: "OPEN",
      mergedAt: null,
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "BEHIND",
      reviewDecision: "REVIEW_REQUIRED",
    });
  };
  const result = await readGitHubPrStatus("example", "catalog", 42, url, 12_345, run);

  assert.deepEqual(receivedArgs, [
    "pr", "view", "42", "--repo", "example/catalog", "--json",
    "number,url,state,mergedAt,isDraft,mergeable,mergeStateStatus,reviewDecision",
  ]);
  assert.equal(receivedTimeout, 12_345);
  assert.deepEqual(result, {
    url,
    http_status: 200,
    status: "open",
    merged_at: null,
    draft: false,
    mergeable: true,
    merge_state_status: "BEHIND",
    review_decision: "REVIEW_REQUIRED",
  });
  assert.deepEqual(githubPrFields(result), {
    pr_merged_at: null,
    pr_draft: false,
    pr_mergeable: true,
    pr_merge_state_status: "BEHIND",
    pr_review_decision: "REVIEW_REQUIRED",
    pr_error: null,
  });
});

test("GitHub PR telemetry fails closed on malformed, mismatched, and unavailable CLI output", async () => {
  const cases: GitHubCliRunner[] = [
    async () => "not-json",
    async () => JSON.stringify({ number: 41, url, state: "OPEN" }),
    async () => JSON.stringify({ number: 42, url, state: "UNKNOWN" }),
    async () => { throw new Error("gh auth required"); },
    async () => { throw new Error("spawn gh ENOENT"); },
    async () => { throw new Error("Command timed out"); },
  ];
  for (const run of cases) {
    const result = await readGitHubPrStatus("example", "catalog", 42, url, 1, run);
    assert.equal(result.status, "request_failed");
    assert.equal(typeof result.error, "string");
    assert.ok(result.error.length > 0);
    assert.equal(githubPrFields(result).pr_error, result.error);
  }
});
