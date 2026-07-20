import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { addHttpMethod } from "./bazaar.ts";
import {
  MCP_DRIFT_CONTRACT_VERSION,
  MCP_DRIFT_RULESET_VERSION,
  MCP_DRIFT_SERVICE_REUSE,
} from "./mcp-drift.ts";

const hashSchema = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" };
const nonNegativeInteger = { type: "integer", minimum: 0 };

export const MCP_DRIFT_DISCOVERY_DESCRIPTION =
  "MCP schema drift and MCP tools/list compatibility gate for agent upgrades. Compares complete baseline and current snapshots; detects removed or renamed tools, new required arguments, incompatible input or output schemas, and model-facing metadata or safety-hint regressions. Returns an exact-hash compatibility verdict without fetching or invoking tools.";

const schemaObject = {
  type: "object",
  description: "A bounded JSON Schema Draft 2020-12 object in MCPDriftVerdict's documented comparison subset.",
  additionalProperties: true,
};

const toolInputSchema = {
  type: "object",
  properties: {
    name: { type: "string", pattern: "^[A-Za-z0-9_.-]{1,128}$" },
    title: { type: "string", maxLength: 512 },
    description: { type: "string", maxLength: 16384 },
    icons: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: true } },
    inputSchema: schemaObject,
    outputSchema: schemaObject,
    annotations: {
      type: "object",
      properties: {
        title: { type: "string", maxLength: 512 },
        readOnlyHint: { type: "boolean" },
        destructiveHint: { type: "boolean" },
        idempotentHint: { type: "boolean" },
        openWorldHint: { type: "boolean" },
      },
      additionalProperties: false,
    },
    execution: {
      type: "object",
      properties: { taskSupport: { type: "string", enum: ["forbidden", "optional", "required"] } },
      additionalProperties: false,
    },
    _meta: { type: "object", maxProperties: 512, additionalProperties: true },
  },
  required: ["name", "inputSchema"],
  additionalProperties: false,
};

const snapshotInputSchema = {
  type: "object",
  description: "One complete aggregated MCP tools/list snapshot. All catalog fields are transmitted to the external service for deterministic comparison.",
  properties: {
    protocol_version: { type: "string", const: "2025-11-25" },
    complete: {
      type: "boolean",
      const: true,
      description: "Caller assertion that all tools/list pages were aggregated and nextCursor was exhausted.",
    },
    tools: { type: "array", maxItems: 128, items: toolInputSchema },
  },
  required: ["protocol_version", "complete", "tools"],
  additionalProperties: false,
};

export const mcpDriftInputSchema = {
  type: "object",
  properties: {
    contract_version: { type: "string", const: MCP_DRIFT_CONTRACT_VERSION },
    subject: {
      type: "object",
      description: "Stable caller-chosen identity for the MCP server whose catalog is being compared.",
      properties: { server_id: { type: "string", pattern: "^[A-Za-z0-9._:/@+~-]{1,256}$", description: "Non-secret stable server identifier copied into the verdict." } },
      required: ["server_id"],
      additionalProperties: false,
    },
    annotation_source_trust: { type: "string", enum: ["trusted", "untrusted"], description: "Whether the caller recognizes the annotation source; annotations never become behavioral proof." },
    baseline: snapshotInputSchema,
    current: snapshotInputSchema,
  },
  required: ["contract_version", "subject", "annotation_source_trust", "baseline", "current"],
  additionalProperties: false,
};

