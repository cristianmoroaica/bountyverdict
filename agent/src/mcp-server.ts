import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createPaymentWrapper, type PaymentRequirements } from "@x402/mcp";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { z } from "zod";
import { parseIssueUrl } from "../../analysis.js";
import { CheckError, checkGithubIssue } from "./check.ts";
import { checkBountyPortfolio, validatePortfolioUrls } from "./portfolio.ts";
import { checkGithubHarness, HarnessError, parseRepositoryUrl } from "./harness.ts";
import { diagnoseGithubRun, parseRunUrl } from "./run.ts";
import { diagnoseGithubFlake, FlakeError, parseFlakeAttempt } from "./flake.ts";
import { MCP_DRIFT_MAX_BODY_BYTES, McpDriftError, parseAndAnalyzeMcpDrift } from "./mcp-drift.ts";
import { mcpDriftInputSchema } from "./mcp-drift-discovery.ts";
import { PRODUCT_CATALOG, type ProductKey } from "./product-catalog.ts";
import { createX402ServerContext, type X402ServerEnvironment } from "./x402-resource-server.ts";

const MCP_PROTOCOL_VERSION = "2025-11-25";
const MCP_BODY_LIMIT_BYTES = MCP_DRIFT_MAX_BODY_BYTES + 64 * 1024;
const MCP_SERVER_VERSION = "1.0.0";
const MCP_ALLOWED_BROWSER_ORIGINS = new Set(["https://playground.ai.cloudflare.com"]);

type DistributedProduct = Exclude<ProductKey, "skill">;
type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

interface McpEnvironment extends X402ServerEnvironment {
  GITHUB_TOKEN?: string;
  FLAKE_RATE_LIMITER?: RateLimit;
}

interface PaymentContext {
  resourceServer: ReturnType<typeof createX402ServerContext>["resourceServer"];
  accepts: Record<DistributedProduct, PaymentRequirements[]>;
}

interface RequestClassification {
  ownerAutomation: boolean;
  toolStageEmitted: boolean;
}

const TOOL_PRODUCT = Object.freeze({
  check_github_bounty: "single",
  rank_github_bounties: "portfolio",
  audit_agent_harness: "harness",
  diagnose_github_actions_run: "run",
  classify_github_actions_flake: "flake",
  check_mcp_tool_drift: "mcpdrift",
} as const satisfies Record<string, DistributedProduct>);

type ToolName = keyof typeof TOOL_PRODUCT;

const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  check_github_bounty: "Check whether one public GitHub bounty is viable before coding. Returns an evidence-linked AVOID, CAUTION, or VIABLE verdict. Read-only. Costs $0.05 USDC on Base via x402 per successful call.",
  rank_github_bounties: "Compare 2-10 public GitHub bounty issues and choose the strongest candidate. Returns full verdicts, evidence, ranking, and partial failures. Read-only. Costs $0.40 USDC on Base via x402 per successful call.",
  audit_agent_harness: "Audit a public GitHub repository's AGENTS.md, CLAUDE.md, GEMINI.md, Copilot, Cursor, and SKILL.md instruction stack at an immutable commit. Read-only. Costs $0.03 USDC on Base via x402 per successful call.",
  diagnose_github_actions_run: "Find why one public GitHub Actions run failed and return root cause, retryability, redacted evidence, and concrete next actions. Read-only. Costs $0.04 USDC on Base via x402 per successful call.",
  classify_github_actions_flake: "Decide whether a completed failed GitHub Actions run should be retried once or fixed, using attempt and historical fingerprints. Read-only. Costs $0.07 USDC on Base via x402 per successful call.",
  check_mcp_tool_drift: "Compare complete baseline and current MCP tools/list snapshots for breaking schema, tool, and model-facing safety changes. Read-only. Costs $0.02 USDC on Base via x402 per successful call.",
};

