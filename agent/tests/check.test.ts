import test from "node:test";
import assert from "node:assert/strict";
import { CheckError, checkGithubIssue } from "../src/check.ts";

const issue = {
  state: "open",
  locked: false,
  active_lock_reason: null,
  updated_at: "2026-07-19T12:00:00Z",
  html_url: "https://github.com/acme/widget/issues/4",
  title: "Fix widget alignment",
  body: "A reproducible and bounded specification with clear current behavior, expected behavior, and acceptance criteria that are long enough.",
  comments: 1,
};

const repository = {
  archived: false,
  pushed_at: "2026-07-19T12:00:00Z",
  html_url: "https://github.com/acme/widget",
  full_name: "acme/widget",
};

function githubMock(comments: unknown[] = [], policy: string | null = null): typeof fetch {
  return async (input) => {
    const url = String(input);
    const headers = { "x-ratelimit-remaining": "4990" };
    if (/\/issues\/4$/.test(url)) return Response.json(issue, { headers });
    if (/\/repos\/acme\/widget$/.test(url)) return Response.json(repository, { headers });
    if (/\/comments\?/.test(url)) return Response.json(comments, { headers });
    if (/\/timeline\?/.test(url)) return Response.json([], { headers });
    if (policy && /\/contents\/CONTRIBUTING\.md$/.test(url)) {
      return Response.json({
        type: "file",
        path: "CONTRIBUTING.md",
        encoding: "base64",
        content: Buffer.from(policy).toString("base64"),
        html_url: "https://github.com/acme/widget/blob/main/CONTRIBUTING.md",
      }, { headers });
    }
    return Response.json({ message: "not found" }, { status: 404, headers });
  };
}

test("returns structured evidence for a viable issue", async () => {
  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    githubMock(),
    new Date("2026-07-20T12:00:00Z"),
  );

  assert.equal(result.verdict, "VIABLE");
  assert.equal(result.issue.repository, "acme/widget");
  assert.equal(result.coverage.comments_scanned, 0);
  assert.equal(result.coverage.policy_documents_scanned, 0);
  assert.equal(result.coverage.github_rate_limit_remaining, 4990);
  assert.ok(result.signals.some((signal) => signal.label === "No linked open PR found"));
});

test("paid check reads repository policy and blocks prohibited AI work", async () => {
  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    githubMock([], "We do not accept contributions generated or assisted by AI or an LLM."),
    new Date("2026-07-20T12:00:00Z"),
  );

  assert.equal(result.verdict, "AVOID");
  assert.equal(result.contribution_policy.ai_use, "BLOCKED");
  assert.equal(result.contribution_policy.documents[0]?.path, "CONTRIBUTING.md");
  assert.equal(result.coverage.policy_documents_scanned, 1);
});

test("returns AVOID when a maintainer rejects AI bounty work", async () => {
  const comments = [{
    body: "Locking this because it only attracts AI slop from bounty hunters.",
    author_association: "MEMBER",
    html_url: "https://github.com/acme/widget/issues/4#issuecomment-1",
    user: { login: "maintainer" },
  }];
  const result = await checkGithubIssue(
    "https://github.com/acme/widget/issues/4",
    {},
    githubMock(comments),
    new Date("2026-07-20T12:00:00Z"),
  );

  assert.equal(result.verdict, "AVOID");
  assert.ok(result.signals.some((signal) => signal.hard_stop));
});

test("rejects a non-issue URL before making an upstream request", async () => {
  let fetched = false;
  const mock = (async () => {
    fetched = true;
    return Response.json({});
  }) as typeof fetch;

  await assert.rejects(
    () => checkGithubIssue("https://github.com/acme/widget/pull/4", {}, mock),
    (error: unknown) => {
      assert.ok(error instanceof CheckError);
      assert.equal(error.code, "INVALID_ISSUE_URL");
      assert.equal(error.status, 400);
      return true;
    },
  );
  assert.equal(fetched, false);
});

test("does not expose private issues through a server credential", async () => {
  const mock = (async (input: URL | RequestInfo) => {
    const url = String(input);
    const headers = { "x-ratelimit-remaining": "4990" };
    if (/\/issues\/4$/.test(url)) return Response.json(issue, { headers });
    if (/\/repos\/acme\/widget$/.test(url)) return Response.json({ ...repository, private: true }, { headers });
    throw new Error(`Unexpected private-repository follow-up request: ${url}`);
  }) as typeof fetch;

  await assert.rejects(
    () => checkGithubIssue("https://github.com/acme/widget/issues/4", { GITHUB_TOKEN: "server-token" }, mock),
    (error: unknown) => error instanceof CheckError && error.code === "ISSUE_NOT_FOUND" && error.status === 404,
  );
});
