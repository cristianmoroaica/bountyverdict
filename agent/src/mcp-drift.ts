export const MCP_DRIFT_CONTRACT_VERSION = "mcp-drift/1" as const;
export const MCP_DRIFT_RULESET_VERSION = "2026-07-20.1";
export const MCP_PROTOCOL_VERSION = "2025-11-25" as const;
export const MCP_DRIFT_MAX_BODY_BYTES = 524_288;
export const MCP_DRIFT_MAX_TOOLS = 128;
export const MCP_DRIFT_MAX_SCHEMA_NODES = 8_192;
export const MCP_DRIFT_MAX_DEPTH = 32;
export const MCP_DRIFT_MAX_FINDINGS = 256;

export const MCP_DRIFT_SERVICE_REUSE =
  "Call MCPDriftVerdict after every notifications/tools/list_changed, at agent startup when the current tools/list snapshot hash differs from the pinned baseline, and before accepting an MCP server upgrade. Reuse only for the exact baseline_snapshot hash, current_snapshot hash, and ruleset_version tuple." as const;

type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };
type JsonSchema = boolean | JsonObject;

export type McpDriftVerdict =
  | "UNCHANGED"
  | "SAFE_ADDITIVE"
  | "REVIEW"
  | "INCONCLUSIVE"
  | "BREAKING"
  | "SECURITY_REGRESSION";

export interface McpDriftInput {
  contract_version: typeof MCP_DRIFT_CONTRACT_VERSION;
  subject: { server_id: string };
  annotation_source_trust: "trusted" | "untrusted";
  baseline: McpSnapshot;
  current: McpSnapshot;
}

export interface McpSnapshot {
  protocol_version: typeof MCP_PROTOCOL_VERSION;
  complete: true;
  tools: McpTool[];
}

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  icons?: Array<{
    src: string;
    mimeType?: string;
    sizes?: string[];
    theme?: "light" | "dark";
  }>;
  inputSchema: JsonObject;
  outputSchema?: JsonObject;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  execution?: { taskSupport?: "forbidden" | "optional" | "required" };
  _meta?: JsonObject;
}

type Relation = "PROVEN_SUBSET" | "PROVEN_NOT_SUBSET" | "UNKNOWN" | "NOT_APPLICABLE";
type FindingSeverity = "info" | "review" | "breaking" | "security";

interface FindingCore {
  category: string;
  severity: FindingSeverity;
  tool: string | null;
  path: string;
  relation: Relation;
  before_hash?: `sha256:${string}`;
  after_hash?: `sha256:${string}`;
  before?: JsonValue;
  after?: JsonValue;
  witness?: JsonValue;
  witness_hash?: `sha256:${string}`;
  reason: string;
}

export interface McpDriftFinding extends FindingCore {
  id: `sha256:${string}`;
}

export interface McpDriftResult {
  service: "MCPDriftVerdict";
  contract_version: typeof MCP_DRIFT_CONTRACT_VERSION;
  ruleset_version: string;
  subject: { server_id: string; identity: "caller_asserted" };
  verdict: McpDriftVerdict;
  action: "ACCEPT_CURRENT" | "REVIEW_CURRENT" | "HOLD_BASELINE" | "BLOCK_CURRENT";
  trust: {
    annotation_source: "caller_asserted_trusted" | "untrusted";
    server_identity: "not_verified";
    runtime_behavior: "not_verified";
    completeness: "caller_asserted";
  };
  hashes: {
    baseline_snapshot: `sha256:${string}`;
    current_snapshot: `sha256:${string}`;
    baseline_contract: `sha256:${string}`;
    current_contract: `sha256:${string}`;
  };
  summary: {
    baseline_tools: number;
    current_tools: number;
    added: number;
    removed: number;
    changed: number;
    compatible_changes: number;
    review_findings: number;
    breaking_findings: number;
    security_findings: number;
    unknown_relations: number;
  };
  findings: McpDriftFinding[];
  coverage: {
    compared_tools: number;
    schema_nodes: number;
    relation_checks: number;
    proven_subset: number;
    proven_not_subset: number;
    unknown: number;
    returned_findings: number;
    total_findings: number;
    truncated: boolean;
  };
  limitations: string[];
  service_reuse: typeof MCP_DRIFT_SERVICE_REUSE;
}

export class McpDriftError extends Error {
  readonly status: 400 | 413 | 422;
  readonly code: "INVALID_INPUT" | "INPUT_TOO_LARGE" | "UNSUPPORTED_SCHEMA_FEATURE";
  readonly path: string;

  constructor(
    message: string,
    status: 400 | 413 | 422 = 400,
    code: "INVALID_INPUT" | "INPUT_TOO_LARGE" | "UNSUPPORTED_SCHEMA_FEATURE" = "INVALID_INPUT",
    path = "",
  ) {
    super(message);
    this.name = "McpDriftError";
    this.status = status;
    this.code = code;
    this.path = path;
  }
}

const textEncoder = new TextEncoder();
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const SERVER_ID = /^[A-Za-z0-9._:/@+~-]+$/;
const SCHEMA_TYPES = new Set(["null", "boolean", "object", "array", "number", "integer", "string"]);
const SUPPORTED_SCHEMA_KEYS = new Set([
  "$schema", "type", "enum", "const", "properties", "required", "additionalProperties",
  "minProperties", "maxProperties", "items", "minItems", "maxItems", "uniqueItems",
  "minLength", "maxLength", "pattern", "minimum", "maximum", "exclusiveMinimum",
  "exclusiveMaximum", "title", "description", "default", "examples", "deprecated",
  "readOnly", "writeOnly", "format", "$comment",
]);
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  "$vocabulary", "$id", "$anchor", "$dynamicAnchor", "$ref", "$dynamicRef", "$defs",
  "allOf", "anyOf", "oneOf", "not", "if", "then", "else", "patternProperties",
  "propertyNames", "dependentRequired", "dependentSchemas", "unevaluatedProperties",
  "prefixItems", "contains", "minContains", "maxContains", "unevaluatedItems", "multipleOf",
  "contentEncoding", "contentMediaType", "contentSchema",
]);