const BAZAAR_INPUT_SCHEMAS: Record<ToolName, Record<string, unknown>> = {
  check_github_bounty: { type: "object", properties: { issue_url: { type: "string", description: "Public GitHub issue URL." } }, required: ["issue_url"], additionalProperties: false },
  rank_github_bounties: { type: "object", properties: { issue_urls: { type: "array", minItems: 2, maxItems: 10, uniqueItems: true, items: { type: "string", description: "Public GitHub issue URL." } } }, required: ["issue_urls"], additionalProperties: false },
  audit_agent_harness: { type: "object", properties: { repo_url: { type: "string", description: "Public GitHub repository URL." } }, required: ["repo_url"], additionalProperties: false },
  diagnose_github_actions_run: { type: "object", properties: { run_url: { type: "string", description: "Public GitHub Actions run URL." } }, required: ["run_url"], additionalProperties: false },
  classify_github_actions_flake: { type: "object", properties: { run_url: { type: "string", description: "Public GitHub Actions run URL." }, attempt: { type: "integer", minimum: 1, description: "Optional exact workflow attempt." } }, required: ["run_url"], additionalProperties: false },
  check_mcp_tool_drift: mcpDriftInputSchema,
};

const PAYMENT_CACHE = new Map<string, Promise<PaymentContext>>();

function jsonResult(value: unknown): ToolResult {
  const structuredContent = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { result: value };
  return { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent };
}

function errorResult(product: DistributedProduct, code: string, message: string): ToolResult {
  return {
    ...jsonResult({ error: code, message, product: PRODUCT_CATALOG[product].service, payment_verified: false, payment_settled: false, payment_challenge_issued: false }),
    isError: true,
  };
}

function classifyRequest(request: Request): RequestClassification {
  return {
    ownerAutomation: /bountyverdict-(?:owner-audit|funnel-smoke|payment-smoke|directory-monitor|distribution-monitor|settlement-canary)/i.test(request.headers.get("User-Agent") || ""),
    toolStageEmitted: false,
  };
}

function emitMcpEvent(stage: string, product: DistributedProduct | null, request: RequestClassification): void {
  if (product || stage === "tool_not_found") request.toolStageEmitted = true;
  console.log(JSON.stringify({ type: "bountyverdict_mcp_funnel", schema_version: 1, stage, product, source: request.ownerAutomation ? "owner_automation" : "external" }));
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(bytes)].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

async function getPaymentContext(env: McpEnvironment): Promise<PaymentContext> {
  const context = createX402ServerContext(env);
  let pending = PAYMENT_CACHE.get(context.cacheKey);
  if (!pending) {
    pending = (async () => {
      context.resourceServer.registerExtension(bazaarResourceServerExtension);
      await context.resourceServer.initialize();
      const entries = await Promise.all((Object.keys(PRODUCT_CATALOG) as ProductKey[])
        .filter((product): product is DistributedProduct => product !== "skill")
        .map(async (product) => [product, await context.resourceServer.buildPaymentRequirements({ scheme: "exact", network: context.network, payTo: context.payTo, price: PRODUCT_CATALOG[product].priceUsd, maxTimeoutSeconds: 300 })] as const));
      return { resourceServer: context.resourceServer, accepts: Object.fromEntries(entries) as Record<DistributedProduct, PaymentRequirements[]> };
    })().catch((error) => { PAYMENT_CACHE.delete(context.cacheKey); throw error; });
    PAYMENT_CACHE.set(context.cacheKey, pending);
  }
  return pending;
}

function hasPayment(extra: unknown): boolean {
  if (!extra || typeof extra !== "object") return false;
  const payment = (extra as { _meta?: Record<string, unknown> })._meta?.["x402/payment"];
  return Boolean(payment && typeof payment === "object" && !Array.isArray(payment));
}

async function paidCall(
  payment: PaymentContext,
  toolName: ToolName,
  product: DistributedProduct,
  normalizedArgs: Record<string, unknown>,
  extra: unknown,
  request: RequestClassification,
  execute: () => Promise<ToolResult>,
): Promise<ToolResult> {
  const argumentsHash = await sha256(JSON.stringify(normalizedArgs));
  const paymentPresent = hasPayment(extra);
  emitMcpEvent(paymentPresent ? "payment_present" : "payment_required", product, request);
  const wrapped = createPaymentWrapper(payment.resourceServer, {
    accepts: payment.accepts[product],
    resource: {
      url: `mcp://tool/${toolName}`,
      description: `${TOOL_DESCRIPTIONS[toolName]} Advisory normalized arguments hash ${argumentsHash}. Payment does not cryptographically bind arguments; retry with the exact same normalized arguments.`,
      mimeType: "application/json",
      serviceName: PRODUCT_CATALOG[product].service,
      tags: ["github", "agent", "decision", product],
    },
    extensions: declareDiscoveryExtension({ toolName, description: TOOL_DESCRIPTIONS[toolName], transport: "streamable-http", inputSchema: BAZAAR_INPUT_SCHEMAS[toolName] }),
  })(async () => execute());
  try {
    const result = await wrapped(normalizedArgs, extra as never) as ToolResult;
    if (paymentPresent) {
      const settled = Boolean(result._meta?.["x402/payment-response"]);
      emitMcpEvent(settled && !result.isError ? "paid_success" : "paid_error", product, request);
    }
    return result;
  } catch (error) {
    if (paymentPresent) emitMcpEvent("paid_error", product, request);
    throw error;
  }
}

