import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

const IDENTITY_PREFIX = "You are Claude Code";

type TextBlock = { type?: string; text?: string; [key: string]: unknown };
type AnthropicPayload = {
  system?: string | TextBlock[];
  messages?: Array<{ role: string; content: unknown }>;
  [key: string]: unknown;
};

export function relocateClaudeSystemPrompt(payload: unknown): AnthropicPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const body = payload as AnthropicPayload;
  const blocks = typeof body.system === "string"
    ? [{ type: "text", text: body.system }]
    : Array.isArray(body.system) ? body.system : undefined;
  if (!blocks) return undefined;

  const identity = blocks.filter((block) => block?.text?.startsWith(IDENTITY_PREFIX));
  const preamble = blocks
    .filter((block) => !block?.text?.startsWith(IDENTITY_PREFIX))
    .map((block) => block.text ?? "")
    .filter(Boolean)
    .join("\n\n");
  if (identity.length === 0 || !preamble) return undefined;

  return {
    ...body,
    system: identity,
    messages: [
      { role: "user", content: [{ type: "text", text: preamble }] },
      ...(Array.isArray(body.messages) ? body.messages : []),
    ],
  };
}

export const claudeCodeIdentityExtension: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.on("before_provider_request", (event) => relocateClaudeSystemPrompt(event.payload));
};
