import { join } from "path";

export function getTracePath(root: string): string {
  return join(root, ".agent-trace", "traces.jsonl");
}

export function getCursorHooksPath(root: string): string {
  return join(root, ".cursor", "hooks.json");
}

export function getClaudeSettingsPath(root: string): string {
  return join(root, ".claude", "settings.json");
}
