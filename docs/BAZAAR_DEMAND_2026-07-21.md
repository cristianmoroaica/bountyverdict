# Agent-product demand snapshot — 2026-07-21

This snapshot answers a narrow question: which agent-native products currently show the strongest paid-use signals, and what should BountyVerdict learn from them?

It does **not** call a catalog rank, listing, HTTP hit, or seller-to-self settlement a customer purchase. BountyVerdict's own purchase ledger remains based only on reconciled non-owner Base settlements.

## Evidence and limitations

The primary dataset is the Coinbase CDP Bazaar Base catalog captured at `2026-07-21T17:56:28Z` with the pinned wallet CLI:

```bash
npx awal@2.12.0 x402 bazaar list --network base --full --refresh --json
```

[Coinbase documents Bazaar quality](https://docs.cdp.coinbase.com/x402/bazaar#quality-ranking) as facilitator-observed buyer reach, successful-payment transaction volume, recency, and metadata quality. Its [resource rows](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/x402-facilitator/list-x402-resources) expose `l30DaysTotalCalls`, `l30DaysUniquePayers`, and `lastCalledAt`.

The snapshot contained:

- 12,245 unique Base resources;
- 328,098 reported successful-payment calls across resource rows;
- 36,943 resource-level unique-payer counts, which cannot be summed into globally unique buyers;
- 3,722 resources with at least two payer addresses;
- 844 with at least five;
- 241 with at least ten;
- 113 with at least 25;
- 38 with at least 100.

Those are stronger signals than semantic rank, but they still do not prove that buyer and seller are independently controlled. The July 2026 population study [*How Agentic Is Agentic Commerce?*](https://arxiv.org/abs/2607.12575) found that settlement count is unusually easy to manufacture: in its 280-day Base census, 21.20% of settlements were fictitious and 63.78% were internal to linked clusters. Product conclusions below therefore favor payer breadth, repeat use, recent activity, and corroboration across multiple datasets.

`listed price × trailing calls` is shown only as a naive gross proxy. It may overstate or misstate revenue for dynamic prices, free-on-no-match behavior, refunds, bundled credits, owner traffic, or changed prices.

## Strongest product-level signals in CDP Bazaar

| Product | Job | 30-day calls | Payer addresses | Listed price | Naive gross |
| --- | --- | ---: | ---: | ---: | ---: |
| twit.sh tweet search | Real-time social search | 100,737 | 44 | $0.006 | $604.42 |
| Tavily Search | Current web search | 53,348 | 384 | $0.01 | $533.48 |
| StableEnrich Exa Search | Neural web search | 8,957 | 273 | $0.01 | $89.57 |
| Exa Search | Neural web search | 4,166 | 130 | $0.007 | $29.16 |
| StableEnrich PDL Person Enrich | Contact and career enrichment | 1,913 | 89 | $0.28 | $535.64 |
| StableEnrich FullEnrich People Search | Filtered person discovery | 1,301 | 72 | $0.14 | $182.14 |
| Otto AI Crypto News | Current crypto news and sentiment | 2,713 | 104 | $0.001 | $2.71 |
| Hibra AI Swap | Onchain swap routing | 516 | 134 | $0.10 | $51.60 |
| Apify Actor run | Web extraction and automation | 120 | 120 | $1.00 | $120.00 |
| Atelier image generation | Generated visual deliverable | 96 | 66 | $0.55 | $52.80 |
| Interzoid Recent News | Company/topic news aggregation | 127 | 56 | $0.25 | $31.75 |

The most defensible conclusions are category-level:

1. **Search and retrieval are the clearest recurring need.** Tavily and the two Exa surfaces combine high call volume, broad payer sets, and same-day recency.
2. **People and company enrichment support much higher prices.** The strongest enrichment routes charge $0.14–$0.28 and still show dozens of payer addresses and hundreds to thousands of calls.
3. **Social, crypto, market, and onchain data are habitual micro-purchases.** Prices cluster around $0.001–$0.01 and repeat calls dominate their economics.
4. **Agent infrastructure sells as a workflow component.** Email, scraping, browser sessions, RPC reads, and automation runs are selected because another agent can immediately compose them.
5. **Heavy execution earns a larger ticket but lower frequency.** Image generation, browser/data-extraction runs, simulations, and prepaid capability access commonly sit around $0.50–$1 or more.

Several high rows are intentionally excluded from the recommendation set. For example, one email-search route reported 877 calls from 872 payer addresses, and a family of onchain primitives reported nearly one payer per call across many endpoints in a narrow cadence. These may be valid paid rollout or campaign activity, but the public counters cannot prove independent organic customers.

## What real agents searched for

Owner-run semantic searches used ordinary task language, not product names. They are synthetic retrieval tests, never impressions or demand.

- `search the web for current information` returned generic web-search products priced from $0.001 to $0.025.
- `find and enrich a person or company` returned person/company enrichment priced from $0.003 to $0.28.
- `get crypto market data and latest news` returned current news/data products priced from $0.001 to $0.005.
- `scrape a website into structured data` returned structured extraction products priced from $0.003 to $0.05.
- `read and send email for an autonomous agent` returned agent-mailbox and send/QA products priced from $0.001 to $0.10.
- `check a blockchain transaction and wallet balance` returned deterministic onchain reads priced from $0.001 to $0.25.

The same test exposed our actual acquisition problem:

- `did this MCP server change its tool schemas in a breaking way` ranked MCPDriftVerdict **#2**;
- natural GitHub Actions diagnosis, flake classification, repository-instruction audit, and bounty-selection queries did **not** retrieve the corresponding BountyVerdict routes in the top 20;
- the current CDP merchant catalog still exposes only Portfolio and MCPDriftVerdict, even though all production routes are healthy and the five GET routes have completed owner activations and validator checks.

This is evidence of incomplete Bazaar admission and weak intent retrieval, not evidence that buyers rejected the price or output. No qualified external buyer reached payment presentation in the trusted funnel.

## Roadmap implication

Do not build a commodity model gateway, generic web search, generic crypto-news feed, or broad people-data reseller. Those categories have demand, but established providers own upstream contracts, data access, scale, and thin-margin reliability.

After the existing suite earns ten genuine purchases, the best adjacent candidates are:

1. **Public-source evidence bundle** — normalize a public page, PDF, repository, or small source set into cited claims, hashes, extracted text, and reproducibility metadata.
2. **Recurring change monitor** — inspect public releases, CI failures, MCP schemas, documentation, status pages, or selected facts and emit only material changes with evidence.
3. **Agent procurement and endpoint-trust preflight** — validate liveness, schema, price/network, output contract, and public settlement/reputation evidence before an agent pays.
4. **Structured public-data extraction** — narrow, terms-compliant extraction from public or official sources rather than unrestricted scraping or personal-data resale.
5. **Paid-work opportunity intelligence** — discover escrow-backed agent tasks, verify funding and eligibility, estimate competition and expected value, and return the best legally safe opportunities. Current demand evidence is weaker than for search/enrichment, so this should be validated before implementation.

The immediate action remains distribution: get the six existing contracts reliably admitted and selected before adding an eighth product.