function normalizeIssueUrl(value: string): string {
  const parsed = parseIssueUrl(value);
  return `https://github.com/${parsed.owner}/${parsed.repo}/issues/${parsed.number}`;
}

function normalizeRepositoryUrl(value: string): string {
  const parsed = parseRepositoryUrl(value);
  return `https://github.com/${parsed.owner}/${parsed.repo}`;
}

function normalizeRunUrl(value: string): string {
  const parsed = parseRunUrl(value);
  return `https://github.com/${parsed.owner}/${parsed.repo}/actions/runs/${parsed.runId}`;
}

async function createMcpServer(env: McpEnvironment, request: RequestClassification): Promise<McpServer> {
  const payment = await getPaymentContext(env);
  const server = new McpServer({
    name: "BountyVerdict",
    title: "BountyVerdict Agent Decision Tools",
    version: MCP_SERVER_VERSION,
    description: "Paid, read-only GitHub and MCP decision tools for autonomous agents.",
    websiteUrl: "https://cristianmoroaica.github.io/bountyverdict/",
  }, {
    instructions: "Use tools/list for six paid, read-only decision tools. Invalid input is rejected before any payment challenge. Each successful call charges the exact advertised USDC price on Base via x402. Payment identifies the fixed-price tool, not its arguments; preserve the exact normalized arguments when retrying with payment.",
  });
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

  server.registerTool("check_github_bounty", { title: "Check GitHub bounty viability", description: TOOL_DESCRIPTIONS.check_github_bounty, inputSchema: { issue_url: z.string().min(1) }, annotations }, async ({ issue_url }, extra) => {
    let normalized: string;
    try { normalized = normalizeIssueUrl(issue_url); } catch (error) {
      emitMcpEvent("validation_error", "single", request);
      return errorResult("single", "INVALID_ISSUE_URL", error instanceof Error ? error.message : "Invalid GitHub issue URL.");
    }
    return paidCall(payment, "check_github_bounty", "single", { issue_url: normalized }, extra, request, async () => {
      try { return jsonResult(await checkGithubIssue(normalized, { GITHUB_TOKEN: env.GITHUB_TOKEN })); }
      catch (error) { return error instanceof CheckError ? errorResult("single", error.code, error.message) : errorResult("single", "CHECK_FAILED", "The bounty verdict could not be produced."); }
    });
  });

  server.registerTool("rank_github_bounties", { title: "Rank GitHub bounty candidates", description: TOOL_DESCRIPTIONS.rank_github_bounties, inputSchema: { issue_urls: z.array(z.string()).min(2).max(10) }, annotations }, async ({ issue_urls }, extra) => {
    let normalized: string[];
    try { normalized = validatePortfolioUrls(issue_urls); } catch (error) {
      emitMcpEvent("validation_error", "portfolio", request);
      return errorResult("portfolio", error instanceof CheckError ? error.code : "INVALID_PORTFOLIO", error instanceof Error ? error.message : "Invalid bounty portfolio.");
    }
    return paidCall(payment, "rank_github_bounties", "portfolio", { issue_urls: normalized }, extra, request, async () => {
      try { return jsonResult(await checkBountyPortfolio(normalized, { GITHUB_TOKEN: env.GITHUB_TOKEN })); }
      catch (error) { return error instanceof CheckError ? errorResult("portfolio", error.code, error.message) : errorResult("portfolio", "PORTFOLIO_CHECK_FAILED", "The bounty portfolio could not be produced."); }
    });
  });

  server.registerTool("audit_agent_harness", { title: "Audit repository agent instructions", description: TOOL_DESCRIPTIONS.audit_agent_harness, inputSchema: { repo_url: z.string().min(1) }, annotations }, async ({ repo_url }, extra) => {
    let normalized: string;
    try { normalized = normalizeRepositoryUrl(repo_url); } catch (error) {
      emitMcpEvent("validation_error", "harness", request);
      return errorResult("harness", "INVALID_REPOSITORY_URL", error instanceof Error ? error.message : "Invalid GitHub repository URL.");
    }
    return paidCall(payment, "audit_agent_harness", "harness", { repo_url: normalized }, extra, request, async () => {
      try { return jsonResult(await checkGithubHarness(normalized, { GITHUB_TOKEN: env.GITHUB_TOKEN })); }
      catch (error) { return error instanceof HarnessError ? errorResult("harness", error.code, error.message) : errorResult("harness", "HARNESS_CHECK_FAILED", "The agent harness audit could not be produced."); }
    });
  });

  server.registerTool("diagnose_github_actions_run", { title: "Diagnose GitHub Actions failure", description: TOOL_DESCRIPTIONS.diagnose_github_actions_run, inputSchema: { run_url: z.string().min(1) }, annotations }, async ({ run_url }, extra) => {
    let normalized: string;
    try { normalized = normalizeRunUrl(run_url); } catch (error) {
      emitMcpEvent("validation_error", "run", request);
      return errorResult("run", "INVALID_RUN_URL", error instanceof Error ? error.message : "Invalid GitHub Actions run URL.");
    }
    return paidCall(payment, "diagnose_github_actions_run", "run", { run_url: normalized }, extra, request, async () => {
      try { return jsonResult(await diagnoseGithubRun(normalized, { GITHUB_TOKEN: env.GITHUB_TOKEN })); }
      catch (error) { return error instanceof HarnessError ? errorResult("run", error.code, error.message) : errorResult("run", "RUN_DIAGNOSIS_FAILED", "The workflow run could not be diagnosed."); }
    });
  });

  server.registerTool("classify_github_actions_flake", { title: "Classify GitHub Actions flake", description: TOOL_DESCRIPTIONS.classify_github_actions_flake, inputSchema: { run_url: z.string().min(1), attempt: z.number().int().positive().optional() }, annotations }, async ({ run_url, attempt }, extra) => {
    let normalized: string;
    let normalizedAttempt: number | undefined;
    try {
      normalized = normalizeRunUrl(run_url);
      normalizedAttempt = parseFlakeAttempt(attempt === undefined ? undefined : String(attempt));
      if (!env.FLAKE_RATE_LIMITER) throw new HarnessError("FlakeVerdict capacity protection is unavailable.", 503, "SERVICE_CONFIGURATION_ERROR");
      if (hasPayment(extra)) {
        const permitted = await env.FLAKE_RATE_LIMITER.limit({ key: "flake:mcp-verified-global" });
        if (!permitted.success) throw new HarnessError("FlakeVerdict is temporarily at its bounded upstream capacity.", 429, "FLAKE_RATE_LIMITED");
      }
    } catch (error) {
      emitMcpEvent("validation_error", "flake", request);
      return errorResult("flake", error instanceof HarnessError ? error.code : "INVALID_INPUT", error instanceof Error ? error.message : "Invalid flake input.");
    }
    return paidCall(payment, "classify_github_actions_flake", "flake", { run_url: normalized, ...(normalizedAttempt === undefined ? {} : { attempt: normalizedAttempt }) }, extra, request, async () => {
      try { return jsonResult(await diagnoseGithubFlake(normalized, normalizedAttempt, { GITHUB_TOKEN: env.GITHUB_TOKEN })); }
      catch (error) { return error instanceof FlakeError ? errorResult("flake", error.code, error.message) : errorResult("flake", "FLAKE_CHECK_FAILED", "The workflow flake classification could not be produced."); }
    });
  });

  server.registerTool("check_mcp_tool_drift", { title: "Check MCP tool contract drift", description: TOOL_DESCRIPTIONS.check_mcp_tool_drift, inputSchema: { contract_version: z.literal("mcp-drift/1"), subject: z.object({ server_id: z.string().min(1).max(256) }), annotation_source_trust: z.enum(["trusted", "untrusted"]), baseline: z.record(z.unknown()), current: z.record(z.unknown()) }, annotations }, async (args, extra) => {
    let result: Awaited<ReturnType<typeof parseAndAnalyzeMcpDrift>>;
    const normalized = { contract_version: args.contract_version, subject: args.subject, annotation_source_trust: args.annotation_source_trust, baseline: args.baseline, current: args.current };
    try { result = await parseAndAnalyzeMcpDrift(JSON.stringify(normalized)); }
    catch (error) {
      emitMcpEvent("validation_error", "mcpdrift", request);
      return error instanceof McpDriftError ? errorResult("mcpdrift", error.code, error.message) : errorResult("mcpdrift", "INVALID_INPUT", "The MCP snapshots are invalid.");
    }
    return paidCall(payment, "check_mcp_tool_drift", "mcpdrift", normalized, extra, request, async () => jsonResult(result));
  });

  return server;
}

