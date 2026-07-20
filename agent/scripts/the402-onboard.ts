import { THE402_PRODUCTS, type The402Product } from "../src/the402.ts";

const api = "https://api.the402.ai/v1";
const apiKey = process.env.THE402_API_KEY;
const participantId = process.env.THE402_PARTICIPANT_ID;
const enabled = process.env.THE402_CREATE === "YES";

if (!enabled) throw new Error("Set THE402_CREATE=YES to create or update marketplace listings.");
if (!apiKey || apiKey.length < 16) throw new Error("THE402_API_KEY is missing or invalid.");
if (!participantId || !/^p_[A-Za-z0-9_-]{1,160}$/.test(participantId)) {
  throw new Error("THE402_PARTICIPANT_ID is missing or invalid.");
}

const objectOutput = {
  type: "object",
  description: "The complete typed BountyVerdict result described in the linked public documentation.",
  additionalProperties: true,
};

const definitions: Array<{
  product: The402Product;
  name: string;
  description: string;
  price: string;
  tags: string[];
  input_schema: Record<string, unknown>;
}> = [
  {
    product: "single",
    name: "BountyVerdict",
    description: "Decide whether one public GitHub bounty is still available and worth pursuing before coding. Returns AVOID, CAUTION, or VIABLE with public evidence and repository AI-policy coverage. Documentation: https://cristianmoroaica.github.io/bountyverdict/agents.html",
    price: "$0.05",
    tags: ["github", "bounty", "due-diligence", "agent-decision"],
    input_schema: {
      type: "object",
      required: ["issue_url"],
      additionalProperties: false,
      properties: {
        issue_url: { type: "string", description: "Canonical public GitHub issue URL." },
      },
    },
  },
  {
    product: "portfolio",
    name: "BountyVerdict Portfolio",
    description: "Rank two to ten public GitHub bounty candidates using the full evidence-linked due-diligence check, preserving partial failures and selecting the strongest non-AVOID option. Documentation: https://cristianmoroaica.github.io/bountyverdict/agents.html",
    price: "$0.40",
    tags: ["github", "bounty", "portfolio", "ranking"],
    input_schema: {
      type: "object",
      required: ["issue_urls"],
      additionalProperties: false,
      properties: {
        issue_urls: {
          type: "array",
          minItems: 2,
          maxItems: 10,
          uniqueItems: true,
          items: { type: "string", description: "Canonical public GitHub issue URL." },
        },
      },
    },
  },
  {
    product: "harness",
    name: "HarnessVerdict",
    description: "Audit a public GitHub repository's coding-agent instruction stack at an immutable commit. Returns READY, REVIEW, or REPAIR with evidence-linked fixes. Documentation: https://cristianmoroaica.github.io/bountyverdict/agents.html",
    price: "$0.03",
    tags: ["github", "agents-md", "agent-harness", "developer-tools"],
    input_schema: {
      type: "object",
      required: ["repo_url"],
      additionalProperties: false,
      properties: {
        repo_url: { type: "string", description: "Canonical public GitHub repository URL." },
      },
    },
  },
  {
    product: "run",
    name: "RunVerdict",
    description: "Diagnose why one public GitHub Actions run failed and return a bounded root cause, retryability decision, redacted evidence, and concrete next action without rerunning CI. Documentation: https://cristianmoroaica.github.io/bountyverdict/agents.html",
    price: "$0.04",
    tags: ["github-actions", "ci", "root-cause", "developer-tools"],
    input_schema: {
      type: "object",
      required: ["run_url"],
      additionalProperties: false,
      properties: {
        run_url: { type: "string", description: "Canonical public GitHub Actions run URL." },
      },
    },
  },
  {
    product: "flake",
    name: "FlakeVerdict",
    description: "Decide whether a completed public GitHub Actions failure is flaky and merits exactly one retry, or is recurring or new and needs a fix. Documentation: https://cristianmoroaica.github.io/bountyverdict/agents.html",
    price: "$0.07",
    tags: ["github-actions", "flaky-ci", "retry-or-fix", "developer-tools"],
    input_schema: {
      type: "object",
      required: ["run_url"],
      additionalProperties: false,
      properties: {
        run_url: { type: "string", description: "Canonical public GitHub Actions run URL." },
        attempt: { type: "integer", minimum: 1, description: "Optional exact workflow attempt." },
      },
    },
  },
  {
    product: "mcpdrift",
    name: "MCPDriftVerdict",
    description: "Compare complete baseline and current MCP tools/list snapshots and return an exact-hash compatibility verdict without fetching or invoking tools. Documentation and strict input contract: https://cristianmoroaica.github.io/bountyverdict/agents.html",
    price: "$0.02",
    tags: ["mcp", "schema-drift", "compatibility", "agent-safety"],
    input_schema: {
      type: "object",
      required: ["contract_version", "subject", "annotation_source_trust", "baseline", "current"],
      additionalProperties: false,
      properties: {
        contract_version: { type: "string", const: "mcp-drift/1" },
        subject: { type: "object", description: "Stable caller-chosen server identity.", additionalProperties: true },
        annotation_source_trust: { type: "string", enum: ["trusted", "untrusted"] },
        baseline: { type: "object", description: "Complete baseline tools/list snapshot.", additionalProperties: true },
        current: { type: "object", description: "Complete current tools/list snapshot.", additionalProperties: true },
      },
    },
  },
];

