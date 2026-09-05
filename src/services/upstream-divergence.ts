import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const UPSTREAM_REMOTE = "upstream";
const UPSTREAM_URL = "https://github.com/pascaldisse/gaia-daemon.git";
const DEFAULT_UPSTREAM_REF = "upstream/main";
const MAPPER = join(homedir(), ".gaia", "skills", "upstream-divergence", "divergence-map.ts");

const FEATURE_RULES = [
  ["Autonomous room goals", "Durable room objectives that continue and recover across turns.", /\bgoal\b|room objective/],
  ["Room storage + transcript durability", "Coordinates room state and transcript writers so crashes and concurrent processes do not lose work.", /roomstore|room store|room-state|room state|transcript|cursor|append|fsync|lost update|room lifecycle|room directory/],
  ["Summon delivery", "Tracks child-room completion and delivers durable results back to parent rooms.", /summon|delivery|delegat|child.?room|resume seal|settle/],
  ["Plugin lifecycle", "Loads and reloads plugins while preserving manifest, lease, and shutdown boundaries.", /plugin|manifest|addon/],
  ["Server route architecture", "Separates HTTP route domains and shared request adapters.", /server|route|http|endpoint/],
  ["Sidebar + workspace UI", "Changes room navigation, status, favorites, tabs, and workspace controls.", /sidebar|favorite|tab|unread|workspace ui|room tree/],
  ["Rebuild + runtime assets", "Builds and atomically replaces the compiled app and bundled runtime assets.", /rebuild|bundle|runtime asset|compiled/],
  ["Memory + recall", "Changes memory search, recall filtering, compaction, or context retention.", /memory|recall|compact|context/],
  ["Voice + calls", "Changes voice sessions, audio transport, or call recovery.", /voice|audio|call|speech/],
  ["Harness + agent runtime", "Changes harness-neutral runtime, model execution, or agent event plumbing.", /harness|agent runtime|runnerhost|agent event|tool call/],
  ["Accounts + authentication", "Changes provider accounts, login, credentials, or model selection.", /account|auth|oauth|login|credential|model/],
  ["Artifacts + design", "Changes artifact generation, design surfaces, or extracted web assets.", /artifact|design|canvas/],
  ["Scheduling + automation", "Changes scheduled jobs, hooks, queues, or background automation.", /schedul|automation|hook|queue|background/],
  ["Build + engineering policy", "Changes checks, tests, documentation, release process, or repository policy.", /\btest\b|\bdocs?\b|build|check|release|refactor law|inventory|plan/],
] as const;

export type UpstreamCommit = { sha: string; subject: string; files: string[] };
export type DigestFeature = {
  name: string;
  description: string;
  commits: string[];
  files: string[];
  subsystems: string[];
  verdict: "STEAL-candidate" | "conflicts-with-ours" | "already-ported" | "ours-stronger";
};

async function run(repo: string, command: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command.join(" ")} failed${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

function normalizedSubject(subject: string): string {
  return subject.toLowerCase().replace(/^(merge|feat|fix|refactor|test|docs?|build|chore|room|rooms|services?|web|ui|sidebar|goal|store|archive)(\([^)]*\))?:?\s*/, "").trim();
}

function featureRule(commit: UpstreamCommit): readonly [string, string, RegExp] | undefined {
  const haystack = `${commit.subject} ${commit.files.join(" ")}`.toLowerCase();
  return FEATURE_RULES.find((rule) => rule[2].test(haystack));
}

function subsystem(file: string): string {
  for (const prefix of ["src/services", "src/harness", "src/server", "web/src", "docs"]) {
    if (file === prefix || file.startsWith(`${prefix}/`)) return prefix;
  }
  const parts = file.split("/");
  return parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0] || "repository";
}

export function summarizeUpstreamFeatures(
  commits: UpstreamCommit[],
  oursChanged: ReadonlySet<string>,
  alreadyPorted: ReadonlySet<string>,
): DigestFeature[] {
  const grouped = new Map<string, { description: string; commits: UpstreamCommit[] }>();
  for (const commit of commits) {
    const rule = featureRule(commit);
    const name = rule?.[0] ?? "Other upstream changes";
    const description = rule?.[1] ?? "Changes outside the recurring architectural feature areas; inspect individually before selection.";
    const group = grouped.get(name) ?? { description, commits: [] };
    group.commits.push(commit);
    grouped.set(name, group);
  }
  return [...grouped.entries()].map(([name, group]) => {
    const files = [...new Set(group.commits.flatMap((commit) => commit.files))].sort();
    const allPorted = group.commits.every((commit) => alreadyPorted.has(commit.sha));
    const overlaps = files.some((file) => oursChanged.has(file));
    const strongerSignal = /polling|legacy controller|fabricated route|unsafe|bypass/i.test(group.commits.map((commit) => commit.subject).join(" "));
    return {
      name,
      description: group.description,
      commits: group.commits.map((commit) => commit.sha),
      files,
      subsystems: [...new Set(files.map(subsystem))].sort(),
      verdict: allPorted ? "already-ported" : strongerSignal && overlaps ? "ours-stronger" : overlaps ? "conflicts-with-ours" : "STEAL-candidate",
    };
  });
}

