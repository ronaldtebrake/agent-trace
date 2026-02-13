import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { installGitHook } from "../lib/git-hooks.js";
import { ensureNotesRef } from "../lib/git-notes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface CursorHook {
  command: string;
  matcher?: string;
}

interface CursorHooksConfig {
  version: number;
  hooks: Record<string, CursorHook[]>;
}

interface ClaudeHook {
  type: "command";
  command: string;
  matcher?: string;
}

interface ClaudeHooksConfig {
  hooks: Record<string, Array<{ matcher?: string; hooks: ClaudeHook[] }>>;
}

function getWorkspaceRoot(): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
    }).trim();
  } catch {
    return process.cwd();
  }
}

function getHookScriptPath(): string {
  // When installed as package, hook script is in dist/hooks/trace-hook.js
  // When running from source, it's in src/hooks/trace-hook.ts
  const distPath = resolve(__dirname, "../hooks/trace-hook.js");
  const srcPath = resolve(__dirname, "../hooks/trace-hook.ts");
  
  if (existsSync(distPath)) {
    return distPath;
  }
  if (existsSync(srcPath)) {
    return srcPath;
  }
  // Fallback: assume it's installed and use node to run it
  return "node node_modules/agent-trace-cli/dist/hooks/trace-hook.js";
}

function installCursorHooks(root: string): boolean {
  const hooksPath = join(root, ".cursor", "hooks.json");
  const hookScript = getHookScriptPath();

  let config: CursorHooksConfig = { version: 1, hooks: {} };

  if (existsSync(hooksPath)) {
    try {
      const existing = JSON.parse(readFileSync(hooksPath, "utf-8"));
      config = { ...config, ...existing };
    } catch (error) {
      console.warn(`Failed to read existing .cursor/hooks.json: ${error}`);
    }
  }

  // Add our hooks
  const hooksToAdd: Record<string, CursorHook[]> = {
    postToolUse: [
      {
        command: hookScript,
      },
    ],
    afterFileEdit: [
      {
        command: hookScript,
      },
    ],
    afterShellExecution: [
      {
        command: hookScript,
      },
    ],
    sessionStart: [
      {
        command: hookScript,
      },
    ],
    sessionEnd: [
      {
        command: hookScript,
      },
    ],
  };

  // Merge hooks (prepend ours to run first)
  for (const [event, hooks] of Object.entries(hooksToAdd)) {
    if (!config.hooks[event]) {
      config.hooks[event] = [];
    }
    // Avoid duplicates
    const existingCommands = new Set(
      config.hooks[event].map((h) => h.command)
    );
    for (const hook of hooks) {
      if (!existingCommands.has(hook.command)) {
        config.hooks[event].unshift(hook);
      }
    }
  }

  try {
    mkdirSync(join(root, ".cursor"), { recursive: true });
    writeFileSync(hooksPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    console.log(`✓ Installed Cursor hooks to ${hooksPath}`);
    return true;
  } catch (error) {
    console.error(`Failed to install Cursor hooks: ${error}`);
    return false;
  }
}

function installClaudeHooks(root: string): boolean {
  const settingsPath = join(root, ".claude", "settings.json");
  const hookScript = getHookScriptPath();

  let config: ClaudeHooksConfig = { hooks: {} };

  if (existsSync(settingsPath)) {
    try {
      const existing = JSON.parse(readFileSync(settingsPath, "utf-8"));
      config = { ...config, ...existing };
    } catch (error) {
      console.warn(`Failed to read existing .claude/settings.json: ${error}`);
    }
  }

  // Claude Code uses different hook names
  const hooksToAdd: Record<string, Array<{ matcher?: string; hooks: ClaudeHook[] }>> = {
    PostToolUse: [
      {
        hooks: [
          {
            type: "command",
            command: hookScript,
          },
        ],
      },
    ],
    SessionStart: [
      {
        hooks: [
          {
            type: "command",
            command: hookScript,
          },
        ],
      },
    ],
    SessionEnd: [
      {
        hooks: [
          {
            type: "command",
            command: hookScript,
          },
        ],
      },
    ],
  };

  // Merge hooks
  for (const [event, hookConfigs] of Object.entries(hooksToAdd)) {
    if (!config.hooks[event]) {
      config.hooks[event] = [];
    }
    // Avoid duplicates
    const existingCommands = new Set(
      config.hooks[event].flatMap((hc) => hc.hooks.map((h) => h.command))
    );
    for (const hookConfig of hookConfigs) {
      const hasDuplicate = hookConfig.hooks.some((h) =>
        existingCommands.has(h.command)
      );
      if (!hasDuplicate) {
        config.hooks[event].unshift(hookConfig);
      }
    }
  }

  try {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify(config, null, 2) + "\n",
      "utf-8"
    );
    console.log(`✓ Installed Claude Code hooks to ${settingsPath}`);
    return true;
  } catch (error) {
    console.error(`Failed to install Claude Code hooks: ${error}`);
    return false;
  }
}

function main() {
  const root = getWorkspaceRoot();
  console.log(`Installing agent-trace hooks in ${root}...`);

  let installed = false;

  // Ensure git notes ref exists
  try {
    const root = getWorkspaceRoot();
    ensureNotesRef(root);
    console.log(`✓ Git notes ref configured: refs/notes/agent-trace`);
  } catch (error) {
    console.warn(`⚠ Failed to configure git notes: ${error}`);
  }

  // Install git hook for staging traces
  try {
    installGitHook();
    console.log(`✓ Git post-commit hook installed`);
    installed = true;
  } catch (error) {
    console.warn(`⚠ Failed to install git hook: ${error}`);
  }

  // Try Cursor first
  if (existsSync(join(root, ".cursor"))) {
    installed = installCursorHooks(root) || installed;
  } else {
    // Install anyway - user might create .cursor later
    installed = installCursorHooks(root) || installed;
  }

  // Try Claude Code
  if (existsSync(join(root, ".claude"))) {
    installed = installClaudeHooks(root) || installed;
  } else {
    // Install anyway - user might use Claude Code later
    installed = installClaudeHooks(root) || installed;
  }

  if (!installed) {
    console.warn(
      "⚠ No hooks were installed. Make sure you're in a git repository."
    );
    process.exit(1);
  }

  console.log(
    "\n✓ Agent Trace hooks installed successfully!\n" +
      "  Traces will be automatically captured when using Cursor or Claude Code.\n" +
      "  Traces are stored in git notes (refs/notes/agent-trace).\n" +
      "  To share notes: git push origin refs/notes/agent-trace"
  );
}

main();
