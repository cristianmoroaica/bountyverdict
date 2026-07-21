export const ASKILL_REPOSITORY = "cristianmoroaica/bountyverdict-mcp-skill";
export const ASKILL_OWNER = "cristianmoroaica";
export const ASKILL_REPO = "bountyverdict-mcp-skill";
export const ASKILL_SKILL_NAME = "route-github-agent-decisions";
export const ASKILL_PATH = `skills/${ASKILL_SKILL_NAME}`;
export const ASKILL_FILE_PATH = `${ASKILL_PATH}/SKILL.md`;
export const ASKILL_INSTALL_REF = `gh:${ASKILL_REPOSITORY}@${ASKILL_SKILL_NAME}`;

function boundedString(value: unknown, label: string, maximum = 2_000): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error(`askill ${label} is malformed.`);
  }
  return value;
}

function counter(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`askill ${label} is malformed.`);
  return Number(value);
}

function optionalScore(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`askill ${label} is malformed.`);
  }
  return value;
}

export function parseAskillSearchPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("askill returned a malformed search payload.");
  }
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.data) || payload.data.length > 100 ||
    !payload.pagination || typeof payload.pagination !== "object" || Array.isArray(payload.pagination)) {
    throw new Error("askill returned malformed or unbounded search telemetry.");
  }
  const pagination = payload.pagination as Record<string, unknown>;
  if (counter(pagination.page, "page") !== 1 || counter(pagination.limit, "limit") > 100 ||
    counter(pagination.total, "catalog total") < payload.data.length || typeof pagination.hasMore !== "boolean") {
    throw new Error("askill pagination is malformed or unbounded.");
  }

  const repositoryEntries = payload.data.filter((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("askill returned a malformed skill entry.");
    }
    const entry = value as Record<string, unknown>;
    return entry.repoOwner === ASKILL_OWNER && entry.repoName === ASKILL_REPO;
  }) as Array<Record<string, unknown>>;
  if (repositoryEntries.length > 1) throw new Error("askill duplicated the adapter listing.");

  const entry = repositoryEntries[0];
  if (!entry) {
    return {
      listed: false,
      listed_skills: 0,
      expected_skills: 1,
      catalog_total: Number(pagination.total),
      status: "not_indexed",
    };
  }
  if (!Array.isArray(entry.tags) || entry.tags.length > 50 ||
    entry.tags.some((tag) => typeof tag !== "string" || tag.length === 0 || tag.length > 100)) {
    throw new Error("askill tags are malformed or unbounded.");
  }
  const exact = boundedString(entry.name, "name", 200) === ASKILL_SKILL_NAME &&
    boundedString(entry.skillName, "skill name", 200) === ASKILL_SKILL_NAME &&
    boundedString(entry.installRef, "install reference", 500) === ASKILL_INSTALL_REF &&
    boundedString(entry.path, "path", 500) === ASKILL_PATH &&
    boundedString(entry.filePath, "file path", 500) === ASKILL_FILE_PATH &&
    entry.nameUniqueInRepo === true && entry.source === "submit";
  if (!exact) {
    return {
      listed: false,
      listed_skills: 0,
      expected_skills: 1,
      catalog_total: Number(pagination.total),
      status: "contract_drift",
    };
  }
  const id = counter(entry.id, "entry ID");
  const updatedAt = boundedString(entry.updatedAt, "updated timestamp", 64);
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error("askill updated timestamp is malformed.");
  return {
    listed: true,
    listed_skills: 1,
    expected_skills: 1,
    catalog_total: Number(pagination.total),
    entry_id: id,
    listing_url: `https://askill.sh/skills/${id}`,
    install_source: ASKILL_INSTALL_REF,
    favorites: counter(entry.favoriteCount, "favorite count"),
    repository_stars: counter(entry.stars, "repository stars"),
    ai_score: optionalScore(entry.aiScore, "AI score"),
    llm_score: optionalScore(entry.llmScore, "LLM score"),
    tags: [...entry.tags] as string[],
    updated_at: updatedAt,
    status: "listed",
  };
}