if (definitions.length !== THE402_PRODUCTS.length ||
  definitions.some(({ product }) => !THE402_PRODUCTS.includes(product))) {
  throw new Error("the402 listing definitions do not match the allowed product set.");
}

async function platformFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${api}${path}`, {
    ...init,
    redirect: "error",
    headers: {
      "X-API-Key": apiKey!,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
}

type ExistingService = { id: string; name: string };

function servicesFromPayload(payload: any): ExistingService[] {
  const candidates = Array.isArray(payload?.services)
    ? payload.services
    : Array.isArray(payload?.data)
      ? payload.data
      : [];
  return candidates
    .filter((entry: any) => typeof entry?.id === "string" && typeof entry?.name === "string")
    .map((entry: any) => ({ id: entry.id, name: entry.name }));
}

async function existingServices(): Promise<ExistingService[]> {
  const owned = await platformFetch("/services");
  if (owned.ok) return servicesFromPayload(await owned.json());
  if (![404, 405].includes(owned.status)) {
    throw new Error(`the402 owned-service lookup returned HTTP ${owned.status}.`);
  }
  const catalog = await fetch(`${api}/services/catalog?provider=${encodeURIComponent(participantId!)}&limit=100`, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!catalog.ok) throw new Error(`the402 catalog lookup returned HTTP ${catalog.status}.`);
  return servicesFromPayload(await catalog.json());
}

function serviceId(payload: any): string {
  const value = payload?.service?.id || payload?.service?.service_id ||
    payload?.data?.id || payload?.data?.service_id || payload?.id || payload?.service_id;
  if (typeof value !== "string" || !/^svc_[A-Za-z0-9_-]{1,160}$/.test(value)) {
    throw new Error("the402 did not return a valid service ID.");
  }
  return value;
}

const existing = await existingServices();
const map: Record<string, The402Product> = {};
const results: Array<{ product: The402Product; service_id: string; action: "created" | "updated" }> = [];
for (const definition of definitions) {
  const previous = existing.find(({ name }) => name === definition.name);
  const payload = {
    name: definition.name,
    description: definition.description,
    price: { fixed: definition.price },
    service_type: "data_api",
    pricing_model: "fixed",
    fulfillment_type: "instant",
    estimated_delivery: "30s",
    category: "developer-tools",
    tags: definition.tags,
    input_schema: definition.input_schema,
    deliverable_schema: objectOutput,
  };
  const response = await platformFetch(previous ? `/services/${previous.id}` : "/services", {
    method: previous ? "PUT" : "POST",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`the402 ${definition.product} listing returned HTTP ${response.status}: ${error.slice(0, 500)}`);
  }
  const id = previous?.id || serviceId(await response.json());
  map[id] = definition.product;
  results.push({ product: definition.product, service_id: id, action: previous ? "updated" : "created" });
}

console.log(JSON.stringify({ participant_id: participantId, service_map: map, services: results }, null, 2));
