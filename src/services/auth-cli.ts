// gaia auth → same canonical refresh/check seam as boot, runner, Accounts UI.
import "../harness/index.js";
import { reconcileAccount, reconcileAccounts } from "./account-auth.js";

export async function runAuthCli(args: string[]): Promise<number> {
  const command = args[0] ?? "status";
  if (command === "help" || command === "--help") {
    console.log("gaia auth status | refresh <account-id>");
    return 0;
  }
  if (command === "status") {
    const results = await reconcileAccounts();
    for (const [id, result] of results) console.log(`${id}\t${result.status}${result.failure ? `\t${result.failure}` : ""}`);
    return [...results.values()].every((result) => result.status === "ok") ? 0 : 1;
  }
  if (command === "refresh") {
    const id = args[1];
    if (!id) throw new Error("usage: gaia auth refresh <account-id>");
    const result = await reconcileAccount(id);
    console.log(`${id}\t${result.status}${result.failure ? `\t${result.failure}` : ""}`);
    return result.status === "ok" ? 0 : 1;
  }
  throw new Error(`unknown gaia auth command '${command}'`);
}
