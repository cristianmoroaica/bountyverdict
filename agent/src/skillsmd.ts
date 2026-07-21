export const SKILLS_MD_REPOSITORY = "cristianmoroaica/bountyverdict-mcp-skill";
export const SKILLS_MD_SKILL_NAME = "route-github-agent-decisions";
export const SKILLS_MD_ENTRY_ID = `${SKILLS_MD_REPOSITORY}/${SKILLS_MD_SKILL_NAME}`;

type SkillsMdEntry = {
  id: string;
  name: string;
  repo: string;
  description: string;
  installs: number;
  stars: number;
  forks: number;
  tags: string[];
  updated: string;
};

function boundedString(value: unknown, label: string, maximum = 2_000): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error(`SkillsMD ${label} is malformed.`);
  }
  return value;
}

function counter(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`SkillsMD ${label} is malformed.`);
  return Number(value);
}

function normalizeEntry(value: unknown): SkillsMdEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SkillsMD returned a malformed skill entry.");
  }
  const entry = value as Record<string, unknown>;
  if (!Array.isArray(entry.tags) || entry.tags.length > 50 ||
    entry.tags.some((tag) => typeof tag !== "string" || tag.length === 0 || tag.length > 100)) {
    throw new Error("SkillsMD tags are malformed or unbounded.");
  }
  if (entry.language !== null && typeof entry.language !== "string") {
    throw new Error("SkillsMD language is malformed.");
  }
  if (typeof entry.trending !== "boolean" || typeof entry.hot !== "boolean" ||
    typeof entry.change !== "number" || !Number.isFinite(entry.change)) {
    throw new Error("SkillsMD ranking state is malformed.");
  }
  const updated = boundedString(entry.updated, "updated date", 32);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updated)) throw new Error("SkillsMD updated date is malformed.");
  return {
    id: boundedString(entry.id, "entry ID", 500),
    name: boundedString(entry.name, "name", 200),
    repo: boundedString(entry.repo, "repository", 500),
    description: boundedString(entry.desc, "description"),
    installs: counter(entry.installs, "installs"),
    stars: counter(entry.stars, "stars"),
    forks: counter(entry.forks, "forks"),
    tags: [...entry.tags] as string[],
    updated,
  };
}

export function parseSkillsMdSearchPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SkillsMD returned a malformed search payload.");
  }
  const payload = value as Record<string, unknown>;
  if (payload.query !== SKILLS_MD_SKILL_NAME || !Array.isArray(payload.results) || payload.results.length > 100 ||
    !Number.isSafeInteger(payload.total) || Number(payload.total) < 0 || Number(payload.total) < payload.results.length) {
    throw new Error("SkillsMD returned malformed, mismatched, or unbounded search telemetry.");
  }
  const entries = payload.results.map(normalizeEntry);
  const repoEntries = entries.filter(({ repo }) => repo === SKILLS_MD_REPOSITORY);
  const exact = repoEntries.filter(({ id, name, tags }) =>
    id === SKILLS_MD_ENTRY_ID && name === SKILLS_MD_SKILL_NAME && tags.includes("agent-skills")
  );
  if (repoEntries.length > 1 || exact.length > 1) throw new Error("SkillsMD duplicated the adapter listing.");
  const listed = exact.length === 1;
  const entry = exact[0];
  return {
    listed,
    listed_skills: listed ? 1 : 0,
    expected_skills: 1,
    catalog_total: Number(payload.total),
    installs: entry?.installs || 0,
    stars: entry?.stars || 0,
    forks: entry?.forks || 0,
    tags: entry?.tags || [],
    updated: entry?.updated || null,
    status: listed ? "listed" : repoEntries.length ? "contract_drift" : "pending_review",
  };
}
