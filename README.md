# BountyVerdict

[![CI](https://github.com/cristianmoroaica/bountyverdict/actions/workflows/ci.yml/badge.svg)](https://github.com/cristianmoroaica/bountyverdict/actions/workflows/ci.yml)

Know before you code.

BountyVerdict checks whether a public GitHub bounty issue is still worth investigating. It catches failure modes that shallow bounty boards miss:

- closed or locked issues;
- archived or stale repositories;
- linked open pull requests;
- closed-PR and attempt swarms;
- explicit maintainer rejection or spam warnings;
- comments indicating a withdrawn or cancelled reward.

Every important result links back to public GitHub evidence. The tool does not guarantee that a reward exists, that work will be merged, or that anyone will pay.

## Use it

Visit [BountyVerdict](https://cristianmoroaica.github.io/bountyverdict/) and paste a public GitHub issue URL.

No account, token, backend, analytics, or data storage is used. Your browser makes read-only requests directly to GitHub's public API.

## Agent API

The `agent/` directory contains the paid, machine-readable product surface. It is a Cloudflare Worker with four x402-protected products: a **$0.05 USDC** fresh bounty verdict, a **$0.40 USDC** portfolio that ranks 2–10 candidates, a **$0.03 USDC HarnessVerdict** audit for repository coding-agent instructions, and a **$0.06 USDC SkillVerdict** pre-install security audit. All declare strict input/output schemas through the Bazaar discovery extension.

Agents can inspect free samples, see exact prices in the HTTP 402 response, then independently decide whether to buy. Invalid inputs and upstream failures return an error without settlement. The public [`agent-manifest.json`](agent-manifest.json) is the authoritative activation record. Guarded purchase workflows live under [`skills/`](skills/).

The bounty contracts were exercised end to end on Base Sepolia and Base mainnet. The production manifest is active and Coinbase Bazaar indexes the live resources. Owner-funded launch proofs are interoperability tests, not earned revenue, and are explicitly excluded from the revenue ledger.

HarnessVerdict pins the repository default branch to an immutable commit and audits recognized `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Copilot, Cursor, and `SKILL.md` surfaces without cloning or executing repository code. It reports evidence-linked path, scope, portability, context-budget, skill-frontmatter, and secret-like-material findings.

SkillVerdict pins and statically scans a requested public skill directory without executing it. It combines high-confidence dangerous-pattern checks with repository context, capability disclosure, external-domain inventory, secret redaction, and explicit coverage to reduce both missed supply-chain hazards and naive false positives.

See [`agent/README.md`](agent/README.md) for the protocol, local verification, and deployment configuration.

The launch price and differentiation are grounded in a live Bazaar comparison documented in [`docs/MARKET_VALIDATION.md`](docs/MARKET_VALIDATION.md). Agents and crawlers can read [`llms.txt`](llms.txt) before deciding whether the product is relevant.

## Run locally

```bash
npm run serve
```

Open `http://localhost:4174`.

## Test

```bash
npm test
```

## Method and limits

The score is deliberately conservative and deterministic. BountyVerdict currently reads up to 300 issue comments and the first and newest timeline pages. Very large threads may contain additional evidence it does not see. Anonymous GitHub API rate limits apply.

Treat a `VIABLE` verdict as permission to investigate further—not permission to start coding. Reproduce the issue, read contribution and AI-use policies, confirm reward terms and payout eligibility, and establish acceptance criteria first.

## License

MIT
