import { json, parseBody } from "../../core/http.js";
import type { UiEvent } from "../../core/types.js";
import { loadCommandPlugins, loadedCommandPlugins, type PluginHttpRoute } from "../../services/plugins.js";
import type { RouteContext } from "../route.js";

export interface RegisteredPluginHttpRoute {
  pluginId: string;
  route: PluginHttpRoute;
}

/** Boot-scoped route registry → same bundled/user plugin inventory as room hooks. */
export async function loadPluginHttpRoutes(): Promise<readonly RegisteredPluginHttpRoute[]> {
  const plugins = loadedCommandPlugins(await loadCommandPlugins());
  const routes: RegisteredPluginHttpRoute[] = [];
  const owners = new Map<string, string>();
  for (const plugin of plugins) {
    const pluginId = plugin.id ?? (typeof plugin.command === "string" ? plugin.command : plugin.command?.[0]) ?? "plugin";
    for (const route of plugin.httpRoutes ?? []) {
      const key = `${route.method.toUpperCase()} ${route.path}`;
      const owner = owners.get(key);
      if (owner) {
        console.warn(`[plugins] skipped HTTP route ${key} from ${pluginId}: owned by ${owner}`);
        continue;
      }
      owners.set(key, pluginId);
      routes.push(Object.freeze({ pluginId, route }));
    }
  }
  return Object.freeze(routes);
}

/** Generic exact-path HTTP contribution seam; plugin owns behavior, host owns wire + SSE. */
export async function handlePluginHttpRoute(ctx: RouteContext): Promise<boolean> {
  const method = (ctx.request.method ?? "GET").toUpperCase();
  const registered = (await ctx.pluginHttpRoutes).find(({ route }) => route.method.toUpperCase() === method && route.path === ctx.url.pathname);
  if (!registered) return false;
  try {
    const result = await registered.route.handle({
      url: ctx.url,
      body: () => parseBody(ctx.request),
      rooms: {
        listWorkspaces: () => ctx.daemon.registry.list(),
        sendMessage: async (workspaceId, roomId, text, options) => {
          const service = await ctx.daemon.serviceFor(workspaceId, roomId);
          return service.sendMessage(text, options);
        },
      },
    });
    for (const event of result.events ?? []) ctx.broadcast(event as UiEvent);
    json(ctx.response, result.status ?? 200, result.body ?? { ok: true });
  } catch (error) {
    json(ctx.response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
  return true;
}