function jsonRpcHttpError(status: number, code: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(status === 405 ? { Allow: "POST" } : {}) } });
}

export async function handleMcpRequest(request: Request, env: McpEnvironment): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const allowedCorsOrigin = origin && (origin === url.origin || MCP_ALLOWED_BROWSER_ORIGINS.has(origin)) ? origin : null;
  const respond = (response: Response): Response => {
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("MCP-Protocol-Version", MCP_PROTOCOL_VERSION);
    if (allowedCorsOrigin) {
      headers.set("Access-Control-Allow-Origin", allowedCorsOrigin);
      headers.append("Vary", "Origin");
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
  if (origin && !allowedCorsOrigin) return respond(jsonRpcHttpError(403, -32000, "Forbidden Origin"));
  if (request.method === "OPTIONS" && allowedCorsOrigin) {
    return respond(new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Accept, Content-Type, MCP-Protocol-Version",
      "Access-Control-Max-Age": "86400",
    } }));
  }
  if (request.method !== "POST") return respond(jsonRpcHttpError(405, -32600, "Method not allowed; this stateless MCP server accepts POST only"));
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MCP_BODY_LIMIT_BYTES) return respond(jsonRpcHttpError(413, -32600, "MCP request body is too large"));
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) {
    return respond(jsonRpcHttpError(415, -32000, "Unsupported Media Type: Content-Type must be application/json"));
  }
  const accept = request.headers.get("Accept") || "";
  if (!/application\/json/i.test(accept) || !/text\/event-stream/i.test(accept)) {
    return respond(jsonRpcHttpError(406, -32000, "Not Acceptable: client must accept application/json and text/event-stream"));
  }

  let parsedBody: unknown;
  if (request.method === "POST") {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MCP_BODY_LIMIT_BYTES) return respond(jsonRpcHttpError(413, -32600, "MCP request body is too large"));
    try { parsedBody = JSON.parse(raw); } catch { return respond(jsonRpcHttpError(400, -32700, "Parse error")); }
  }

  const classification = classifyRequest(request);
  const method = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) ? (parsedBody as { method?: unknown }).method : undefined;
  const requestedProtocol = request.headers.get("MCP-Protocol-Version");
  if (method !== "initialize" && requestedProtocol !== MCP_PROTOCOL_VERSION) {
    return respond(jsonRpcHttpError(400, -32600, `MCP-Protocol-Version must be ${MCP_PROTOCOL_VERSION}`));
  }
  if (method === "initialize") emitMcpEvent("initialize", null, classification);
  if (method === "tools/list") emitMcpEvent("tools_list", null, classification);

  try {
    const server = await createMcpServer(env, classification);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const response = await transport.handleRequest(request, parsedBody === undefined ? undefined : { parsedBody });
    if (method === "tools/call" && !classification.toolStageEmitted) {
      const toolName = (parsedBody as { params?: { name?: unknown } }).params?.name;
      const product = typeof toolName === "string" ? TOOL_PRODUCT[toolName as ToolName] : undefined;
      emitMcpEvent(product ? "validation_error" : "tool_not_found", product || null, classification);
    }
    return respond(response);
  } catch (error) {
    console.error("MCP request failed", error instanceof Error ? { name: error.name } : { name: "unknown" });
    return respond(jsonRpcHttpError(503, -32603, "MCP service temporarily unavailable"));
  }
}

export const MCP_DISTRIBUTED_TOOL_NAMES = Object.freeze(Object.keys(TOOL_PRODUCT) as ToolName[]);
