import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { addHttpMethod } from "./bazaar.ts";

export const exampleVerdict = {
  product: "BountyVerdict",
  version: "1.0",
  verdict: "AVOID",
  score: 0,
  summary: "A public hard stop or severe risk signal makes this issue an unsafe bounty target.",
  issue: {
    url: "https://github.com/typeorm/typeorm/issues/3357",
    title: "Example bounty issue",
    state: "open",
    repository: "typeorm/typeorm",
  },
  signals: [
    {
      label: "Reward withdrawal signal",
      impact: -70,
      detail: "The discussion contains language indicating that a bounty or reward was removed, withdrawn, or cancelled.",
      evidence_url: "https://github.com/typeorm/typeorm/issues/3357",
      hard_stop: true,
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
    comments_scanned: 100,
    timeline_events_scanned: 100,
    linked_pull_requests_found: 12,
    policy_documents_scanned: 1,
    github_rate_limit_remaining: 4994,
  },
  checked_at: "2026-07-20T00:00:00.000Z",
  limitations: [
    "A VIABLE verdict is permission to investigate, not a payout guarantee.",
  ],
};

export const outputSchema = {
  properties: {
    product: { type: "string", const: "BountyVerdict" },
    version: { type: "string" },
    verdict: { type: "string", enum: ["AVOID", "CAUTION", "VIABLE"] },
    score: { type: "integer", minimum: 0, maximum: 100 },
    summary: { type: "string" },
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
        pattern: "^https://github\\.com/[^/]+/[^/]+/issues/[0-9]+(?:[?#].*)?$",
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
}), "GET");
