import { existsSync } from "node:fs";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { workspacePaths } from "../core/paths.js";
import {
  BUILTIN_APPLICATION_MANIFESTS,
  parseApplicationManifest,
  validateApplicationRelativePath,
  type ApplicationCatalog,
  type ApplicationCatalogDiagnostic,
  type ApplicationCatalogEntry,
  type ApplicationManifestV1,
} from "../domain/applications.js";

export class ApplicationWorkspaceNotFoundError extends Error {}

export interface ApplicationServiceOptions {
  workspaceFor(workspaceId: string): Promise<{ path: string; isInitialized?: boolean } | undefined>;
}

function pathInside(child: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(`..${sep}`));
}

async function containedRealPath(path: string, root: string, label: string): Promise<string> {
  const resolved = await realpath(path).catch(() => {
    throw new Error(`${label} does not exist`);
  });
  if (!pathInside(resolved, root)) throw new Error(`${label} escapes its workspace package through a symlink`);
  return resolved;
}

async function validateWorkspaceFiles(manifest: ApplicationManifestV1, packageRoot: string, workspaceRoot: string): Promise<void> {
  const panelEntry = await containedRealPath(join(packageRoot, manifest.panel.entry), packageRoot, "manifest.panel.entry");
  if (!(await lstat(panelEntry)).isFile()) throw new Error("manifest.panel.entry must name a file");

  if (manifest.icon.kind === "asset") {
    const icon = await containedRealPath(join(packageRoot, manifest.icon.value), packageRoot, "manifest.icon.value");
    if (!(await lstat(icon)).isFile()) throw new Error("manifest.icon.value must name a file");
  }

  if (manifest.source) {
    const sourceRoot = await containedRealPath(join(packageRoot, manifest.source.root), workspaceRoot, "manifest.source.root");
    const sourceEntry = await containedRealPath(join(sourceRoot, manifest.source.entry), sourceRoot, "manifest.source.entry");
    if (!(await lstat(sourceEntry)).isFile()) throw new Error("manifest.source.entry must name a file");
  }
}

export class ApplicationService {
  constructor(private readonly options: ApplicationServiceOptions) {}

  async catalog(workspaceId: string): Promise<ApplicationCatalog> {
    const workspace = await this.options.workspaceFor(workspaceId);
    if (!workspace?.isInitialized) throw new ApplicationWorkspaceNotFoundError(`Unknown workspace: ${workspaceId}`);
    const workspaceRoot = await realpath(workspace.path);
    const applications: ApplicationCatalogEntry[] = BUILTIN_APPLICATION_MANIFESTS.map((manifest) => ({
      manifest,
      source: "builtin",
      launchable: true,
    }));
    const diagnostics: ApplicationCatalogDiagnostic[] = [];
    const builtinIds = new Set(BUILTIN_APPLICATION_MANIFESTS.map((manifest) => manifest.id));
    const appsRoot = workspacePaths.applicationsDir(workspace.path);
    if (!existsSync(appsRoot)) return { schema: 1, applications, diagnostics };

    const entries = await readdir(appsRoot, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const relativeRoot = `apps/${entry.name}`;
      const manifestPath = `${relativeRoot}/app.gaia.json`;
      try {
        validateApplicationRelativePath(entry.name, "application package id");
        const packageRoot = await containedRealPath(join(appsRoot, entry.name), workspaceRoot, "application package");
        if (!(await lstat(packageRoot)).isDirectory()) throw new Error("application package must be a directory");
        const manifestFile = await containedRealPath(join(packageRoot, "app.gaia.json"), packageRoot, "app.gaia.json");
        let manifest: ApplicationManifestV1;
        try {
          manifest = parseApplicationManifest(JSON.parse(await readFile(manifestFile, "utf8")) as unknown, { origin: "workspace" });
        } catch (error) {
          diagnostics.push({ relativeRoot, manifestPath, code: "invalid-manifest", message: error instanceof Error ? error.message : String(error) });
          continue;
        }
        if (manifest.id !== entry.name) throw new Error(`manifest.id '${manifest.id}' must match package directory '${entry.name}'`);
        if (builtinIds.has(manifest.id)) {
          diagnostics.push({ relativeRoot, manifestPath, code: "builtin-shadowed", message: `Built-in application '${manifest.id}' cannot be shadowed` });
          continue;
        }
        await validateWorkspaceFiles(manifest, packageRoot, workspaceRoot);
        applications.push({ manifest, source: "workspace", launchable: true, relativeRoot, manifestPath });
      } catch (error) {
        diagnostics.push({ relativeRoot, manifestPath, code: "invalid-package", message: error instanceof Error ? error.message : String(error) });
      }
    }

    return { schema: 1, applications, diagnostics };
  }
}