export const mcpDriftExampleInput = {
  contract_version: MCP_DRIFT_CONTRACT_VERSION,
  subject: { server_id: "acme/tasks@production" },
  annotation_source_trust: "untrusted",
  baseline: {
    protocol_version: "2025-11-25",
    complete: true,
    tools: [{
      name: "lookup_task",
      description: "Look up one task.",
      inputSchema: {
        type: "object",
        properties: { task_id: { type: "string", minLength: 1 } },
        required: ["task_id"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: { status: { type: "string", enum: ["open", "closed"] } },
        required: ["status"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }],
  },
  current: {
    protocol_version: "2025-11-25",
    complete: true,
    tools: [{
      name: "lookup_task",
      description: "Look up one task.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", minLength: 1 },
          units: { type: "string", enum: ["metric", "imperial"] },
        },
        required: ["task_id"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: { status: { type: "string", enum: ["open", "closed"] } },
        required: ["status"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }],
  },
};

const findingSchema = {
  type: "object",
  properties: {
    id: hashSchema,
    category: { type: "string" },
    severity: { type: "string", enum: ["info", "review", "breaking", "security"] },
    tool: { type: ["string", "null"] },
    path: { type: "string" },
    relation: { type: "string", enum: ["PROVEN_SUBSET", "PROVEN_NOT_SUBSET", "UNKNOWN", "NOT_APPLICABLE"] },
    before_hash: hashSchema,
    after_hash: hashSchema,
    before: {},
    after: {},
    witness: {},
    witness_hash: hashSchema,
    reason: { type: "string" },
  },
  required: ["id", "category", "severity", "tool", "path", "relation", "reason"],
  additionalProperties: false,
};

export const mcpDriftOutputSchema = {
  type: "object",
  properties: {
    service: { type: "string", const: "MCPDriftVerdict" },
    contract_version: { type: "string", const: MCP_DRIFT_CONTRACT_VERSION },
    ruleset_version: { type: "string", const: MCP_DRIFT_RULESET_VERSION },
    subject: {
      type: "object",
      properties: { server_id: { type: "string" }, identity: { type: "string", const: "caller_asserted" } },
      required: ["server_id", "identity"], additionalProperties: false,
    },
    verdict: { type: "string", enum: ["UNCHANGED", "SAFE_ADDITIVE", "REVIEW", "INCONCLUSIVE", "BREAKING", "SECURITY_REGRESSION"] },
    action: { type: "string", enum: ["ACCEPT_CURRENT", "REVIEW_CURRENT", "HOLD_BASELINE", "BLOCK_CURRENT"] },
    trust: {
      type: "object",
      properties: {
        annotation_source: { type: "string", enum: ["caller_asserted_trusted", "untrusted"] },
        server_identity: { type: "string", const: "not_verified" },
        runtime_behavior: { type: "string", const: "not_verified" },
        completeness: { type: "string", const: "caller_asserted" },
      },
      required: ["annotation_source", "server_identity", "runtime_behavior", "completeness"], additionalProperties: false,
    },
    hashes: {
      type: "object",
      properties: { baseline_snapshot: hashSchema, current_snapshot: hashSchema, baseline_contract: hashSchema, current_contract: hashSchema },
      required: ["baseline_snapshot", "current_snapshot", "baseline_contract", "current_contract"], additionalProperties: false,
    },
    summary: {
      type: "object",
      properties: {
        baseline_tools: nonNegativeInteger, current_tools: nonNegativeInteger, added: nonNegativeInteger,
        removed: nonNegativeInteger, changed: nonNegativeInteger, compatible_changes: nonNegativeInteger,
        review_findings: nonNegativeInteger, breaking_findings: nonNegativeInteger,
        security_findings: nonNegativeInteger, unknown_relations: nonNegativeInteger,
      },
      required: ["baseline_tools", "current_tools", "added", "removed", "changed", "compatible_changes", "review_findings", "breaking_findings", "security_findings", "unknown_relations"],
      additionalProperties: false,
    },
    findings: { type: "array", maxItems: 256, items: findingSchema },
    coverage: {
      type: "object",
      properties: {
        compared_tools: nonNegativeInteger, schema_nodes: nonNegativeInteger, relation_checks: nonNegativeInteger,
        proven_subset: nonNegativeInteger, proven_not_subset: nonNegativeInteger, unknown: nonNegativeInteger,
        returned_findings: nonNegativeInteger, total_findings: nonNegativeInteger, truncated: { type: "boolean" },
      },
      required: ["compared_tools", "schema_nodes", "relation_checks", "proven_subset", "proven_not_subset", "unknown", "returned_findings", "total_findings", "truncated"],
      additionalProperties: false,
    },
    limitations: { type: "array", items: { type: "string" } },
    service_reuse: { type: "string", const: MCP_DRIFT_SERVICE_REUSE },
  },
  required: ["service", "contract_version", "ruleset_version", "subject", "verdict", "action", "trust", "hashes", "summary", "findings", "coverage", "limitations", "service_reuse"],
  additionalProperties: false,
};

export const mcpDriftExample = {
  service: "MCPDriftVerdict",
  contract_version: MCP_DRIFT_CONTRACT_VERSION,
  ruleset_version: MCP_DRIFT_RULESET_VERSION,
  subject: { server_id: "acme/tasks@production", identity: "caller_asserted" },
  verdict: "SAFE_ADDITIVE",
  action: "ACCEPT_CURRENT",
  trust: { annotation_source: "untrusted", server_identity: "not_verified", runtime_behavior: "not_verified", completeness: "caller_asserted" },
  hashes: {
    baseline_snapshot: "sha256:b536998673d7f19804f5717d8df56676da32dfc1689e81c44068412d794e51b9",
    current_snapshot: "sha256:fc3ad219f6b9bb68b3d9e96ab5920a90eb7c0d90be99a2aa509e69c7fad66820",
    baseline_contract: "sha256:e029e97109ad519fd93e6a30e07e5bb3f3a223803bf14147dac3ee539c2220bc",
    current_contract: "sha256:4f89f9c01a44ad6e96663d51bd957470acd36b27c524d9d15e2525ee94e127cc",
  },
  summary: { baseline_tools: 1, current_tools: 1, added: 0, removed: 0, changed: 1, compatible_changes: 1, review_findings: 0, breaking_findings: 0, security_findings: 0, unknown_relations: 0 },
  findings: [{
    id: "sha256:780ee0561d117f4d78f34eac6ae51dcdea37359efc93ac193b046f40bc863e18",
    category: "INPUT_CONTRACT_RELAXED", severity: "info", tool: "lookup_task",
    path: "/tools/lookup_task/inputSchema", relation: "PROVEN_SUBSET",
    reason: "Every baseline-valid input remains valid under the current declared schema.",
  }],
  coverage: { compared_tools: 1, schema_nodes: 9, relation_checks: 1, proven_subset: 1, proven_not_subset: 0, unknown: 0, returned_findings: 1, total_findings: 1, truncated: false },
  limitations: [
    "MCPDriftVerdict compares caller-supplied declared contracts only; it does not verify server identity, pagination, runtime behavior, authorization, or annotation truthfulness.",
    "Catalog text, icon URLs, and opaque metadata are treated as untrusted data and are never fetched, executed, or followed.",
    "MCP clients must not make tool-use decisions from untrusted annotations.",
  ],
  service_reuse: MCP_DRIFT_SERVICE_REUSE,
};

// Keep PAYMENT-REQUIRED compact. The full strict schemas remain in OpenAPI and the free sample.
const compactOutputSchema = {
  type: "object",
  properties: {
    service: { type: "string", const: "MCPDriftVerdict" },
    contract_version: { type: "string", const: MCP_DRIFT_CONTRACT_VERSION },
    ruleset_version: { type: "string" },
    verdict: mcpDriftOutputSchema.properties.verdict,
    action: mcpDriftOutputSchema.properties.action,
    hashes: mcpDriftOutputSchema.properties.hashes,
    service_reuse: { type: "string", const: MCP_DRIFT_SERVICE_REUSE },
  },
  required: ["service", "contract_version", "ruleset_version", "verdict", "action", "hashes", "service_reuse"],
  additionalProperties: true,
};

const compactExample = {
  service: mcpDriftExample.service,
  contract_version: mcpDriftExample.contract_version,
  ruleset_version: mcpDriftExample.ruleset_version,
  verdict: mcpDriftExample.verdict,
  action: mcpDriftExample.action,
  hashes: mcpDriftExample.hashes,
  service_reuse: mcpDriftExample.service_reuse,
};

const compactSnapshotInputSchema = {
  type: "object",
  properties: {
    protocol_version: { type: "string", const: "2025-11-25" },
    complete: { type: "boolean", const: true },
    tools: {
      type: "array", maxItems: 128,
      items: {
        type: "object",
        properties: {
          name: { type: "string", pattern: "^[A-Za-z0-9_.-]{1,128}$" },
          inputSchema: { type: "object", additionalProperties: true },
        },
        required: ["name", "inputSchema"],
        additionalProperties: true,
      },
    },
  },
  required: ["protocol_version", "complete", "tools"],
  additionalProperties: false,
};

const compactInputSchema = {
  type: "object",
  properties: {
    contract_version: { type: "string", const: MCP_DRIFT_CONTRACT_VERSION },
    subject: {
      type: "object",
      properties: { server_id: { type: "string" } },
      required: ["server_id"], additionalProperties: false,
    },
    annotation_source_trust: { type: "string", enum: ["trusted", "untrusted"] },
    baseline: compactSnapshotInputSchema,
    current: compactSnapshotInputSchema,
  },
  required: ["contract_version", "subject", "annotation_source_trust", "baseline", "current"],
  additionalProperties: false,
};

export const mcpDriftDiscoveryExtension = addHttpMethod(declareDiscoveryExtension({
  bodyType: "json",
  input: mcpDriftExampleInput,
  inputSchema: compactInputSchema,
  output: { example: compactExample, schema: compactOutputSchema },
}), "POST");
