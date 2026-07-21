import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { addHttpMethod } from "./bazaar.ts";
import { SERVICE_REUSE, serviceReuseSchema } from "./reuse.ts";

export const BOUNTY_DISCOVERY_DESCRIPTION =
  "GitHub bounty eligibility and claimability preflight for one public issue before coding. Determines whether it is still open, already assigned or claimed, blocked by linked pull requests, affected by a withdrawn reward or maintainer rejection, crowded by failed attempts, or restricted by repository AI-use rules. Returns AVOID, CAUTION, or VIABLE with public evidence and bounded coverage.";

export const exampleVerdict = {
  product: "BountyVerdict",
  version: "1.0",
  verdict: "AVOID",
  score: 0,
  summary: "A public hard stop or severe risk signal makes this issue an unsafe bounty target.",
  service_reuse: SERVICE_REUSE.single,
  issue: {
    url: "https://github.com/typeorm/typeorm/issues/3357",
    title: "Migration generation drops and creates columns instead of altering resulting in data loss",
    state: "open",
    repository: "typeorm/typeorm",
  },
  signals: [
    {
      label: "Issue is already assigned",
      impact: -70,
      detail: "GitHub currently lists 1 assignee; treat the work as unavailable unless a maintainer explicitly clears parallel work.",
      evidence_url: "https://github.com/typeorm/typeorm/issues/3357",
      hard_stop: true,
    },
    {
      label: "Reward withdrawal signal",
      impact: -70,
      detail: "The discussion contains language indicating that a bounty or reward was removed, withdrawn, or cancelled.",
      evidence_url: "https://github.com/typeorm/typeorm/issues/3357#issuecomment-3845555437",
      hard_stop: true,
    },
    {
      label: "Maintainer rejection signal",
      impact: -60,
      detail: "A maintainer comment contains an explicit rejection, spam, or low-quality-contribution warning.",
      evidence_url: "https://github.com/typeorm/typeorm/issues/3357#issuecomment-4638034647",
      hard_stop: true,
    },
    {
      label: "Discussion is locked",
      impact: -55,
      detail: "The issue is locked for resolved.",
      evidence_url: "https://github.com/typeorm/typeorm/issues/3357",
      hard_stop: true,
    },
    {
      label: "Attempt swarm",
      impact: -12,
      detail: "4 distinct users posted try, attempt, or claim commands.",
      evidence_url: null,
      hard_stop: false,
    },
    {
      label: "Repository is active",
      impact: 10,
      detail: "The repository was pushed to 1 day ago.",
      evidence_url: "https://github.com/typeorm/typeorm",
      hard_stop: false,
    },
    {
      label: "No linked open PR found",
      impact: 10,
      detail: "No open pull request appeared in the first 100 timeline events.",
      evidence_url: null,
      hard_stop: false,
    },
    {
      label: "Issue is open",
      impact: 15,
      detail: "GitHub currently reports this issue as open.",
      evidence_url: "https://github.com/typeorm/typeorm/issues/3357",
      hard_stop: false,
    },
  ],
  contribution_policy: {
    ai_use: "NO_EXPLICIT_RULE_FOUND",
    documents: [
      {
        path: "CONTRIBUTING.md",
        url: "https://github.com/typeorm/typeorm/blob/master/CONTRIBUTING.md",
      },
    ],
  },
  coverage: {
    comments_scanned: 96,
    timeline_events_scanned: 105,
    linked_pull_requests_found: 1,
    policy_documents_scanned: 1,
    github_rate_limit_remaining: 38,
  },
  checked_at: "2026-07-21T20:19:51.393Z",
  limitations: [
    "A VIABLE verdict is permission to investigate, not a payout guarantee.",
    "Confirm current reward terms, payout eligibility, contribution policy, and acceptance criteria before coding.",
    "The check reads at most 300 comments plus the first and newest timeline pages.",
    "AI-policy detection checks four conventional contribution-document paths and may not find policies stored elsewhere.",
  ],
};

