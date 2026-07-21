import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitHubPrStatus = {
  url: string;
  http_status?: 200;
  status: "open" | "closed" | "merged" | "request_failed";
  merged_at?: string | null;
  draft?: boolean;
  mergeable?: boolean | null;
  merge_state_status?: string | null;
  review_decision?: string | null;
  error?: string;
};

export type GitHubCliRunner = (args: readonly string[], timeoutMs: number) => Promise<string>;

const defaultRunner: GitHubCliRunner = async (args, timeoutMs) => {
  const { stdout } = await execFileAsync("gh", [...args], {
    timeout: timeoutMs,
    maxBuffer: 1_000_000,
    encoding: "utf8",
  });
  return String(stdout);
};

export async function readGitHubPrStatus(
  owner: string,
  repo: string,
  pull: number,
  url: string,
  timeoutMs: number,
  run: GitHubCliRunner = defaultRunner,
): Promise<GitHubPrStatus> {
  try {
    const stdout = await run([
      "pr", "view", String(pull),
      "--repo", `${owner}/${repo}`,
      "--json", "number,url,state,mergedAt,isDraft,mergeable,mergeStateStatus,reviewDecision",
    ], timeoutMs);
    const payload = JSON.parse(stdout) as {
      number?: number;
      url?: string;
      state?: string;
      mergedAt?: string | null;
      isDraft?: boolean;
      mergeable?: string | null;
      mergeStateStatus?: string | null;
      reviewDecision?: string | null;
    };
    const state = payload.state;
    if (payload.number !== pull || payload.url !== url || !state || !["OPEN", "CLOSED", "MERGED"].includes(state)) {
      throw new Error("GitHub PR telemetry is malformed or identity-mismatched.");
    }
    const mergeable = payload.mergeable === "MERGEABLE"
      ? true
      : payload.mergeable === "CONFLICTING"
        ? false
        : null;
    return {
      url,
      http_status: 200,
      status: payload.mergedAt || state === "MERGED" ? "merged" : state.toLowerCase() as "open" | "closed",
      merged_at: payload.mergedAt || null,
      draft: payload.isDraft === true,
      mergeable,
      merge_state_status: payload.mergeStateStatus || null,
      review_decision: payload.reviewDecision || null,
    };
  } catch (error) {
    return {
      url,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function githubPrFields(review: GitHubPrStatus): Record<string, unknown> {
  return {
    pr_merged_at: review.merged_at || null,
    pr_draft: review.draft === true,
    pr_mergeable: review.mergeable ?? null,
    pr_merge_state_status: review.merge_state_status || null,
    pr_review_decision: review.review_decision || null,
    pr_error: review.error || null,
  };
}
