import test from "node:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const designTest = join(import.meta.dir, "../design/test/artifact-revisions.test.js");
if (existsSync(designTest)) await import("../design/test/artifact-revisions.test.js");
else test.skip("source-only design artifact-revisions tests unavailable in this checkout", () => {});
