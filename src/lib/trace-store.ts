import { execFileSync } from "child_process";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join, relative } from "path";
import { z } from "zod";
import type {
  TraceRecord,
  ContributorType,
  Range,
  Conversation,
  RangePosition,
  FileEdit,
} from "./types.js";
import { TraceRecordSchema } from "./schemas.js";
import {
  appendTraceToNotes,
  readTracesFromNotes,
  getCommitsWithTraces,
  ensureNotesRef,
} from "./git-notes.js";

const STAGING_PATH = ".agent-trace/staging.jsonl";

export function getWorkspaceRoot(): string {
  if (process.env.CURSOR_PROJECT_DIR) {
    return process.env.CURSOR_PROJECT_DIR;
  }
  if (process.env.CLAUDE_PROJECT_DIR) {
    return process.env.CLAUDE_PROJECT_DIR;
  }
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
    }).trim();
  } catch {
    return process.cwd();
  }
}

export function getToolInfo(): { name: string; version?: string } {
  if (process.env.CURSOR_VERSION) {
    return { name: "cursor", version: process.env.CURSOR_VERSION };
  }
  if (process.env.CLAUDE_PROJECT_DIR) {
    return { name: "claude-code" };
  }
  return { name: "unknown" };
}

export function getVcsInfo(cwd: string): { type: "git" | "jj" | "hg" | "svn"; revision: string } | undefined {
  try {
    const revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf-8",
    }).trim();
    return { type: "git", revision };
  } catch {
    return undefined;
  }
}

export function toRelativePath(absolutePath: string, root: string): string {
  return absolutePath.startsWith(root)
    ? relative(root, absolutePath)
    : absolutePath;
}

export function normalizeModelId(model?: string): string | undefined {
  if (!model) return undefined;
  if (model.includes("/")) return model;
  const prefixes: Record<string, string> = {
    "claude-": "anthropic",
    "gpt-": "openai",
    "o1": "openai",
    "o3": "openai",
    "gemini-": "google",
  };
  for (const [prefix, provider] of Object.entries(prefixes)) {
    if (model.startsWith(prefix)) return `${provider}/${model}`;
  }
  return model;
}

export function computeRangePositions(
  edits: FileEdit[],
  fileContent?: string
): RangePosition[] {
  return edits
    .filter((e) => e.new_string)
    .map((edit) => {
      if (edit.range) {
        return {
          start_line: edit.range.start_line_number,
          end_line: edit.range.end_line_number,
        };
      }
      const lineCount = edit.new_string.split("\n").length;
      if (fileContent) {
        const idx = fileContent.indexOf(edit.new_string);
        if (idx !== -1) {
          const startLine = fileContent.substring(0, idx).split("\n").length;
          return { start_line: startLine, end_line: startLine + lineCount - 1 };
        }
      }
      return { start_line: 1, end_line: lineCount };
    });
}

export function createTrace(
  type: ContributorType,
  filePath: string,
  opts: {
    model?: string;
    rangePositions?: RangePosition[];
    transcript?: string | null;
    metadata?: Record<string, unknown>;
  } = {}
): TraceRecord {
  const root = getWorkspaceRoot();
  const modelId = normalizeModelId(opts.model);
  const conversationUrl = opts.transcript
    ? `file://${opts.transcript}`
    : undefined;

  const ranges: Range[] = opts.rangePositions?.length
    ? opts.rangePositions.map((pos) => ({ ...pos }))
    : [{ start_line: 1, end_line: 1 }];

  const conversation: Conversation = {
    url: conversationUrl,
    contributor: { type, model_id: modelId },
    ranges,
  };

  return {
    version: "1.0.0",
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    vcs: getVcsInfo(root),
    tool: getToolInfo(),
    files: [
      {
        path: toRelativePath(filePath, root),
        conversations: [conversation],
      },
    ],
    metadata: opts.metadata,
  };
}

export function appendTrace(trace: TraceRecord): void {
  const root = getWorkspaceRoot();
  ensureNotesRef(root);
  
  let commitSha: string;
  
  try {
    commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf-8",
    }).trim();
    
    // Append trace to git notes for current commit
    appendTraceToNotes(commitSha, trace, root);
  } catch {
    // Not in a git repo or no commits yet - store in staging area
    // This will be attached to the commit when it's created
    const stagingPath = join(root, STAGING_PATH);
    const dir = join(root, ".agent-trace");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(stagingPath, JSON.stringify(trace) + "\n", "utf-8");
  }
}

export function readTraces(root?: string, commitSha?: string): TraceRecord[] {
  const workspaceRoot = root || getWorkspaceRoot();
  
  // If specific commit requested, read from notes
  if (commitSha) {
    return readTracesFromNotes(commitSha, workspaceRoot);
  }

  // Otherwise, read all traces from all commits with notes
  const commits = getCommitsWithTraces(workspaceRoot);
  const allTraces: TraceRecord[] = [];
  
  for (const commit of commits) {
    const traces = readTracesFromNotes(commit, workspaceRoot);
    allTraces.push(...traces);
  }

  // Also check staging area for traces not yet committed
  const stagingPath = join(workspaceRoot, STAGING_PATH);
  if (existsSync(stagingPath)) {
    const content = readFileSync(stagingPath, "utf-8");
    const lines = content.trim().split("\n").filter((line) => line.trim());
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const trace = TraceRecordSchema.parse(parsed);
        allTraces.push(trace);
      } catch (error) {
        console.warn(`Failed to parse staging trace: ${error}`);
      }
    }
  }

  return allTraces;
}

export function validateTrace(trace: unknown): {
  valid: boolean;
  errors?: z.ZodError;
} {
  try {
    TraceRecordSchema.parse(trace);
    return { valid: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { valid: false, errors: error };
    }
    return { valid: false };
  }
}

export function tryReadFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return undefined;
  }
}