export const outputSchema = {
  properties: {
    product: { type: "string", const: "BountyVerdict" },
    version: { type: "string" },
    verdict: { type: "string", enum: ["AVOID", "CAUTION", "VIABLE"] },
    score: { type: "integer", minimum: 0, maximum: 100 },
    summary: { type: "string" },
    service_reuse: serviceReuseSchema,
    issue: {
      type: "object",
      properties: {
        url: { type: "string" },
        title: { type: "string" },
        state: { type: "string" },
        repository: { type: "string" },
      },
      required: ["url", "title", "state", "repository"],
    },
    signals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          impact: { type: "integer" },
          detail: { type: "string" },
          evidence_url: { type: ["string", "null"] },
          hard_stop: { type: "boolean" },
        },
        required: ["label", "impact", "detail", "evidence_url", "hard_stop"],
      },
    },
    contribution_policy: {
      type: "object",
      properties: {
        ai_use: {
          type: "string",
          enum: ["BLOCKED", "DISCLOSURE_REQUIRED", "NO_EXPLICIT_RULE_FOUND"],
        },
        documents: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              url: { type: "string" },
            },
            required: ["path", "url"],
          },
        },
      },
      required: ["ai_use", "documents"],
    },
    coverage: {
      type: "object",
      properties: {
        comments_scanned: { type: "integer", minimum: 0 },
        timeline_events_scanned: { type: "integer", minimum: 0 },
        linked_pull_requests_found: { type: "integer", minimum: 0 },
        policy_documents_scanned: { type: "integer", minimum: 0 },
        github_rate_limit_remaining: { type: ["integer", "null"] },
      },
      required: [
        "comments_scanned",
        "timeline_events_scanned",
        "linked_pull_requests_found",
        "policy_documents_scanned",
        "github_rate_limit_remaining",
      ],
    },
    checked_at: { type: "string" },
    limitations: { type: "array", items: { type: "string" } },
  },
  required: [
    "product",
    "version",
    "verdict",
    "score",
    "summary",
    "service_reuse",
    "issue",
    "signals",
    "contribution_policy",
    "coverage",
    "checked_at",
    "limitations",
  ],
};

export const discoveryExtension = addHttpMethod(declareDiscoveryExtension({
  input: {
    issue_url: "https://github.com/typeorm/typeorm/issues/3357",
  },
  inputSchema: {
    properties: {
      issue_url: {
        type: "string",
        pattern: "^https://github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/issues/[1-9][0-9]*$",
        description: "Canonical URL of a public GitHub issue to preflight before an agent starts work.",
      },
    },
    required: ["issue_url"],
    additionalProperties: false,
  },
  output: {
    example: exampleVerdict,
    schema: outputSchema,
  },
  bodyType: "json",
}), "POST");

const portfolioAssignedVerdict = {
  product: "BountyVerdict",
  version: "1.0",
  verdict: "AVOID",
  score: 23,
  summary: "A public hard stop or severe risk signal makes this issue an unsafe bounty target.",
  service_reuse: SERVICE_REUSE.single,
  issue: {
    url: "https://github.com/tenstorrent/tt-metal/issues/50522",
    title: "[Bounty $1500] ModernBERT bring up using TTNN APIs",
    state: "open",
    repository: "tenstorrent/tt-metal",
  },
  signals: [
    {
      label: "Issue is already assigned",
      impact: -70,
      detail: "GitHub currently lists 1 assignee; treat the work as unavailable unless a maintainer explicitly clears parallel work.",
      evidence_url: "https://github.com/tenstorrent/tt-metal/issues/50522",
      hard_stop: true,
    },
    {
      label: "Issue is current",
      impact: 8,
      detail: "The issue changed 0 days ago.",
      evidence_url: "https://github.com/tenstorrent/tt-metal/issues/50522",
      hard_stop: false,
    },
    {
      label: "Repository is active",
      impact: 10,
      detail: "The repository was pushed to 0 days ago.",
      evidence_url: "https://github.com/tenstorrent/tt-metal",
      hard_stop: false,
    },
    {
      label: "No linked open PR found",
      impact: 10,
      detail: "No open pull request appeared in the first 100 timeline events.",
      evidence_url: null,
      hard_stop: false,
    },
    {
      label: "Issue is open",
      impact: 15,
      detail: "GitHub currently reports this issue as open.",
      evidence_url: "https://github.com/tenstorrent/tt-metal/issues/50522",
      hard_stop: false,
    },
  ],
  contribution_policy: {
    ai_use: "NO_EXPLICIT_RULE_FOUND",
    documents: [
      {
        path: "CONTRIBUTING.md",
        url: "https://github.com/tenstorrent/tt-metal/blob/main/CONTRIBUTING.md",
      },
      {
        path: ".github/pull_request_template.md",
        url: "https://github.com/tenstorrent/tt-metal/blob/main/.github/pull_request_template.md",
      },
    ],
  },
  coverage: {
    comments_scanned: 3,
    timeline_events_scanned: 19,
    linked_pull_requests_found: 0,
    policy_documents_scanned: 2,
    github_rate_limit_remaining: 40,
  },
  checked_at: "2026-07-21T20:19:51.393Z",
  limitations: [
    "A VIABLE verdict is permission to investigate, not a payout guarantee.",
    "Confirm current reward terms, payout eligibility, contribution policy, and acceptance criteria before coding.",
    "The check reads at most 300 comments plus the first and newest timeline pages.",
    "AI-policy detection checks four conventional contribution-document paths and may not find policies stored elsewhere.",
  ],
};

