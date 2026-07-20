import { outputSchema } from "./discovery.ts";

export function createOpenApi(origin: string, network: string, price: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "BountyVerdict Agent API",
      version: "1.0.0",
      description: "Evidence-linked GitHub bounty due diligence for autonomous coding agents. Payment uses x402 v2 and USDC.",
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: origin }],
    paths: {
      "/api/sample": {
        get: {
          summary: "Inspect a representative verdict without payment",
          operationId: "getBountyVerdictSample",
          responses: {
            "200": {
              description: "Representative response",
              content: { "application/json": { schema: { type: "object", ...outputSchema } } },
            },
          },
        },
      },
      "/api/verdict": {
        get: {
          summary: "Deep-preflight a public GitHub bounty issue",
          description: "Checks issue and repository state, competition and failed-attempt swarms, maintainer rejection, reward withdrawal, and official AI-contribution policy. Successful calls cost $0.05 USDC through x402.",
          operationId: "checkBountyVerdict",
          parameters: [{
            name: "issue_url",
            in: "query",
            required: true,
            description: "Canonical public GitHub issue URL",
            schema: {
              type: "string",
              pattern: "^https://github\\.com/[^/]+/[^/]+/issues/[0-9]+(?:[?#].*)?$",
            },
            example: "https://github.com/typeorm/typeorm/issues/3357",
          }],
          responses: {
            "200": {
              description: "Fresh evidence-linked verdict after x402 settlement",
              content: { "application/json": { schema: { type: "object", ...outputSchema } } },
            },
            "402": { description: "Payment required; inspect the PAYMENT-REQUIRED header" },
            "400": { description: "Invalid GitHub issue URL; verified payment is not settled" },
            "502": { description: "GitHub upstream failure; verified payment is not settled" },
            "503": { description: "Temporary capacity or service configuration failure" },
          },
          "x-x402": {
            version: 2,
            scheme: "exact",
            network,
            price,
            currency: "USDC",
          },
        },
      },
    },
  };
}

export function createLlmsText(origin: string): string {
  return `# BountyVerdict

> Evidence-linked GitHub bounty due diligence for autonomous coding agents.

## Decide if this tool is useful

- Free representative result: ${origin}/api/sample
- OpenAPI 3.1 contract: ${origin}/openapi.json
- Paid check: GET ${origin}/api/verdict?issue_url=<PUBLIC_GITHUB_ISSUE_URL>
- Price: $0.05 USDC per successful result through x402 v2
- Verdicts: AVOID, CAUTION, VIABLE
- Failed or invalid checks are not settled

## Differentiation

BountyVerdict checks up to 300 issue comments, first and newest timeline pages, competing and failed PRs, attempt swarms, issue locks, repository state, explicit maintainer rejection, reward-withdrawal language, and conventional contribution-document paths for AI-work bans or disclosure requirements. Important signals include public evidence URLs and coverage counts.

## Safety

A VIABLE result means investigate further. It does not guarantee a reward, merge, eligibility, or payment.
`;
}
