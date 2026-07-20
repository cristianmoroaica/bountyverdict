import test from "node:test";
import assert from "node:assert/strict";
import {
  RunError,
  analyzeRunSnapshot,
  diagnoseGithubRun,
  parseRunUrl,
  redactLogLine,
  type JobLog,
  type RunJob,
} from "../src/run.ts";

const runUrl = "https://github.com/acme/widget/actions/runs/123456789";
const baseRun = {
  id: 123456789,
  run_attempt: 2,
  name: "CI",
  event: "pull_request",
  status: "completed",
  conclusion: "failure",
  head_sha: "0123456789abcdef0123456789abcdef01234567",
  created_at: "2026-07-20T10:00:00Z",
  updated_at: "2026-07-20T10:05:00Z",
};

function job(id: number, name: string, conclusion = "failure", step = "tests"): RunJob {
  return {
    id,
    name,
    status: "completed",
    conclusion,
    html_url: `${runUrl}/job/${id}`,
    steps: [{ number: 1, name: step, status: "completed", conclusion }],
  };
}

function log(body: string): JobLog {
  return { body, bytesRead: new TextEncoder().encode(body).length, truncated: false };
}

test("accepts only canonical public GitHub Actions run URLs", () => {
  assert.deepEqual(parseRunUrl(runUrl), { owner: "acme", repo: "widget", runId: "123456789" });
  for (const value of [
    "http://github.com/acme/widget/actions/runs/1",
    "https://github.com/acme/widget/actions/runs/1/jobs/2",
    "https://github.com/acme/widget/actions/runs/1?attempt=2",
    "https://gitlab.com/acme/widget/actions/runs/1",
  ]) {
    assert.throws(
      () => parseRunUrl(value),
      (error: unknown) => error instanceof RunError && error.code === "INVALID_RUN_URL",
    );
  }
});

test("redacts credentials, signed parameters, and opaque values from evidence", () => {
  const fakeGithubToken = `ghp_${"a".repeat(32)}`;
  const line = redactLogLine(`2026-07-20T10:00:00.000Z Error Bearer secret-token TOKEN=abc123 api_key=lowercase-secret https://logs.example/file?sig=secret ${fakeGithubToken}`);
  assert.match(line, /Bearer \[REDACTED\]/);
  assert.match(line, /TOKEN=\[REDACTED\]/);
  assert.match(line, /api_key=\[REDACTED\]/);
  assert.match(line, /\?\[REDACTED\]/);
  assert.doesNotMatch(line, /secret-token|abc123|lowercase-secret|sig=secret|ghp_/);
});

test("finds timeout evidence in primary jobs and de-prioritizes aggregate failures", () => {
  const jobs = [
    job(1, "Tests shard 1/4"),
    job(2, "Platform result", "failure", "Confirm test shards passed"),
  ];
  const logs = new Map([
    ["1", log("test suite::cache ... FAILED\nError: timed out waiting for server\nCaused by: deadline has elapsed\n##[error]Process completed with exit code 100.")],
  ]);
  const result = analyzeRunSnapshot({ runUrl, repository: "acme/widget", run: baseRun, jobs, logs, selectedLogJobIds: new Set(["1"]) });

  assert.equal(result.verdict, "RETRY");
  assert.equal(result.retryability, "LIKELY");
  assert.equal(result.diagnosis.primary_family, "TIMEOUT");
  assert.equal(result.failed_jobs[0].root_cause_candidate, true);
  assert.equal(result.failed_jobs[1].root_cause_candidate, false);
  assert.equal(result.coverage.logs_scanned, 1);
  assert.ok(result.failed_jobs[0].evidence.some((line) => /timed out/.test(line)));
});

test("recommends a retry only for transient evidence", () => {
  const jobs = [job(1, "network integration")];
  const logs = new Map([["1", log("request failed: ECONNRESET\n##[error]Process completed with exit code 1.")]]);
  const result = analyzeRunSnapshot({ runUrl, repository: "acme/widget", run: baseRun, jobs, logs });
  assert.equal(result.verdict, "RETRY");
  assert.equal(result.retryability, "LIKELY");
  assert.equal(result.diagnosis.primary_family, "NETWORK");
});

test("does not classify successful TLS trace chatter as a network failure", () => {
  const logs = new Map([["1", log("* TLSv1.3 (OUT), TLS handshake, Client hello (1):\ntest result: FAILED. 1 failed")]]);
  const result = analyzeRunSnapshot({ runUrl, repository: "acme/widget", run: baseRun, jobs: [job(1, "tests")], logs });
  assert.equal(result.diagnosis.primary_family, "TEST_FAILURE");
  assert.ok(!result.diagnosis.root_causes.some(({ family }) => family === "NETWORK"));
});

test("does not diagnose an unfinished run or invent failures for a passing run", () => {
  const waiting = analyzeRunSnapshot({
    runUrl,
    repository: "acme/widget",
    run: { ...baseRun, status: "in_progress", conclusion: null },
    jobs: [],
  });
  const passing = analyzeRunSnapshot({
    runUrl,
    repository: "acme/widget",
    run: { ...baseRun, conclusion: "success" },
    jobs: [job(1, "tests", "success")],
  });
  assert.equal(waiting.verdict, "WAIT");
  assert.equal(passing.verdict, "PASS");
  assert.equal(passing.failed_jobs.length, 0);
});

test("remote diagnosis uses the exact attempt, scans only primary failed logs, and rejects private repos", async () => {
  const requested: string[] = [];
  const mock = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    requested.push(url);
    const headers = { "x-ratelimit-remaining": "4990" };
    if (url.endsWith("/repos/acme/widget")) return Response.json({ private: false, full_name: "acme/widget", html_url: "https://github.com/acme/widget" }, { headers });
    if (url.endsWith("/repos/acme/widget/actions/runs/123456789")) return Response.json({ ...baseRun, html_url: runUrl }, { headers });
    if (url.includes("/actions/runs/123456789/attempts/2/jobs?per_page=100")) return Response.json({ total_count: 2, jobs: [job(1, "tests"), job(2, "Full CI results", "failure", "Summarize")] }, { headers });
    if (url.endsWith("/actions/jobs/1/logs")) return new Response(null, {
      status: 302,
      headers: { ...headers, location: "https://productionresultssa0.blob.core.windows.net/results/job.log?sig=signed" },
    });
    if (url.startsWith("https://productionresultssa0.blob.core.windows.net/results/job.log")) {
      assert.equal(new Headers(init?.headers).has("authorization"), false);
      return new Response("test result: FAILED. 1 failed\nAssertionError: expected 2, received 3");
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const result = await diagnoseGithubRun(runUrl, { GITHUB_TOKEN: "server-token" }, mock, new Date("2026-07-20T12:00:00Z"));
  assert.equal(result.verdict, "FIX");
  assert.equal(result.run.attempt, 2);
  assert.equal(result.coverage.failed_jobs_selected_for_logs, 1);
  assert.ok(requested.some((url) => url.includes("/attempts/2/jobs")));
  assert.ok(!requested.some((url) => url.endsWith("/actions/jobs/2/logs")));

  const privateMock = (async (input: URL | RequestInfo) => {
    if (String(input).endsWith("/repos/acme/widget")) return Response.json({ private: true });
    throw new Error("Private repository access continued after the visibility check.");
  }) as typeof fetch;
  await assert.rejects(
    () => diagnoseGithubRun(runUrl, { GITHUB_TOKEN: "server-token" }, privateMock),
    (error: unknown) => error instanceof RunError && error.code === "RUN_NOT_FOUND" && error.status === 404,
  );
});
