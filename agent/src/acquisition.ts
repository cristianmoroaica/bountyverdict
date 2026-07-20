export const PUBLISHED_SKILLS = Object.freeze([
  "route-github-agent-checks",
  "audit-agent-harness",
  "check-mcp-tool-drift",
  "classify-github-flakes",
  "diagnose-github-actions",
  "preflight-agent-skills",
  "preflight-github-bounties",
] as const);

export type PublishedSkill = typeof PUBLISHED_SKILLS[number];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseSkillsShInstallCounts(
  html: string,
  repository = "cristianmoroaica/bountyverdict",
): { total: number; by_skill: Record<PublishedSkill, number> } {
  const bySkill = {} as Record<PublishedSkill, number>;
  for (const skill of PUBLISHED_SKILLS) {
    const path = `/${repository}/${skill}`;
    const pattern = new RegExp(
      `href=["']${escapeRegExp(path)}["'](?:(?!</a>)[\\s\\S]){0,700}?<span[^>]*>([\\d,]+)</span>`,
    );
    const match = html.match(pattern);
    if (!match) throw new Error(`skills.sh did not expose an install count for ${skill}.`);
    const value = Number(match[1].replaceAll(",", ""));
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`skills.sh exposed an invalid install count for ${skill}.`);
    }
    bySkill[skill] = value;
  }
  return {
    total: Object.values(bySkill).reduce((sum, value) => sum + value, 0),
    by_skill: bySkill,
  };
}
