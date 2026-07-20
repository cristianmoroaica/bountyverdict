import { outputSchema, portfolioOutputSchema } from "./discovery.ts";

export function createOpenApi(
  origin: string,
  network: string,
  prices: { single: string; portfolio: string },
) {
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
            price: prices.single,
            currency: "USDC",
          },
        },
      },
      "/api/portfolio/sample": {
        get: {
          summary: "Inspect a representative ranked portfolio without payment",
          operationId: "getBountyPortfolioSample",
          responses: {
            "200": {
              description: "Representative portfolio response",
              content: { "application/json": { schema: { type: "object", ...portfolioOutputSchema } } },
            },
          },
        },
      },
      "/api/portfolio": {
        post: {
          summary: "Rank two to ten GitHub bounty candidates",
          description: "Runs the full evidence-linked preflight on each candidate with concurrency limits, ranks viable work first, and preserves partial results when an upstream issue is unavailable.",
          operationId: "rankBountyPortfolio",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    issue_urls: {
                      type: "array",
                      minItems: 2,
                      maxItems: 10,
                      uniqueItems: true,
                      items: {
                        type: "string",
                        pattern: "^https://github\\.com/[^/]+/[^/]+/issues/[0-9]+(?:[?#].*)?$",
                      },
                    },
                  },
                  required: ["issue_urls"],
                  additionalProperties: false,
                },
                example: {
                  issue_urls: [
                    "https://github.com/acme/widget/issues/12",
                    "https://github.com/typeorm/typeorm/issues/3357",
                  ],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Ranked portfolio after x402 settlement",
              content: { "application/json": { schema: { type: "object", ...portfolioOutputSchema } } },
            },
            "402": { description: "Payment required; inspect the PAYMENT-REQUIRED header" },
            "400": { description: "Invalid portfolio input; verified payment is not settled" },
            "502": { description: "No submitted issue could be checked; verified payment is not settled" },
          },
          "x-x402": {
            version: 2,
            scheme: "exact",
            network,
            price: prices.portfolio,
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
- Free portfolio sample: ${origin}/api/portfolio/sample
- Paid portfolio: POST ${origin}/api/portfolio with {"issue_urls":[...]} for $0.40 USDC
- Portfolio size: 2 to 10 unique public GitHub issue URLs
- Verdicts: AVOID, CAUTION, VIABLE
- Failed or invalid checks are not settled

## Differentiation

BountyVerdict checks up to 300 issue comments, first and newest timeline pages, competing and failed PRs, attempt swarms, issue locks, repository state, explicit maintainer rejection, reward-withdrawal language, and conventional contribution-document paths for AI-work bans or disclosure requirements. Important signals include public evidence URLs and coverage counts.

The portfolio product runs the full check on every submitted candidate, ranks VIABLE before CAUTION before AVOID, recommends the strongest candidate, and reports partial upstream failures.

## Safety

A VIABLE result means investigate further. It does not guarantee a reward, merge, eligibility, or payment.
`;
}
