import test from "node:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const designTest = join(import.meta.dir, "../design/test/artifacts-adversarial.test.js");
if (existsSync(designTest)) await import("../design/test/artifacts-adversarial.test.js");
else test.skip("source-only design artifacts-adversarial tests unavailable in this checkout", () => {});
