import { createFacilitatorConfig } from "@coinbase/x402";
import { HTTPFacilitatorClient, type RouteConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { Hono, type MiddlewareHandler } from "hono";
import { CheckError, checkGithubIssue } from "./check";
import {
  discoveryExtension,
  exampleVerdict,
  portfolioDiscoveryExtension,
  portfolioExample,
} from "./discovery";
import { createLlmsText, createOpenApi } from "./openapi";
import { checkBountyPortfolio } from "./portfolio";
import { checkGithubHarness, HarnessError } from "./harness";
import { harnessDiscoveryExtension, harnessExample } from "./harness-discovery";

interface Env {
  PAY_TO_ADDRESS?: string;
  GITHUB_TOKEN?: string;
  X402_NETWORK?: string;
  X402_FACILITATOR_URL?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
}

type AppBindings = { Bindings: Env };

const SINGLE_PRICE_USD = "$0.05";
const PORTFOLIO_PRICE_USD = "$0.40";
const HARNESS_PRICE_USD = "$0.03";
const SINGLE_ENDPOINT = "/api/verdict";
const PORTFOLIO_ENDPOINT = "/api/portfolio";
const HARNESS_ENDPOINT = "/api/harness";
const TESTNET_NETWORK = "eip155:84532";
const TESTNET_FACILITATOR = "https://x402.org/facilitator";
const CDP_FACILITATOR = "https://api.cdp.coinbase.com/platform/v2/x402";
const PRODUCT_URL = "https://cristianmoroaica.github.io/bountyverdict/";
const ICON_URL = `${PRODUCT_URL}favicon.svg`;
const MANIFEST_URL = `${PRODUCT_URL}agent-manifest.json`;
const SKILL_URL = `${PRODUCT_URL}skills/preflight-github-bounties/SKILL.md`;

const middlewareCache = new Map<string, MiddlewareHandler>();

function requireAddress(value: string | undefined): `0x${string}` {
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error("PAY_TO_ADDRESS must be a public 20-byte EVM address.");
  }
  return value as `0x${string}`;
}

