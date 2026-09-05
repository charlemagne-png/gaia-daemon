// Canonical named-account seam → migration, refresh, validation, write-back.
import { chmodSync, copyFileSync, existsSync } from "node:fs";
import { findAccount, listAccounts, replaceAccountCredentials, accountsPath, type AccountRecord } from "../domain/accounts.js";
import { harnessSpecFor, type AccountCredentialContext, type AccountCredentialResult } from "../harness/spec.js";

const MIGRATION_BACKUP = `${accountsPath()}.bak-20260905`;

function contextFor(account: AccountRecord): AccountCredentialContext {
  return { id: account.id, providers: account.providers ?? [] };
}

function safeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[A-Za-z0-9._~-]{24,}/g, "[redacted]").slice(0, 240);
}

export function normalizeAccounts(): void {
  if (!existsSync(accountsPath())) return;
  if (!existsSync(MIGRATION_BACKUP)) copyFileSync(accountsPath(), MIGRATION_BACKUP);
  chmodSync(accountsPath(), 0o600);
  chmodSync(MIGRATION_BACKUP, 0o600);
  for (const account of listAccounts()) {
    const spec = harnessSpecFor(account.harness).accounts;
    const credentials = spec?.normalize?.(account.credentials, contextFor(account));
    if (credentials) replaceAccountCredentials(account.id, credentials);
  }
}

export async function reconcileAccount(id: string): Promise<AccountCredentialResult> {
  const account = findAccount(id);
  if (!account) throw new Error(`unknown account '${id}'`);
  const spec = harnessSpecFor(account.harness).accounts;
  if (!spec?.reconcile) {
    const result: AccountCredentialResult = { credentials: account.credentials, status: "error", failure: "account harness has no refresh/check seam" };
    replaceAccountCredentials(id, result.credentials, undefined, { status: result.status, checkedAt: new Date().toISOString(), failure: result.failure });
    return result;
  }
  let result: AccountCredentialResult;
  try {
    result = await spec.reconcile(account.credentials, contextFor(account));
  } catch (error) {
    result = { credentials: account.credentials, status: "error", failure: safeFailure(error) };
  }
  replaceAccountCredentials(id, result.credentials, spec.email?.(result.credentials), {
    status: result.status,
    checkedAt: new Date().toISOString(),
    failure: result.failure,
  });
  return result;
}

export async function reconcileAccounts(): Promise<Map<string, AccountCredentialResult>> {
  normalizeAccounts();
  const accounts = listAccounts();
  const settled = await Promise.all(accounts.map(async (account) => [account.id, await reconcileAccount(account.id)] as const));
  return new Map(settled);
}

export function readBackAccount(id: string): void {
  const account = findAccount(id);
  if (!account) return;
  const spec = harnessSpecFor(account.harness).accounts;
  const credentials = spec?.readBack?.(account.credentials, contextFor(account));
  if (credentials) replaceAccountCredentials(id, credentials, spec?.email?.(credentials));
}
