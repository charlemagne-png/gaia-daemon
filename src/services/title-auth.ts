import { listAccounts } from "../domain/accounts.js";

/** Room-title refinement is daemon chrome, not any one agent's turn. Use a
 * named account from ~/.gaia/accounts.json so it never depends on the stale
 * ambient ~/.pi/agent login. GAIA_TITLE_ACCOUNT pins an explicit account;
 * otherwise the first provider-capable account wins. */
export function resolveTitleLlmAccount(provider: string): string | undefined {
  const override = process.env.GAIA_TITLE_ACCOUNT?.trim();
  if (override) return override;
  return listAccounts().find((account) => account.providers?.includes(provider))?.id;
}
