// FENCED FORK FEATURE — agent home-workspace pin configuration.
// Owning commit: 0dafdde.
// Rollback: inline inheritance + normalization into domain/agents.ts; remove this module.

export function inheritHomeWorkspacePin(base: string | undefined, override: unknown): unknown {
  return override !== undefined ? override : base;
}

export function normalizeHomeWorkspacePin(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}