function parseCommitLog(raw: string): UpstreamCommit[] {
  return raw.split("\u001e").filter(Boolean).map((block) => {
    const [header = "", ...fileLines] = block.trim().split("\n");
    const tab = header.indexOf("\t");
    return {
      sha: tab < 0 ? header : header.slice(0, tab),
      subject: tab < 0 ? "" : header.slice(tab + 1),
      files: fileLines.map((line) => line.trim()).filter(Boolean),
    };
  }).filter((commit) => /^[0-9a-f]{40}$/.test(commit.sha));
}

function renderDigest(oursRef: string, theirsRef: string, features: DigestFeature[]): string {
  const lines = [
    `# Upstream feature digest · ${dateStamp()}`,
    "",
    `Refs → ours=\`${oursRef}\` · theirs=\`${theirsRef}\``,
    "Choice boundary → reconnaissance only; no feature auto-ported.",
  ];
  for (const feature of features) {
    lines.push(
      "",
      `## ${feature.name}`,
      `- does → ${feature.description}`,
      `- files/subsystems → ${feature.files.length} files · ${feature.subsystems.map((value) => `\`${value}\``).join(" · ") || "none"}`,
      `- his commits → ${feature.commits.map((sha) => `\`${sha.slice(0, 9)}\``).join(" ") || "none"}`,
      `- verdict hint → **${feature.verdict}**`,
    );
  }
  lines.push("", "Reply with feature names to port.", "");
  return lines.join("\n");
}

function dateStamp(date = new Date()): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

export async function runUpstreamDivergence(repo: string, requestedRef?: string): Promise<string> {
  let remoteUrl = "";
  try {
    remoteUrl = (await run(repo, ["git", "remote", "get-url", UPSTREAM_REMOTE])).trim();
  } catch {
    await run(repo, ["git", "remote", "add", UPSTREAM_REMOTE, UPSTREAM_URL]);
    remoteUrl = UPSTREAM_URL;
  }
  if (!/github\.com[:/]pascaldisse\/gaia-daemon(?:\.git)?$/.test(remoteUrl)) {
    throw new Error(`remote '${UPSTREAM_REMOTE}' is not pascaldisse/gaia-daemon; refusing to replace it`);
  }
  await run(repo, ["git", "fetch", UPSTREAM_REMOTE]);

  const oursRef = "main";
  const theirsRef = requestedRef?.trim() || DEFAULT_UPSTREAM_REF;
  await run(repo, ["git", "rev-parse", "--verify", `${oursRef}^{commit}`]);
  await run(repo, ["git", "rev-parse", "--verify", `${theirsRef}^{commit}`]);
  await run(repo, ["bun", MAPPER, repo, oursRef, theirsRef]);

  const mergeBase = (await run(repo, ["git", "merge-base", oursRef, theirsRef])).trim();
  const [rawCommits, oursFilesRaw, oursSubjectsRaw, cherryRaw] = await Promise.all([
    run(repo, ["git", "log", "--format=%x1e%H%x09%s", "--name-only", `${oursRef}..${theirsRef}`]),
    run(repo, ["git", "diff", "--name-only", mergeBase, oursRef]),
    run(repo, ["git", "log", "--format=%H%x09%s", `${mergeBase}..${oursRef}`]),
    run(repo, ["git", "cherry", oursRef, theirsRef]),
  ]);
  const commits = parseCommitLog(rawCommits);
  const oursChanged = new Set(oursFilesRaw.split("\n").filter(Boolean));
  const oursSubjects = new Set(oursSubjectsRaw.split("\n").filter(Boolean).map((line) => normalizedSubject(line.slice(line.indexOf("\t") + 1))));
  const alreadyPorted = new Set(cherryRaw.split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim()));
  for (const commit of commits) {
    if (oursSubjects.has(normalizedSubject(commit.subject))) alreadyPorted.add(commit.sha);
  }

  const digest = renderDigest(oursRef, theirsRef, summarizeUpstreamFeatures(commits, oursChanged, alreadyPorted));
  const reportDir = join(repo, ".gaia", "reports");
  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, `upstream-digest-${dateStamp()}.md`), `${digest}\n`, "utf8");
  return digest;
}