function utf8Length(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function lexicalCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function pointer(path: string, key: string | number): string {
  const escaped = String(key).replace(/~/g, "~0").replace(/\//g, "~1");
  return `${path}/${escaped}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string, path = ""): never {
  throw new McpDriftError(message, 400, "INVALID_INPUT", path);
}

function unsupported(message: string, path = ""): never {
  throw new McpDriftError(message, 422, "UNSUPPORTED_SCHEMA_FEATURE", path);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const permitted = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!permitted.has(key)) invalid(`Unknown field ${key}.`, pointer(path, key));
  }
}

function requireString(value: unknown, path: string, minBytes: number, maxBytes: number, pattern?: RegExp): string {
  if (typeof value !== "string") invalid("Expected a string.", path);
  const bytes = utf8Length(value);
  if (hasLoneSurrogate(value) || bytes < minBytes || bytes > maxBytes || (pattern && !pattern.test(value))) {
    invalid("String is outside the allowed format or byte bounds.", path);
  }
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid("Expected a boolean.", path);
  return value;
}

function requireNonNegativeSafeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid("Expected a non-negative safe integer.", path);
  }
  return value;
}

/** Reject duplicate object keys before JSON.parse can silently overwrite them. */
export function assertNoDuplicateJsonKeys(raw: string): void {
  let offset = 0;
  const fail = (): never => invalid("Request body must be valid JSON without duplicate object keys.", "");
  const whitespace = () => { while (/\s/.test(raw[offset] || "")) offset += 1; };
  const stringToken = (): string => {
    if (raw[offset] !== '"') fail();
    const start = offset++;
    while (offset < raw.length) {
      const char = raw[offset++];
      if (char === '"') {
        try { return JSON.parse(raw.slice(start, offset)); } catch { fail(); }
      }
      if (char === "\\") {
        if (offset >= raw.length) fail();
        const escape = raw[offset++];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(raw.slice(offset, offset + 4))) fail();
          offset += 4;
        } else if (!'"\\/bfnrt'.includes(escape)) fail();
      } else if (char.charCodeAt(0) < 0x20) fail();
    }
    return fail();
  };
  const value = (): void => {
    whitespace();
    if (raw[offset] === "{") {
      offset += 1;
      whitespace();
      const keys = new Set<string>();
      if (raw[offset] === "}") { offset += 1; return; }
      while (true) {
        whitespace();
        const key = stringToken();
        if (keys.has(key)) invalid(`Duplicate object key ${key}.`, "");
        keys.add(key);
        whitespace();
        if (raw[offset++] !== ":") fail();
        value();
        whitespace();
        const separator = raw[offset++];
        if (separator === "}") return;
        if (separator !== ",") fail();
      }
    }
    if (raw[offset] === "[") {
      offset += 1;
      whitespace();
      if (raw[offset] === "]") { offset += 1; return; }
      while (true) {
        value();
        whitespace();
        const separator = raw[offset++];
        if (separator === "]") return;
        if (separator !== ",") fail();
      }
    }
    if (raw[offset] === '"') { stringToken(); return; }
    const match = raw.slice(offset).match(/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/);
    if (!match) return fail();
    offset += match[0].length;
  };
  value();
  whitespace();
  if (offset !== raw.length) fail();
}

interface ValidationState { schemaNodes: number }

function validateJsonValue(value: unknown, path: string, depth: number): asserts value is JsonValue {
  if (depth > MCP_DRIFT_MAX_DEPTH) invalid("Maximum JSON depth exceeded.", path);
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    if (typeof value === "string" && (hasLoneSurrogate(value) || utf8Length(value) > 32_768)) invalid("String is not valid bounded Unicode text.", path);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      invalid("Numbers must be finite and integers must be safely representable.", path);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 512) invalid("Array exceeds 512 entries.", path);
    value.forEach((item, index) => validateJsonValue(item, pointer(path, index), depth + 1));
    return;
  }
  if (!isObject(value)) invalid("Value is not valid JSON.", path);
  if (Object.keys(value).length > 512) invalid("Object exceeds 512 properties.", path);
  for (const [key, item] of Object.entries(value)) {
    if (hasLoneSurrogate(key) || utf8Length(key) > 32_768) invalid("Object key is not valid bounded Unicode text.", pointer(path, key));
    validateJsonValue(item, pointer(path, key), depth + 1);
  }
}

function validateUniqueJsonArray(value: unknown[], path: string): void {
  const seen = new Set(value.map(item => stableStringify(item as JsonValue)));
  if (seen.size !== value.length) invalid("Array entries must be unique.", path);
}

function validateSchema(value: unknown, path: string, state: ValidationState, depth: number, root: boolean): asserts value is JsonSchema {
  state.schemaNodes += 1;
  if (state.schemaNodes > MCP_DRIFT_MAX_SCHEMA_NODES) invalid("Combined schemas exceed 8,192 nodes.", path);
  if (depth > MCP_DRIFT_MAX_DEPTH) invalid("Maximum schema depth exceeded.", path);
  if (typeof value === "boolean") {
    if (root) invalid("Tool inputSchema and outputSchema roots must be objects.", path);
    return;
  }
  if (!isObject(value)) invalid("Schema must be an object or nested boolean schema.", path);
  if (Object.keys(value).length > 512) invalid("Schema node exceeds 512 properties.", path);
  for (const key of Object.keys(value)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) unsupported(`Unsupported JSON Schema keyword ${key}.`, pointer(path, key));
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) unsupported(`Unknown JSON Schema keyword ${key}.`, pointer(path, key));
  }
  const schema = value as Record<string, unknown>;
  if (schema.$schema !== undefined && schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    unsupported("Only JSON Schema Draft 2020-12 is supported.", pointer(path, "$schema"));
  }
  const keys = Object.keys(schema).filter(key => key !== "$schema");
  if (keys.length > 0) {
    if (typeof schema.type !== "string" || !SCHEMA_TYPES.has(schema.type)) {
      invalid("Every non-empty schema object must declare one supported string type.", pointer(path, "type"));
    }
  }
  if (root && schema.type !== "object") invalid("Tool schema root type must be object.", pointer(path, "type"));
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0 || schema.enum.length > 64) invalid("enum must contain 1 to 64 values.", pointer(path, "enum"));
    schema.enum.forEach((item, index) => validateJsonValue(item, pointer(pointer(path, "enum"), index), depth + 1));
    validateUniqueJsonArray(schema.enum, pointer(path, "enum"));
  }
  if (schema.const !== undefined) validateJsonValue(schema.const, pointer(path, "const"), depth + 1);
  if (schema.properties !== undefined) {
    if (schema.type !== "object" || !isObject(schema.properties)) invalid("properties requires an object schema.", pointer(path, "properties"));
    if (Object.keys(schema.properties).length > 512) invalid("properties exceeds 512 entries.", pointer(path, "properties"));
    for (const [name, child] of Object.entries(schema.properties)) {
      validateSchema(child, pointer(pointer(path, "properties"), name), state, depth + 1, false);
    }
  }
  if (schema.required !== undefined) {
    if (schema.type !== "object" || !Array.isArray(schema.required) || !schema.required.every(item => typeof item === "string")) {
      invalid("required must be a string array on an object schema.", pointer(path, "required"));
    }
    validateUniqueJsonArray(schema.required, pointer(path, "required"));
  }
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") {
    unsupported("Schema-valued additionalProperties is not supported.", pointer(path, "additionalProperties"));
  }
  if (schema.items !== undefined) {
    if (schema.type !== "array") invalid("items requires an array schema.", pointer(path, "items"));
    validateSchema(schema.items, pointer(path, "items"), state, depth + 1, false);
  }
  for (const key of ["minProperties", "maxProperties", "minItems", "maxItems", "minLength", "maxLength"] as const) {
    if (schema[key] !== undefined) requireNonNegativeSafeInteger(schema[key], pointer(path, key));
  }
  for (const key of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"] as const) {
    if (schema[key] !== undefined && (typeof schema[key] !== "number" || !Number.isSafeInteger(schema[key]))) {
      unsupported(`${key} must be a safe integer for this ruleset.`, pointer(path, key));
    }
  }
  if (schema.uniqueItems !== undefined && typeof schema.uniqueItems !== "boolean") invalid("uniqueItems must be boolean.", pointer(path, "uniqueItems"));
  if (schema.pattern !== undefined) requireString(schema.pattern, pointer(path, "pattern"), 0, 2_048);
  for (const key of ["title", "description", "format", "$comment"] as const) {
    if (schema[key] !== undefined) requireString(schema[key], pointer(path, key), 0, 32_768);
  }
  for (const key of ["deprecated", "readOnly", "writeOnly"] as const) {
    if (schema[key] !== undefined) requireBoolean(schema[key], pointer(path, key));
  }
  if (schema.default !== undefined) validateJsonValue(schema.default, pointer(path, "default"), depth + 1);
  if (schema.examples !== undefined) {
    if (!Array.isArray(schema.examples)) invalid("examples must be an array.", pointer(path, "examples"));
    schema.examples.forEach((item, index) => validateJsonValue(item, pointer(pointer(path, "examples"), index), depth + 1));
  }
}

function validateTool(value: unknown, path: string, state: ValidationState): McpTool {
  if (!isObject(value)) invalid("Tool must be an object.", path);
  exactKeys(value, ["name", "title", "description", "icons", "inputSchema", "outputSchema", "annotations", "execution", "_meta"], path);
  requireString(value.name, pointer(path, "name"), 1, 128, TOOL_NAME);
  if (value.title !== undefined) requireString(value.title, pointer(path, "title"), 0, 512);
  if (value.description !== undefined) requireString(value.description, pointer(path, "description"), 0, 16_384);
  if (value.icons !== undefined) {
    if (!Array.isArray(value.icons) || value.icons.length > 8) invalid("icons must contain at most 8 entries.", pointer(path, "icons"));
    value.icons.forEach((icon, index) => {
      const iconPath = pointer(pointer(path, "icons"), index);
      if (!isObject(icon)) invalid("Icon must be an object.", iconPath);
      exactKeys(icon, ["src", "mimeType", "sizes", "theme"], iconPath);
      requireString(icon.src, pointer(iconPath, "src"), 1, 4_096);
      if (icon.mimeType !== undefined) requireString(icon.mimeType, pointer(iconPath, "mimeType"), 0, 128);
      if (icon.theme !== undefined && icon.theme !== "light" && icon.theme !== "dark") invalid("Invalid icon theme.", pointer(iconPath, "theme"));
      if (icon.sizes !== undefined) {
        if (!Array.isArray(icon.sizes) || icon.sizes.length > 16) invalid("Icon sizes must contain at most 16 entries.", pointer(iconPath, "sizes"));
        icon.sizes.forEach((size, sizeIndex) => requireString(size, pointer(pointer(iconPath, "sizes"), sizeIndex), 1, 32));
        validateUniqueJsonArray(icon.sizes, pointer(iconPath, "sizes"));
      }
    });
  }
  validateSchema(value.inputSchema, pointer(path, "inputSchema"), state, 0, true);
  if (value.outputSchema !== undefined) validateSchema(value.outputSchema, pointer(path, "outputSchema"), state, 0, true);
  if (value.annotations !== undefined) {
    const annotationsPath = pointer(path, "annotations");
    if (!isObject(value.annotations)) invalid("annotations must be an object.", annotationsPath);
    exactKeys(value.annotations, ["title", "readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"], annotationsPath);
    if (value.annotations.title !== undefined) requireString(value.annotations.title, pointer(annotationsPath, "title"), 0, 512);
    for (const key of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) {
      if (value.annotations[key] !== undefined) requireBoolean(value.annotations[key], pointer(annotationsPath, key));
    }
  }
  if (value.execution !== undefined) {
    const executionPath = pointer(path, "execution");
    if (!isObject(value.execution)) invalid("execution must be an object.", executionPath);
    exactKeys(value.execution, ["taskSupport"], executionPath);
    if (value.execution.taskSupport !== undefined && !["forbidden", "optional", "required"].includes(String(value.execution.taskSupport))) {
      invalid("Invalid taskSupport value.", pointer(executionPath, "taskSupport"));
    }
  }
  if (value._meta !== undefined) {
    if (!isObject(value._meta)) invalid("_meta must be an object.", pointer(path, "_meta"));
    validateJsonValue(value._meta, pointer(path, "_meta"), 0);
    if (utf8Length(stableStringify(value._meta as JsonValue)) > 16_384) invalid("_meta exceeds 16 KiB.", pointer(path, "_meta"));
  }
  return value as unknown as McpTool;
}

function validateSnapshot(value: unknown, path: string, state: ValidationState): McpSnapshot {
  if (!isObject(value)) invalid("Snapshot must be an object.", path);
  exactKeys(value, ["protocol_version", "complete", "tools"], path);
  if (value.protocol_version !== MCP_PROTOCOL_VERSION) unsupported(`protocol_version must be ${MCP_PROTOCOL_VERSION}.`, pointer(path, "protocol_version"));
  if (value.complete !== true) invalid("complete:true is required after all tools/list pages are aggregated.", pointer(path, "complete"));
  if (!Array.isArray(value.tools) || value.tools.length > MCP_DRIFT_MAX_TOOLS) invalid("tools must contain at most 128 entries.", pointer(path, "tools"));
  const tools = value.tools.map((tool, index) => validateTool(tool, pointer(pointer(path, "tools"), index), state));
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) invalid(`Duplicate case-sensitive tool name ${tool.name}.`, pointer(path, "tools"));
    names.add(tool.name);
  }
  return { protocol_version: MCP_PROTOCOL_VERSION, complete: true, tools };
}

export function validateMcpDriftInput(value: unknown): { input: McpDriftInput; schemaNodes: number } {
  if (!isObject(value)) invalid("Request must be an object.", "");
  exactKeys(value, ["contract_version", "subject", "annotation_source_trust", "baseline", "current"], "");
  if (value.contract_version !== MCP_DRIFT_CONTRACT_VERSION) invalid(`contract_version must be ${MCP_DRIFT_CONTRACT_VERSION}.`, "/contract_version");
  if (!isObject(value.subject)) invalid("subject must be an object.", "/subject");
  exactKeys(value.subject, ["server_id"], "/subject");
  requireString(value.subject.server_id, "/subject/server_id", 1, 256, SERVER_ID);
  if (value.annotation_source_trust !== "trusted" && value.annotation_source_trust !== "untrusted") {
    invalid("annotation_source_trust must be trusted or untrusted.", "/annotation_source_trust");
  }
  const state = { schemaNodes: 0 };
  const baseline = validateSnapshot(value.baseline, "/baseline", state);
  const current = validateSnapshot(value.current, "/current", state);
  return {
    input: {
      contract_version: MCP_DRIFT_CONTRACT_VERSION,
      subject: { server_id: value.subject.server_id as string },
      annotation_source_trust: value.annotation_source_trust,
      baseline,
      current,
    },
    schemaNodes: state.schemaNodes,
  };
}

function stableNormalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (value && typeof value === "object") {
    const result: JsonObject = {};
    for (const key of Object.keys(value).sort()) result[key] = stableNormalize(value[key]);
    return result;
  }
  return value;
}

export function stableStringify(value: JsonValue): string {
  return JSON.stringify(stableNormalize(value));
}

function sortSet(values: JsonValue[]): JsonValue[] {
  return [...values].map(stableNormalize).sort((a, b) => lexicalCompare(stableStringify(a), stableStringify(b)));
}

function normalizeSchema(schema: JsonSchema, root = false): JsonValue {
  if (typeof schema === "boolean") return schema;
  if (Object.keys(schema).length === 0) return root
    ? { $schema: "https://json-schema.org/draft/2020-12/schema" }
    : {};
  const result: JsonObject = {};
  for (const [key, raw] of Object.entries(schema)) {
    if (key === "properties") {
      const properties: JsonObject = {};
      for (const name of Object.keys(raw as JsonObject).sort()) properties[name] = normalizeSchema((raw as JsonObject)[name] as JsonSchema);
      result[key] = properties;
    } else if (key === "items") {
      result[key] = normalizeSchema(raw as JsonSchema);
    } else if (key === "required" || key === "enum") {
      result[key] = sortSet(raw as JsonValue[]);
    } else {
      result[key] = stableNormalize(raw as JsonValue);
    }
  }
  if (root && result.$schema === undefined) result.$schema = "https://json-schema.org/draft/2020-12/schema";
  if (result.type === "object") {
    if (result.properties === undefined) result.properties = {};
    if (result.required === undefined) result.required = [];
    if (result.additionalProperties === undefined) result.additionalProperties = true;
    if (result.minProperties === undefined) result.minProperties = 0;
  } else if (result.type === "array") {
    if (result.items === undefined) result.items = {};
    if (result.minItems === undefined) result.minItems = 0;
    if (result.uniqueItems === undefined) result.uniqueItems = false;
  } else if (result.type === "string" && result.minLength === undefined) {
    result.minLength = 0;
  }
  return stableNormalize(result);
}

function normalizedAnnotations(tool: McpTool): JsonObject {
  return {
    title: tool.annotations?.title ?? null,
    readOnlyHint: tool.annotations?.readOnlyHint ?? false,
    destructiveHint: tool.annotations?.destructiveHint ?? true,
    idempotentHint: tool.annotations?.idempotentHint ?? false,
    openWorldHint: tool.annotations?.openWorldHint ?? true,
  };
}

function normalizeTool(tool: McpTool, contractOnly: boolean): JsonObject {
  const normalized: JsonObject = {
    name: tool.name,
    title: tool.title ?? null,
    description: tool.description ?? null,
    inputSchema: normalizeSchema(tool.inputSchema, true),
    outputSchema: tool.outputSchema === undefined ? null : normalizeSchema(tool.outputSchema, true),
    annotations: normalizedAnnotations(tool),
    execution: { taskSupport: tool.execution?.taskSupport ?? "forbidden" },
  };
  if (!contractOnly) {
    normalized.icons = sortSet((tool.icons || []).map(icon => ({
      src: icon.src,
      mimeType: icon.mimeType ?? null,
      sizes: sortSet((icon.sizes || []) as JsonValue[]),
      theme: icon.theme ?? null,
    })));
    normalized._meta = stableNormalize((tool._meta || {}) as JsonValue);
  }
  return stableNormalize(normalized) as JsonObject;
}

function normalizeSnapshot(snapshot: McpSnapshot, contractOnly: boolean): JsonObject {
  return {
    protocol_version: snapshot.protocol_version,
    complete: true,
    tools: [...snapshot.tools]
      .sort((a, b) => lexicalCompare(a.name, b.name))
      .map(tool => normalizeTool(tool, contractOnly)),
  };
}

async function sha256(value: JsonValue): Promise<`sha256:${string}`> {
  const bytes = await crypto.subtle.digest("SHA-256", textEncoder.encode(stableStringify(value)));
  const hex = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

function schemaObject(schema: JsonSchema): Record<string, JsonValue> | null {
  return typeof schema === "boolean" ? null : schema;
}

function schemaType(schema: JsonSchema): string | null {
  if (schema === true || (typeof schema === "object" && Object.keys(schema).length === 0)) return null;
  if (schema === false) return "never";
  return String(schema.type);
}

function deepEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  return stableStringify((a === undefined ? null : a) as JsonValue) === stableStringify((b === undefined ? null : b) as JsonValue);
}

function validateInstance(value: JsonValue, schema: JsonSchema): boolean {
  if (schema === true) return true;
  if (schema === false) return false;
  if (Object.keys(schema).length === 0) return true;
  const type = schema.type;
  if (type === "null" && value !== null) return false;
  if (type === "boolean" && typeof value !== "boolean") return false;
  if (type === "string" && typeof value !== "string") return false;
  if (type === "number" && (typeof value !== "number" || !Number.isFinite(value))) return false;
  if (type === "integer" && (typeof value !== "number" || !Number.isInteger(value))) return false;
  if (type === "array" && !Array.isArray(value)) return false;
  if (type === "object" && (!isObject(value))) return false;
  if (schema.const !== undefined && !deepEqual(value, schema.const)) return false;
  if (Array.isArray(schema.enum) && !schema.enum.some(item => deepEqual(value, item))) return false;
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && [...value].length < schema.minLength) return false;
    if (typeof schema.maxLength === "number" && [...value].length > schema.maxLength) return false;
    // Pattern-bearing relations never use witness search; do not execute untrusted regexes.
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) return false;
    if (typeof schema.maximum === "number" && value > schema.maximum) return false;
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) return false;
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) return false;
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return false;
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return false;
    if (schema.uniqueItems === true && new Set(value.map(item => stableStringify(item))).size !== value.length) return false;
    const items = (schema.items ?? true) as JsonSchema;
    if (!value.every(item => validateInstance(item, items))) return false;
  }
  if (isObject(value)) {
    const required = new Set((schema.required || []) as string[]);
    if ([...required].some(name => !(name in value))) return false;
    const keys = Object.keys(value);
    if (typeof schema.minProperties === "number" && keys.length < schema.minProperties) return false;
    if (typeof schema.maxProperties === "number" && keys.length > schema.maxProperties) return false;
    const properties = (schema.properties || {}) as Record<string, JsonSchema>;
    for (const [name, item] of Object.entries(value)) {
      if (properties[name] !== undefined) {
        if (!validateInstance(item, properties[name])) return false;
      } else if (schema.additionalProperties === false) return false;
    }
  }
  return true;
}

function hasPattern(schema: JsonSchema): boolean {
  if (typeof schema === "boolean") return false;
  if (schema.pattern !== undefined) return true;
  if (schema.properties && Object.values(schema.properties as JsonObject).some(child => hasPattern(child as JsonSchema))) return true;
  return schema.items !== undefined && hasPattern(schema.items as JsonSchema);
}

function schemaMetadataProjection(schema: JsonSchema): JsonValue {
  if (typeof schema === "boolean") return {};
  const projection: JsonObject = {};
  for (const key of ["title", "description", "default", "examples", "deprecated", "readOnly", "writeOnly", "format", "$comment"] as const) {
    if (schema[key] !== undefined) projection[key] = stableNormalize(schema[key] as JsonValue);
  }
  if (schema.properties) {
    const children: JsonObject = {};
    for (const [name, child] of Object.entries(schema.properties as JsonObject)) {
      const metadata = schemaMetadataProjection(child as JsonSchema);
      if (!deepEqual(metadata, {})) children[name] = metadata;
    }
    if (Object.keys(children).length) projection.properties = children;
  }
  if (schema.items !== undefined) {
    const metadata = schemaMetadataProjection(schema.items as JsonSchema);
    if (!deepEqual(metadata, {})) projection.items = metadata;
  }
  return stableNormalize(projection);
}

function normalizedIcons(tool: McpTool): JsonValue {
  return sortSet((tool.icons || []).map(icon => ({
    src: icon.src,
    mimeType: icon.mimeType ?? null,
    sizes: sortSet((icon.sizes || []) as JsonValue[]),
    theme: icon.theme ?? null,
  })));
}

function sampleForSchema(schema: JsonSchema, depth = 0): JsonValue | undefined {
  if (depth > MCP_DRIFT_MAX_DEPTH || schema === false) return undefined;
  if (schema === true || Object.keys(schema).length === 0) return null;
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum.find(value => validateInstance(value, schema));
  if (schema.type === "null") return null;
  if (schema.type === "boolean") return false;
  if (schema.type === "string") return "x".repeat(Math.max(0, Number(schema.minLength || 0)));
  if (schema.type === "number" || schema.type === "integer") {
    let value = typeof schema.minimum === "number" ? schema.minimum : typeof schema.exclusiveMinimum === "number" ? schema.exclusiveMinimum + 1 : 0;
    if (schema.type === "integer") value = Math.ceil(value);
    return validateInstance(value, schema) ? value : undefined;
  }
  if (schema.type === "array") {
    const itemSchema = (schema.items ?? true) as JsonSchema;
    const item = sampleForSchema(itemSchema, depth + 1);
    const length = Number(schema.minItems || 0);
    const value = Array.from({ length }, () => item ?? null);
    return validateInstance(value, schema) ? value : undefined;
  }
  if (schema.type === "object") {
    const value: JsonObject = {};
    const properties = (schema.properties || {}) as Record<string, JsonSchema>;
    for (const name of (schema.required || []) as string[]) {
      const item = sampleForSchema(properties[name] ?? true, depth + 1);
      if (item === undefined) return undefined;
      value[name] = item;
    }
    return validateInstance(value, schema) ? value : undefined;
  }
  return undefined;
}

function candidateValues(a: JsonSchema, b: JsonSchema): JsonValue[] {
  const candidates: JsonValue[] = [];
  const push = (value: JsonValue | undefined): void => {
    if (value !== undefined && candidates.length < 256) candidates.push(value);
  };
  for (const value of [null, false, true, 0, 1, -1, "", "x", [], {}] as JsonValue[]) push(value);
  for (const schema of [a, b]) {
    if (typeof schema === "boolean") continue;
    push(sampleForSchema(schema));
    if (schema.const !== undefined) push(schema.const);
    if (Array.isArray(schema.enum)) for (const value of schema.enum) push(value);
    for (const key of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"] as const) {
      if (typeof schema[key] === "number") {
        push(schema[key] as number); push((schema[key] as number) - 1); push((schema[key] as number) + 1);
      }
    }
    const properties = (schema.properties || {}) as Record<string, JsonSchema>;
    const required = (schema.required || []) as string[];
    if (required.length > 0) {
      const object: JsonObject = {};
      for (const name of required) {
        const child = properties[name] ?? true;
        object[name] = candidateValues(child, true).find(value => validateInstance(value, child)) ?? null;
      }
      push(object);
      for (const otherSchema of [a, b]) {
        if (typeof otherSchema === "boolean") continue;
        const otherProperties = (otherSchema.properties || {}) as Record<string, JsonSchema>;
        for (const [name, propertySchema] of Object.entries(otherProperties)) {
          for (const item of [sampleForSchema(propertySchema), null, false, true, 0, "", "x"] as Array<JsonValue | undefined>) push(item === undefined ? undefined : { ...object, [name]: item });
          if (candidates.length >= 256) break;
        }
      }
    } else {
      for (const [name, propertySchema] of Object.entries(properties)) {
        for (const item of [sampleForSchema(propertySchema), null, false, true, 0, "", "x"] as Array<JsonValue | undefined>) push(item === undefined ? undefined : { [name]: item });
        if (candidates.length >= 256) break;
      }
    }
    if (schema.type === "object") push({ ...((sampleForSchema(schema) as JsonObject | undefined) || {}), __mcpdrift_extra__: null });
    if (schema.type === "array") {
      const item = (schema.items ?? true) as JsonSchema;
      push([sampleForSchema(item) ?? null]);
    }
  }
  const unique = new Map(candidates.map(value => [stableStringify(value), value]));
  return [...unique.values()].slice(0, 256);
}

function findWitness(a: JsonSchema, b: JsonSchema): JsonValue | undefined {
  if (hasPattern(a) || hasPattern(b)) return undefined;
  return candidateValues(a, b).find(value => validateInstance(value, a) && !validateInstance(value, b));
}

interface RelationResult { relation: Exclude<Relation, "NOT_APPLICABLE">; witness?: JsonValue }

function schemaContradictory(schema: JsonSchema): boolean {
  if (schema === false) return true;
  if (schema === true || Object.keys(schema).length === 0) return false;
  if (Array.isArray(schema.enum) && !schema.enum.some(value => validateInstance(value, schema))) return true;
  const pairs: Array<[unknown, unknown]> = [
    [schema.minLength, schema.maxLength],
    [schema.minItems, schema.maxItems],
    [schema.minProperties, schema.maxProperties],
  ];
  if (pairs.some(([minimum, maximum]) => typeof minimum === "number" && typeof maximum === "number" && minimum > maximum)) return true;
  const lower = typeof schema.exclusiveMinimum === "number" ? schema.exclusiveMinimum : schema.minimum;
  const upper = typeof schema.exclusiveMaximum === "number" ? schema.exclusiveMaximum : schema.maximum;
  if (typeof lower === "number" && typeof upper === "number" && lower > upper) return true;
  if (schema.type === "object") {
    const required = (schema.required || []) as string[];
    if (typeof schema.maxProperties === "number" && required.length > schema.maxProperties) return true;
    const properties = (schema.properties || {}) as Record<string, JsonSchema>;
    if (required.some(name => properties[name] !== undefined && schemaContradictory(properties[name]))) return true;
  }
  if (schema.type === "array" && Number(schema.minItems || 0) > 0 && schema.items !== undefined && schemaContradictory(schema.items as JsonSchema)) return true;
  return false;
}

function proveSubset(a: JsonSchema, b: JsonSchema): RelationResult {
  if (deepEqual(normalizeSchema(a), normalizeSchema(b))) return { relation: "PROVEN_SUBSET" };
  if (schemaContradictory(a) || schemaContradictory(b)) return { relation: "UNKNOWN" };
  if (b === true || (typeof b === "object" && Object.keys(b).length === 0)) return { relation: "PROVEN_SUBSET" };
  if (a === false) return { relation: "UNKNOWN" };
  if (a === true || b === false) {
    const witness = findWitness(a, b);
    return witness === undefined ? { relation: "UNKNOWN" } : { relation: "PROVEN_NOT_SUBSET", witness };
  }
  if (Array.isArray(a.enum) || a.const !== undefined) {
    const values = a.const !== undefined ? [a.const] : a.enum as JsonValue[];
    if (values.every(value => validateInstance(value, b))) return { relation: "PROVEN_SUBSET" };
    const witness = values.find(value => validateInstance(value, a) && !validateInstance(value, b));
    if (witness !== undefined) return { relation: "PROVEN_NOT_SUBSET", witness };
  }
  const typeA = schemaType(a);
  const typeB = schemaType(b);
  const typeSubset = typeA === typeB || (typeA === "integer" && typeB === "number");
  if (!typeSubset) {
    const witness = findWitness(a, b);
    return witness === undefined ? { relation: "UNKNOWN" } : { relation: "PROVEN_NOT_SUBSET", witness };
  }
  if (!deepEqual(a.pattern, b.pattern) && b.pattern !== undefined) return { relation: "UNKNOWN" };
  const lower = (schema: JsonObject): [number, boolean] | null => {
    if (typeof schema.exclusiveMinimum === "number") return [schema.exclusiveMinimum, true];
    if (typeof schema.minimum === "number") return [schema.minimum, false];
    return null;
  };
  const upper = (schema: JsonObject): [number, boolean] | null => {
    if (typeof schema.exclusiveMaximum === "number") return [schema.exclusiveMaximum, true];
    if (typeof schema.maximum === "number") return [schema.maximum, false];
    return null;
  };
  const minKeys = typeA === "string" ? ["minLength", "maxLength"] : typeA === "array" ? ["minItems", "maxItems"] : typeA === "object" ? ["minProperties", "maxProperties"] : [];
  if (minKeys.length) {
    const aMin = Number(a[minKeys[0]] ?? 0);
    const bMin = Number(b[minKeys[0]] ?? 0);
    const aMax = a[minKeys[1]] === undefined ? Infinity : Number(a[minKeys[1]]);
    const bMax = b[minKeys[1]] === undefined ? Infinity : Number(b[minKeys[1]]);
    if (aMin < bMin || aMax > bMax) {
      const witness = findWitness(a, b);
      return witness === undefined ? { relation: "UNKNOWN" } : { relation: "PROVEN_NOT_SUBSET", witness };
    }
  }
  if (typeA === "number" || typeA === "integer") {
    const aLower = lower(a); const bLower = lower(b); const aUpper = upper(a); const bUpper = upper(b);
    const lowerSafe = !bLower || (aLower !== null && (aLower[0] > bLower[0] || (aLower[0] === bLower[0] && (!bLower[1] || aLower[1]))));
    const upperSafe = !bUpper || (aUpper !== null && (aUpper[0] < bUpper[0] || (aUpper[0] === bUpper[0] && (!bUpper[1] || aUpper[1]))));
    if (!lowerSafe || !upperSafe) {
      const witness = findWitness(a, b);
      return witness === undefined ? { relation: "UNKNOWN" } : { relation: "PROVEN_NOT_SUBSET", witness };
    }
  }
  if (typeA === "array") {
    if (b.uniqueItems === true && a.uniqueItems !== true) {
      const witness = findWitness(a, b);
      return witness === undefined ? { relation: "UNKNOWN" } : { relation: "PROVEN_NOT_SUBSET", witness };
    }
    const child = proveSubset((a.items ?? true) as JsonSchema, (b.items ?? true) as JsonSchema);
    if (child.relation !== "PROVEN_SUBSET") return child;
  }
  if (typeA === "object") {
    const requiredA = new Set((a.required || []) as string[]);
    const requiredB = new Set((b.required || []) as string[]);
    if ([...requiredB].some(name => !requiredA.has(name))) {
      const witness = findWitness(a, b);
      return witness === undefined ? { relation: "UNKNOWN" } : { relation: "PROVEN_NOT_SUBSET", witness };
    }
    const propertiesA = (a.properties || {}) as Record<string, JsonSchema>;
    const propertiesB = (b.properties || {}) as Record<string, JsonSchema>;
    if (a.additionalProperties !== false && b.additionalProperties === false) {
      const witness = findWitness(a, b);
      return witness === undefined ? { relation: "UNKNOWN" } : { relation: "PROVEN_NOT_SUBSET", witness };
    }
    for (const [name, childA] of Object.entries(propertiesA)) {
      const childB = propertiesB[name];
      if (childB === undefined) {
        if (b.additionalProperties === false) {
          const witness = findWitness(a, b);
          return witness === undefined ? { relation: "UNKNOWN" } : { relation: "PROVEN_NOT_SUBSET", witness };
        }
        continue;
      }
      const child = proveSubset(childA, childB);
      if (child.relation !== "PROVEN_SUBSET") return child;
    }
    if (a.additionalProperties !== false) {
      for (const [name, childB] of Object.entries(propertiesB)) {
        if (propertiesA[name] === undefined && !deepEqual(normalizeSchema(childB), normalizeSchema(true))) {
          const witness = findWitness(a, b);
          return witness === undefined ? { relation: "UNKNOWN" } : { relation: "PROVEN_NOT_SUBSET", witness };
        }
      }
    }
  }
  return { relation: "PROVEN_SUBSET" };
}

function effectiveAnnotations(tool: McpTool) {
  return {
    title: tool.annotations?.title ?? null,
    readOnlyHint: tool.annotations?.readOnlyHint ?? false,
    destructiveHint: tool.annotations?.destructiveHint ?? true,
    idempotentHint: tool.annotations?.idempotentHint ?? false,
    openWorldHint: tool.annotations?.openWorldHint ?? true,
  };
}

function addFinding(findings: FindingCore[], finding: FindingCore): void {
  findings.push(finding);
}

function relationFinding(
  findings: FindingCore[], tool: string, path: string, direction: "input" | "output", result: RelationResult,
): void {
  if (result.relation === "PROVEN_SUBSET") {
    addFinding(findings, {
      category: direction === "input" ? "INPUT_CONTRACT_RELAXED" : "OUTPUT_CONTRACT_NARROWED",
      severity: "info", tool, path, relation: result.relation,
      reason: direction === "input"
        ? "Every baseline-valid input remains valid under the current declared schema."
        : "Every current-valid structured output remains valid under the baseline declared schema.",
    });
  } else if (result.relation === "PROVEN_NOT_SUBSET") {
    addFinding(findings, {
      category: direction === "input" ? "INPUT_CONTRACT_NARROWED" : "OUTPUT_CONTRACT_WIDENED",
      severity: "breaking", tool, path, relation: result.relation, witness: result.witness,
      reason: direction === "input"
        ? "A bounded synthetic input is accepted by the baseline schema and rejected by the current schema."
        : "A bounded synthetic output is accepted by the current schema and rejected by the baseline schema.",
    });
  } else {
    addFinding(findings, {
      category: direction === "input" ? "INPUT_RELATION_UNKNOWN" : "OUTPUT_RELATION_UNKNOWN",
      severity: "review", tool, path, relation: "UNKNOWN",
      reason: "The bounded structural prover cannot establish this changed schema relation.",
    });
  }
}

async function findingWithId(core: FindingCore): Promise<McpDriftFinding> {
  const safe = { ...core };
  if (safe.witness !== undefined) {
    safe.witness_hash = await sha256(safe.witness);
    delete safe.witness;
  }
  const safeCore = safe as unknown as JsonObject;
  return { id: await sha256(safeCore), ...safe };
}

const severityRank: Record<FindingSeverity, number> = { security: 3, breaking: 2, review: 1, info: 0 };

export async function analyzeMcpDrift(value: unknown): Promise<McpDriftResult> {
  const { input, schemaNodes } = validateMcpDriftInput(value);
  const baselineSnapshot = normalizeSnapshot(input.baseline, false);
  const currentSnapshot = normalizeSnapshot(input.current, false);
  const baselineContract = normalizeSnapshot(input.baseline, true);
  const currentContract = normalizeSnapshot(input.current, true);
  const hashes = {
    baseline_snapshot: await sha256(baselineSnapshot),
    current_snapshot: await sha256(currentSnapshot),
    baseline_contract: await sha256(baselineContract),
    current_contract: await sha256(currentContract),
  };
  const baselineTools = new Map(input.baseline.tools.map(tool => [tool.name, tool]));
  const currentTools = new Map(input.current.tools.map(tool => [tool.name, tool]));
  const findings: FindingCore[] = [];
  let relationChecks = 0;
  let provenSubset = 0;
  let provenNotSubset = 0;
  let unknown = 0;
  let added = 0;
  let removed = 0;
  let changed = 0;

  for (const [name] of baselineTools) {
    if (!currentTools.has(name)) {
      removed += 1;
      addFinding(findings, { category: "TOOL_REMOVED", severity: "breaking", tool: name, path: `/tools/${name}`, relation: "PROVEN_NOT_SUBSET", reason: "A case-sensitive baseline tool name is absent from the current snapshot." });
    }
  }
  for (const [name] of currentTools) {
    if (!baselineTools.has(name)) {
      added += 1;
      addFinding(findings, { category: "CAPABILITY_ADDED", severity: "review", tool: name, path: `/tools/${name}`, relation: "NOT_APPLICABLE", reason: "A model-controlled capability was added and requires explicit review." });
    }
  }

  for (const [name, before] of baselineTools) {
    const after = currentTools.get(name);
    if (!after) continue;
    const beforeNormalized = normalizeTool(before, false);
    const afterNormalized = normalizeTool(after, false);
    if (deepEqual(beforeNormalized, afterNormalized)) continue;
    changed += 1;
    const metadataFields = ["title", "description"] as const;
    for (const field of metadataFields) {
      if (before[field] !== after[field]) {
        addFinding(findings, {
          category: "MODEL_OR_UI_METADATA_CHANGED", severity: "review", tool: name, path: `/tools/${name}/${field}`,
          relation: "NOT_APPLICABLE", before_hash: await sha256((before[field] ?? null) as JsonValue), after_hash: await sha256((after[field] ?? null) as JsonValue),
          reason: "Model-facing or UI-facing metadata changed; raw text is intentionally not echoed.",
        });
      }
    }
    const beforeIcons = normalizedIcons(before);
    const afterIcons = normalizedIcons(after);
    if (!deepEqual(beforeIcons, afterIcons)) {
      const previousSvg = new Set((before.icons || []).filter(icon => icon.src.toLowerCase().endsWith(".svg") || icon.mimeType?.toLowerCase() === "image/svg+xml").map(icon => stableStringify(stableNormalize(icon as unknown as JsonValue))));
      const activeSvg = (after.icons || []).some(icon => (icon.src.toLowerCase().endsWith(".svg") || icon.mimeType?.toLowerCase() === "image/svg+xml") && !previousSvg.has(stableStringify(stableNormalize(icon as unknown as JsonValue))));
      addFinding(findings, {
        category: activeSvg ? "ACTIVE_ICON_SURFACE_ADDED" : "ICON_SURFACE_CHANGED",
        severity: activeSvg ? "security" : "review", tool: name, path: `/tools/${name}/icons`, relation: "NOT_APPLICABLE",
        before_hash: await sha256(beforeIcons), after_hash: await sha256(afterIcons),
        reason: activeSvg ? "The current icon surface includes SVG content, which clients must not treat as inert." : "The client-visible icon surface changed; icon URLs were not fetched.",
      });
    }
    if (!deepEqual((before._meta || {}) as JsonValue, (after._meta || {}) as JsonValue)) {
      addFinding(findings, {
        category: "OPAQUE_METADATA_CHANGED", severity: "review", tool: name, path: `/tools/${name}/_meta`, relation: "NOT_APPLICABLE",
        before_hash: await sha256((before._meta || {}) as JsonValue), after_hash: await sha256((after._meta || {}) as JsonValue),
        reason: "Opaque metadata changed; values are intentionally not interpreted or echoed.",
      });
    }
    const beforeAnnotations = effectiveAnnotations(before);
    const afterAnnotations = effectiveAnnotations(after);
    const securityTransitions: Array<[keyof typeof beforeAnnotations, string]> = [
      ["readOnlyHint", "READ_ONLY_WEAKENED"],
      ["destructiveHint", "DESTRUCTIVE_RISK_INCREASED"],
      ["idempotentHint", "IDEMPOTENCY_WEAKENED"],
      ["openWorldHint", "OPEN_WORLD_EXPANDED"],
    ];
    for (const [key, category] of securityTransitions) {
      const previous = beforeAnnotations[key];
      const current = afterAnnotations[key];
      const regression = key === "readOnlyHint" || key === "idempotentHint"
        ? previous === true && current === false
        : previous === false && current === true;
      const meaningful = key === "destructiveHint" || key === "idempotentHint" ? afterAnnotations.readOnlyHint === false : true;
      if (regression && meaningful) {
        addFinding(findings, { category, severity: "security", tool: name, path: `/tools/${name}/annotations/${key}`, relation: "NOT_APPLICABLE", before: previous, after: current, reason: "The server's declared safety hint became less restrictive; annotations remain untrusted behavioral evidence." });
      } else if (previous !== current) {
        addFinding(findings, { category: "ANNOTATION_CHANGED", severity: "review", tool: name, path: `/tools/${name}/annotations/${key}`, relation: "NOT_APPLICABLE", before: previous, after: current, reason: "A declared tool annotation changed; it is not behavioral proof." });
      }
    }
    if (beforeAnnotations.title !== afterAnnotations.title) {
      addFinding(findings, { category: "MODEL_OR_UI_METADATA_CHANGED", severity: "review", tool: name, path: `/tools/${name}/annotations/title`, relation: "NOT_APPLICABLE", reason: "The annotation title changed; raw text is intentionally not echoed." });
    }
    const taskBefore = before.execution?.taskSupport ?? "forbidden";
    const taskAfter = after.execution?.taskSupport ?? "forbidden";
    if (taskBefore !== taskAfter) {
      const safe = (taskBefore === "forbidden" || taskBefore === "required") && taskAfter === "optional";
      addFinding(findings, {
        category: safe ? "TASK_SUPPORT_RELAXED" : "TASK_SUPPORT_INCOMPATIBLE",
        severity: safe ? "info" : "breaking", tool: name, path: `/tools/${name}/execution/taskSupport`,
        relation: safe ? "PROVEN_SUBSET" : "PROVEN_NOT_SUBSET", before: taskBefore, after: taskAfter,
        reason: safe ? "Current task support preserves the baseline invocation mode." : "Current task support removes the baseline invocation mode.",
      });
    }
    if (!deepEqual(normalizeSchema(before.inputSchema), normalizeSchema(after.inputSchema))) {
      const beforeMetadata = schemaMetadataProjection(before.inputSchema);
      const afterMetadata = schemaMetadataProjection(after.inputSchema);
      if (!deepEqual(beforeMetadata, afterMetadata)) {
        addFinding(findings, {
          category: "MODEL_OR_UI_METADATA_CHANGED", severity: "review", tool: name,
          path: `/tools/${name}/inputSchema`, relation: "NOT_APPLICABLE",
          before_hash: await sha256(beforeMetadata), after_hash: await sha256(afterMetadata),
          reason: "Model-facing or generator-facing input schema metadata changed; raw values are intentionally not echoed.",
        });
      }
      const relation = proveSubset(before.inputSchema, after.inputSchema);
      relationChecks += 1;
      if (relation.relation === "PROVEN_SUBSET") provenSubset += 1;
      else if (relation.relation === "PROVEN_NOT_SUBSET") provenNotSubset += 1;
      else unknown += 1;
      relationFinding(findings, name, `/tools/${name}/inputSchema`, "input", relation);
    }
    const beforeOutput: JsonSchema = before.outputSchema ?? true;
    const afterOutput: JsonSchema = after.outputSchema ?? true;
    if (!deepEqual(normalizeSchema(beforeOutput), normalizeSchema(afterOutput))) {
      const beforeMetadata = schemaMetadataProjection(beforeOutput);
      const afterMetadata = schemaMetadataProjection(afterOutput);
      if (!deepEqual(beforeMetadata, afterMetadata)) {
        addFinding(findings, {
          category: "MODEL_OR_UI_METADATA_CHANGED", severity: "review", tool: name,
          path: `/tools/${name}/outputSchema`, relation: "NOT_APPLICABLE",
          before_hash: await sha256(beforeMetadata), after_hash: await sha256(afterMetadata),
          reason: "Model-facing or generator-facing output schema metadata changed; raw values are intentionally not echoed.",
        });
      }
      const relation = proveSubset(afterOutput, beforeOutput);
      relationChecks += 1;
      if (relation.relation === "PROVEN_SUBSET") provenSubset += 1;
      else if (relation.relation === "PROVEN_NOT_SUBSET") provenNotSubset += 1;
      else unknown += 1;
      relationFinding(findings, name, `/tools/${name}/outputSchema`, "output", relation);
    }
  }

  const withIds = await Promise.all(findings.map(findingWithId));
  withIds.sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || lexicalCompare(a.tool || "", b.tool || "") || lexicalCompare(a.path, b.path) || lexicalCompare(a.category, b.category) || lexicalCompare(a.id, b.id));
  const truncated = withIds.length > MCP_DRIFT_MAX_FINDINGS;
  const returned = withIds.slice(0, MCP_DRIFT_MAX_FINDINGS);
  const securityFindings = withIds.filter(item => item.severity === "security").length;
  const breakingFindings = withIds.filter(item => item.severity === "breaking").length;
  const reviewFindings = withIds.filter(item => item.severity === "review").length;
  const infoFindings = withIds.filter(item => item.severity === "info").length;
  let verdict: McpDriftVerdict;
  if (securityFindings) verdict = "SECURITY_REGRESSION";
  else if (breakingFindings) verdict = "BREAKING";
  else if (truncated || unknown) verdict = "INCONCLUSIVE";
  else if (reviewFindings) verdict = "REVIEW";
  else if (infoFindings) verdict = "SAFE_ADDITIVE";
  else verdict = "UNCHANGED";
  const action = verdict === "UNCHANGED" || verdict === "SAFE_ADDITIVE"
    ? "ACCEPT_CURRENT"
    : verdict === "REVIEW"
      ? "REVIEW_CURRENT"
      : verdict === "SECURITY_REGRESSION"
        ? "BLOCK_CURRENT"
        : "HOLD_BASELINE";

  return {
    service: "MCPDriftVerdict",
    contract_version: MCP_DRIFT_CONTRACT_VERSION,
    ruleset_version: MCP_DRIFT_RULESET_VERSION,
    subject: { server_id: input.subject.server_id, identity: "caller_asserted" },
    verdict,
    action,
    trust: {
      annotation_source: input.annotation_source_trust === "trusted" ? "caller_asserted_trusted" : "untrusted",
      server_identity: "not_verified",
      runtime_behavior: "not_verified",
      completeness: "caller_asserted",
    },
    hashes,
    summary: {
      baseline_tools: input.baseline.tools.length,
      current_tools: input.current.tools.length,
      added,
      removed,
      changed,
      compatible_changes: infoFindings,
      review_findings: reviewFindings,
      breaking_findings: breakingFindings,
      security_findings: securityFindings,
      unknown_relations: unknown,
    },
    findings: returned,
    coverage: {
      compared_tools: [...baselineTools.keys()].filter(name => currentTools.has(name)).length,
      schema_nodes: schemaNodes,
      relation_checks: relationChecks,
      proven_subset: provenSubset,
      proven_not_subset: provenNotSubset,
      unknown,
      returned_findings: returned.length,
      total_findings: withIds.length,
      truncated,
    },
    limitations: [
      "MCPDriftVerdict compares caller-supplied declared contracts only; it does not verify server identity, pagination, runtime behavior, authorization, or annotation truthfulness.",
      "Catalog text, icon URLs, and opaque metadata are treated as untrusted data and are never fetched, executed, or followed.",
      input.annotation_source_trust === "untrusted"
        ? "MCP clients must not make tool-use decisions from untrusted annotations."
        : "Caller-declared annotation trust does not turn annotations into behavioral guarantees.",
    ],
    service_reuse: MCP_DRIFT_SERVICE_REUSE,
  };
}

export async function parseAndAnalyzeMcpDrift(raw: string): Promise<McpDriftResult> {
  if (utf8Length(raw) > MCP_DRIFT_MAX_BODY_BYTES) {
    throw new McpDriftError("Request body exceeds 524,288 UTF-8 bytes.", 413, "INPUT_TOO_LARGE", "");
  }
  assertNoDuplicateJsonKeys(raw);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { invalid("Request body must be valid JSON.", ""); }
  return analyzeMcpDrift(value);
}
