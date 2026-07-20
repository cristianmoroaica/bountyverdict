# Live market validation

Checked against the Coinbase x402 Bazaar semantic-search API on 2026-07-20.

## Demand signal

The catalog already contains paid GitHub intelligence, repository-health, developer-research, agent-risk, and bounty services. This confirms that agents are buying narrow decision tools rather than only generic data feeds.

## Direct competition

`Bounty Truth` at `https://sparky-works.vercel.app/api/bounty-truth` advertises a $0.05 GitHub-bounty audit covering stale status, competing pull requests, claimant signals, and solver saturation.

BountyVerdict therefore launches at the same $0.05 price and must win on decision quality, not novelty. Its declared differentiation is:

- up to 300 issue comments rather than a shallow issue-only check;
- first and newest timeline pages;
- explicit maintainer rejection and AI-slop warnings;
- withdrawn or cancelled reward language;
- closed-PR and distinct-attempt swarms;
- repository lock, archive, staleness, and specification depth;
- official contribution-document checks for AI-work bans and disclosure rules;
- per-signal evidence URLs and explicit coverage counts.

## Pricing decision

The original $0.25 price was rejected after observing the live catalog. Comparable single-purpose developer and risk APIs generally advertise roughly $0.002-$0.05 per call, while composite high-consequence diligence can charge more. BountyVerdict starts at $0.05 to remove price as a reason to choose the weaker direct competitor.

Price can rise only after settlement history, repeat usage, or measured avoided-cost evidence justifies it.

## Portfolio product

The direct competitor sells one audit at a time. BountyVerdict also offers a $0.40 portfolio decision that runs the full preflight on 2–10 candidates, ranks the results, recommends the strongest non-AVOID option, and preserves partial failures. At the maximum size it costs $0.04 per candidate while saving an agent the orchestration work of buying, validating, and sorting ten independent responses.

This is the primary revenue product: reaching $1,000 requires 2,500 portfolio purchases instead of 20,000 single checks. The single endpoint remains the low-friction trial and narrow-use option.

## HarnessVerdict expansion

Exact Coinbase Bazaar searches for `AGENTS.md CLAUDE.md GEMINI.md repository instructions lint`, `agent context file audit nested instructions`, and `skill frontmatter validator SKILL.md` returned no matching paid resources on 2026-07-20. Generic visibility and x402 service audits were present, but they audit seller discovery rather than a source repository's coding-agent guidance.

The broader market contains capable local tools such as [agentlint](https://agentlint.sh/) and [ctxlint](https://www.npmjs.com/package/@ctxlint/ctxlint), confirming demand while making a shallow linter clone uncompetitive. HarnessVerdict instead provides a remote x402-native preflight that requires no checkout or package installation, pins evidence to a commit SHA, and returns a bounded machine-readable contract for another agent.

Public issue demand is also concrete: OpenAI Codex and Anthropic Claude Code issue trackers contain hundreds of discussions mentioning `AGENTS.md` or `CLAUDE.md`, including recurring discovery, scope, portability, and cross-client support failures. The launch price is $0.03 because the audit saves an agent a repository checkout and multi-file inspection while remaining deterministic and inexpensive to compute.

## SkillVerdict expansion

Exact Bazaar searches for agent-skill security, malicious `SKILL.md` preflight, prompt-injection scripts, and cross-agent skill supply-chain safety returned no paid matching resource on 2026-07-20.

The risk is current and measurable. The 2026 report [Exploring the Emerging Threats of the Agent Skill Ecosystem](https://arxiv.org/abs/2605.28588) analyzed 3,984 skills and reported confirmed malicious payloads, credential theft, backdoors, and exfiltration. [Malicious Or Not](https://arxiv.org/abs/2603.16572) shows why repository context matters: skill-text-only scanners can produce extreme false-positive rates. [Snyk Agent Scan](https://github.com/snyk/agent-scan) further validates prompt injection, credential handling, hardcoded secrets, and malware payloads as operational skill risks.

SkillVerdict is not a replacement for those local or enterprise scanners. Its distinct buyer value is an account-free, non-executing, x402-native audit that an autonomous agent can purchase before installation, using the whole bounded skill directory and repository context at an immutable commit. It launches at $0.06 so its settlements remain distinguishable from the $0.05 bounty product in the public on-chain revenue ledger.