export const portfolioExample = {
  product: "BountyVerdict Portfolio",
  version: "1.0",
  recommendation: "Do not start any submitted bounty; every successfully checked candidate ranked AVOID.",
  service_reuse: SERVICE_REUSE.portfolio,
  best_candidate: null,
  counts: { submitted: 2, checked: 2, viable: 0, caution: 0, avoid: 2, failed: 0 },
  ranked: [portfolioAssignedVerdict, exampleVerdict],
  failures: [],
  checked_at: "2026-07-21T20:19:51.393Z",
};

export const portfolioOutputSchema = {
  properties: {
    product: { type: "string", const: "BountyVerdict Portfolio" },
    version: { type: "string" },
    recommendation: { type: "string" },
    service_reuse: serviceReuseSchema,
    best_candidate: { type: ["string", "null"] },
    counts: {
      type: "object",
      properties: {
        submitted: { type: "integer", minimum: 2, maximum: 10 },
        checked: { type: "integer", minimum: 1, maximum: 10 },
        viable: { type: "integer", minimum: 0 },
        caution: { type: "integer", minimum: 0 },
        avoid: { type: "integer", minimum: 0 },
        failed: { type: "integer", minimum: 0 },
      },
      required: ["submitted", "checked", "viable", "caution", "avoid", "failed"],
    },
    ranked: {
      type: "array",
      minItems: 1,
      items: { type: "object", ...outputSchema },
    },
    failures: {
      type: "array",
      items: {
        type: "object",
        properties: {
          issue_url: { type: "string" },
          error: {
            type: "object",
            properties: { code: { type: "string" }, message: { type: "string" } },
            required: ["code", "message"],
          },
        },
        required: ["issue_url", "error"],
      },
    },
    checked_at: { type: "string" },
  },
  required: [
    "product",
    "version",
    "recommendation",
    "service_reuse",
    "best_candidate",
    "counts",
    "ranked",
    "failures",
    "checked_at",
  ],
};

export const portfolioDiscoveryExtension = addHttpMethod(declareDiscoveryExtension({
  bodyType: "json",
  input: {
    issue_urls: [
      "https://github.com/acme/widget/issues/12",
      "https://github.com/typeorm/typeorm/issues/3357",
    ],
  },
  inputSchema: {
    properties: {
      issue_urls: {
        type: "array",
        minItems: 2,
        maxItems: 10,
        uniqueItems: true,
        description: "Two to ten canonical public GitHub issue URLs to compare and rank.",
        items: {
          type: "string",
          pattern: "^https://github\\.com/[^/]+/[^/]+/issues/[0-9]+([?#].*)?$",
        },
      },
    },
    required: ["issue_urls"],
    additionalProperties: false,
  },
  output: {
    example: portfolioExample,
    schema: portfolioOutputSchema,
  },
}), "POST");
