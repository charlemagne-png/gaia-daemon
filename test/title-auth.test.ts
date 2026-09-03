import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTitleLlmAccount } from "../src/services/title-auth.js";

async function withGaiaHome<T>(fn: () => Promise<T>): Promise<T> {
  const prevHome = process.env.GAIA_HOME;
  const prevTitleAccount = process.env.GAIA_TITLE_ACCOUNT;
  process.env.GAIA_HOME = await mkdtemp(join(tmpdir(), "gaia-title-auth-"));
  delete process.env.GAIA_TITLE_ACCOUNT;
  try {
    return await fn();
  } finally {
    if (prevHome === undefined) delete process.env.GAIA_HOME;
    else process.env.GAIA_HOME = prevHome;
    if (prevTitleAccount === undefined) delete process.env.GAIA_TITLE_ACCOUNT;
    else process.env.GAIA_TITLE_ACCOUNT = prevTitleAccount;
  }
}

test("title LLM account resolves from override, else first provider-capable account", async () => {
  await withGaiaHome(async () => {
    await writeFile(
      join(process.env.GAIA_HOME!, "accounts.json"),
      JSON.stringify({
        accounts: [
          { id: "codex-work", harness: "pi", providers: ["openai-codex"], credentials: {} },
          { id: "paloptic-pascal-cl1", harness: "pi", providers: ["anthropic"], credentials: {} },
          { id: "later-anthropic", harness: "pi", providers: ["anthropic"], credentials: {} },
        ],
      }),
      "utf8",
    );

    assert.equal(resolveTitleLlmAccount("anthropic"), "paloptic-pascal-cl1");
    process.env.GAIA_TITLE_ACCOUNT = "forced-title-account";
    assert.equal(resolveTitleLlmAccount("anthropic"), "forced-title-account");
  });
});