function buildPaymentMiddleware(env: Env): MiddlewareHandler {
  const payTo = requireAddress(env.PAY_TO_ADDRESS);
  const network = env.X402_NETWORK || TESTNET_NETWORK;
  const facilitatorUrl = env.X402_FACILITATOR_URL || TESTNET_FACILITATOR;
  const usingCdp = facilitatorUrl === CDP_FACILITATOR;
  if (usingCdp && (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET)) {
    throw new Error("CDP facilitator requires CDP_API_KEY_ID and CDP_API_KEY_SECRET.");
  }

  const key = [payTo.toLowerCase(), network, facilitatorUrl, usingCdp].join("|");
  const cached = middlewareCache.get(key);
  if (cached) return cached;

  const facilitatorConfig = usingCdp
    ? createFacilitatorConfig(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET)
    : { url: facilitatorUrl };
  const resourceServer = new x402ResourceServer(
    new HTTPFacilitatorClient(facilitatorConfig),
  )
    .register(network as `${string}:${string}`, new ExactEvmScheme());

  const routeConfig: RouteConfig = {
    accepts: {
      scheme: "exact",
      price: SINGLE_PRICE_USD,
      network: network as `${string}:${string}`,
      payTo,
    },
    description: "Deep-preflight a public GitHub bounty before spending agent compute. Returns a deterministic AVOID, CAUTION, or VIABLE verdict with evidence for locks, closed state, competing PRs, failed-attempt swarms, maintainer rejection, withdrawn rewards, and repository AI-contribution policy.",
    mimeType: "application/json",
    serviceName: "BountyVerdict",
    tags: ["github", "bounties", "developer-tools", "risk", "agents"],
    iconUrl: ICON_URL,
    unpaidResponseBody: () => ({
      contentType: "application/json",
      body: {
        error: "PAYMENT_REQUIRED",
        product: "BountyVerdict",
        price: SINGLE_PRICE_USD,
        currency: "USDC",
        description: "Pay once to receive a fresh evidence-linked bounty risk verdict.",
        free_sample: "/api/sample",
        documentation: PRODUCT_URL,
      },
    }),
  };
  const portfolioRouteConfig: RouteConfig = {
    accepts: {
      scheme: "exact",
      price: PORTFOLIO_PRICE_USD,
      network: network as `${string}:${string}`,
      payTo,
    },
    description: "Rank two to ten public GitHub bounty issues in one evidence-linked portfolio preflight. Returns full verdicts, the best candidate, decision counts, partial failures, and repository AI-contribution policy checks.",
    mimeType: "application/json",
    serviceName: "BountyVerdict Portfolio",
    tags: ["github", "bounties", "portfolio", "ranking", "developer-tools", "agents"],
    iconUrl: ICON_URL,
    unpaidResponseBody: () => ({
      contentType: "application/json",
      body: {
        error: "PAYMENT_REQUIRED",
        product: "BountyVerdict Portfolio",
        price: PORTFOLIO_PRICE_USD,
        currency: "USDC",
        description: "Pay once to rank up to ten bounty candidates with full evidence-linked verdicts.",
        free_sample: "/api/portfolio/sample",
        documentation: PRODUCT_URL,
      },
    }),
  };
  const harnessRouteConfig: RouteConfig = {
    accepts: {
      scheme: "exact",
      price: HARNESS_PRICE_USD,
      network: network as `${string}:${string}`,
      payTo,
    },
    description: "Audit a public GitHub repository's coding-agent instruction stack at an immutable commit. Maps AGENTS.md, CLAUDE.md, GEMINI.md, Copilot, Cursor, and SKILL.md coverage; flags stale paths, oversized context, machine-local references, malformed skills, and secret-like material with evidence-linked fixes.",
    mimeType: "application/json",
    serviceName: "HarnessVerdict",
    tags: ["github", "agents-md", "claude-md", "agent-harness", "developer-tools", "lint"],
    iconUrl: ICON_URL,
    unpaidResponseBody: () => ({
      contentType: "application/json",
      body: {
        error: "PAYMENT_REQUIRED",
        product: "HarnessVerdict",
        price: HARNESS_PRICE_USD,
        currency: "USDC",
        description: "Pay once for a commit-pinned, evidence-linked repository instruction audit.",
        free_sample: "/api/harness/sample",
        documentation: PRODUCT_URL,
      },
    }),
  };
  const middleware = paymentMiddleware(
    {
      [`GET ${SINGLE_ENDPOINT}`]: routeConfig,
      [`POST ${PORTFOLIO_ENDPOINT}`]: portfolioRouteConfig,
      [`GET ${HARNESS_ENDPOINT}`]: harnessRouteConfig,
    },
    resourceServer,
  );
  // Attach already-enriched metadata after middleware construction. The Hono
  // adapter otherwise auto-loads the eval-based validator that Workers reject.
  // x402HTTPResourceServer retains this same route object for payment responses.
  routeConfig.extensions = discoveryExtension;
  portfolioRouteConfig.extensions = portfolioDiscoveryExtension;
  harnessRouteConfig.extensions = harnessDiscoveryExtension;
  middlewareCache.set(key, middleware);
  return middleware;
}

const app = new Hono<AppBindings>();

app.get("/", (c) =>
  c.json({
    product: "BountyVerdict",
    status: "available",
    purpose: "Preflight GitHub bounties before an autonomous agent spends compute or reputation.",
    currency: "USDC",
    products: [
      {
        name: "BountyVerdict",
        price: SINGLE_PRICE_USD,
        endpoint: SINGLE_ENDPOINT,
        method: "GET",
        input: { issue_url: "https://github.com/owner/repository/issues/123" },
      },
      {
        name: "BountyVerdict Portfolio",
        price: PORTFOLIO_PRICE_USD,
        endpoint: PORTFOLIO_ENDPOINT,
        method: "POST",
        input: { issue_urls: ["https://github.com/owner/repository/issues/123", "https://github.com/owner/repository/issues/456"] },
      },
      {
        name: "HarnessVerdict",
        price: HARNESS_PRICE_USD,
        endpoint: HARNESS_ENDPOINT,
        method: "GET",
        input: { repo_url: "https://github.com/owner/repository" },
      },
    ],
    sample: "/api/sample",
    openapi: "/openapi.json",
    llms: "/llms.txt",
    agent_manifest: MANIFEST_URL,
    agent_skill: SKILL_URL,
    human_checker: PRODUCT_URL,
  }),
);

app.get("/api/sample", (c) => c.json(exampleVerdict));
app.get("/api/portfolio/sample", (c) => c.json(portfolioExample));
app.get("/api/harness/sample", (c) => c.json(harnessExample));

app.get("/openapi.json", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json(createOpenApi(origin, c.env.X402_NETWORK || TESTNET_NETWORK, {
    single: SINGLE_PRICE_USD,
    portfolio: PORTFOLIO_PRICE_USD,
    harness: HARNESS_PRICE_USD,
  }));
});

app.get("/llms.txt", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.text(createLlmsText(origin), 200, { "Content-Type": "text/plain; charset=utf-8" });
});

const paymentGate: MiddlewareHandler<AppBindings> = async (c, next) => {
  try {
    return await buildPaymentMiddleware(c.env)(c, next);
  } catch (error) {
    console.error(error);
    return c.json(
      {
        error: "SERVICE_CONFIGURATION_ERROR",
        message: "The payment service is not configured yet.",
      },
      503,
    );
  }
};

app.use(SINGLE_ENDPOINT, paymentGate);
app.use(PORTFOLIO_ENDPOINT, paymentGate);
app.use(HARNESS_ENDPOINT, paymentGate);

app.get(SINGLE_ENDPOINT, async (c) => {
  const issueUrl = c.req.query("issue_url") || "";
  try {
    const verdict = await checkGithubIssue(issueUrl, {
      GITHUB_TOKEN: c.env.GITHUB_TOKEN,
    });
    return c.json(verdict);
  } catch (error) {
    if (error instanceof CheckError) {
      return c.json({ error: error.code, message: error.message }, error.status as 400);
    }
    console.error(error);
    return c.json(
      { error: "INTERNAL_ERROR", message: "The verdict could not be produced." },
      500,
    );
  }
});

app.post(PORTFOLIO_ENDPOINT, async (c) => {
  let body: { issue_urls?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "INVALID_JSON", message: "Request body must be valid JSON." }, 400);
  }
  try {
    const portfolio = await checkBountyPortfolio(body.issue_urls, {
      GITHUB_TOKEN: c.env.GITHUB_TOKEN,
    });
    return c.json(portfolio);
  } catch (error) {
    if (error instanceof CheckError) {
      return c.json({ error: error.code, message: error.message }, error.status as 400);
    }
    console.error(error);
    return c.json(
      { error: "INTERNAL_ERROR", message: "The portfolio could not be produced." },
      500,
    );
  }
});

app.get(HARNESS_ENDPOINT, async (c) => {
  const repoUrl = c.req.query("repo_url") || "";
  try {
    const audit = await checkGithubHarness(repoUrl, { GITHUB_TOKEN: c.env.GITHUB_TOKEN });
    return c.json(audit);
  } catch (error) {
    if (error instanceof HarnessError) {
      return c.json({ error: error.code, message: error.message }, error.status as 400);
    }
    console.error(error);
    return c.json({ error: "INTERNAL_ERROR", message: "The harness audit could not be produced." }, 500);
  }
});

app.notFound((c) => c.json({ error: "NOT_FOUND" }, 404));

export default app;
