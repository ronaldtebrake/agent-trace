import { execFileSync, spawnSync } from "child_process";
import { z } from "zod";
import { TraceRecordSchema, type TraceRecord } from "./schemas.js";

const NOTES_REF = "refs/notes/agent-trace";

/**
 * Read trace records from git notes for a specific commit
 */
export function readTracesFromNotes(commitSha: string): TraceRecord[] {
  try {
    const noteContent = execFileSync(
      "git",
      ["notes", "--ref", NOTES_REF, "show", commitSha],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
    ).trim();

    if (!noteContent) {
      return [];
    }

    // Notes can contain either a single JSON object or an array
    const parsed = JSON.parse(noteContent);
    const records = Array.isArray(parsed) ? parsed : [parsed];

    return records
      .map((record) => {
        try {
          return TraceRecordSchema.parse(record);
        } catch (error) {
          console.warn(`Failed to parse trace record: ${error}`);
          return null;
        }
      })
      .filter((trace): trace is TraceRecord => trace !== null);
  } catch (error: any) {
    // Note doesn't exist or git command failed
    // Git returns status 128 when note doesn't exist
    if (error.status === 1 || error.status === 128 || error.code === 1 || error.code === 128) {
      return [];
    }
    throw error;
  }
}

/**
 * Write trace records to git notes for a specific commit
 */
export function writeTracesToNotes(
  commitSha: string,
  traces: TraceRecord[]
): void {
  if (traces.length === 0) {
    return;
  }

  // Read existing traces (may return empty array if note doesn't exist)
  let existing: TraceRecord[] = [];
  try {
    existing = readTracesFromNotes(commitSha);
  } catch (error) {
    // If reading fails, start with empty array
    existing = [];
  }
  
  // Merge with new traces (avoid duplicates by ID)
  const existingIds = new Set(existing.map((t) => t.id));
  const newTraces = traces.filter((t) => !existingIds.has(t.id));
  const allTraces = [...existing, ...newTraces];

  // Store as JSON array
  const content = JSON.stringify(allTraces, null, 2);

  // Ensure notes ref is valid before writing
  try {
    ensureNotesRef();
  } catch {
    // If ensure fails, try to fix broken ref
    try {
      execFileSync("git", ["update-ref", "-d", NOTES_REF], {
        stdio: "ignore",
      });
      ensureNotesRef();
    } catch {
      // Continue anyway, git notes add will create the ref if needed
    }
  }

  // Use -F flag to read from stdin to avoid shell escaping issues
  const proc = spawnSync(
    "git",
    ["notes", "--ref", NOTES_REF, "add", "-f", "-F", "-", commitSha],
    {
      input: content,
      encoding: "utf-8",
    }
  );

  if (proc.status !== 0) {
    const errorMsg = proc.stderr?.toString() || proc.stdout?.toString() || "unknown error";
    
    // If it's a broken ref error, try to fix it
    if (errorMsg.includes("Failed to read notes tree")) {
      try {
        execFileSync("git", ["update-ref", "-d", NOTES_REF], {
          stdio: "ignore",
        });
        ensureNotesRef();
        
        // Retry once
        const retryProc = spawnSync(
          "git",
          ["notes", "--ref", NOTES_REF, "add", "-f", "-F", "-", commitSha],
          {
            input: content,
            encoding: "utf-8",
          }
        );
        
        if (retryProc.status === 0) {
          return; // Success on retry
        }
      } catch {
        // Fall through to throw error
      }
    }
    
    throw new Error(`Failed to write git note: ${errorMsg.trim()}`);
  }
}

/**
 * Append a trace record to git notes for a commit
 */
export function appendTraceToNotes(
  commitSha: string,
  trace: TraceRecord
): void {
  writeTracesToNotes(commitSha, [trace]);
}

/**
 * Read all trace records from git notes for a range of commits
 */
export function readTracesFromNotesRange(
  fromCommit: string,
  toCommit: string = "HEAD"
): TraceRecord[] {
  try {
    // Get all commits in range
    const commits = execFileSync(
      "git",
      ["rev-list", `${fromCommit}..${toCommit}`],
      { encoding: "utf-8" }
    )
      .trim()
      .split("\n")
      .filter((c) => c.trim());

    const allTraces: TraceRecord[] = [];
    for (const commit of commits) {
      const traces = readTracesFromNotes(commit);
      allTraces.push(...traces);
    }

    return allTraces;
  } catch (error) {
    console.warn(`Failed to read traces from range: ${error}`);
    return [];
  }
}

/**
 * Check if a commit has traces in notes
 */
export function hasTracesInNotes(commitSha: string): boolean {
  try {
    execFileSync(
      "git",
      ["notes", "--ref", NOTES_REF, "show", commitSha],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
    );
    return true;
  } catch (error: any) {
    // Note doesn't exist - git returns status 128
    if (error.status === 128 || error.code === 128) {
      return false;
    }
    // Other errors - assume no note
    return false;
  }
}

/**
 * Get all commits that have traces in notes
 */
export function getCommitsWithTraces(): string[] {
  try {
    // Ensure notes ref exists first
    ensureNotesRef();
    
    const output = execFileSync(
      "git",
      ["notes", "--ref", NOTES_REF, "list"],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );

    const commits = output
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        // Format: <commit-sha> <notes-object-sha>
        const parts = line.split(/\s+/);
        return parts[0];
      })
      .filter((sha) => sha && sha.length >= 7); // Allow short SHAs too
    
    return commits;
  } catch (error: any) {
    // If notes ref doesn't exist or is empty, return empty array
    if (error.status === 128 || error.code === 128) {
      return [];
    }
    // Log other errors for debugging
    console.warn(`Failed to list git notes: ${error.message || error}`);
    return [];
  }
}

/**
 * Get commits with traces and their metadata
 */
export function getCommitsWithTracesMetadata(): Array<{
  commit: string;
  traceCount: number;
  timestamp?: string;
}> {
  const commits = getCommitsWithTraces();
  const result: Array<{
    commit: string;
    traceCount: number;
    timestamp?: string;
  }> = [];
  
  for (const commit of commits) {
    try {
      const traces = readTracesFromNotes(commit);
      if (traces.length > 0) {
        result.push({
          commit,
          traceCount: traces.length,
          timestamp: traces[0]?.timestamp,
        });
      }
    } catch (error) {
      // Skip commits with invalid notes
      console.warn(`Failed to read traces for commit ${commit}: ${error}`);
    }
  }
  
  return result;
}

/**
 * Ensure notes ref exists and is configured
 */
export function ensureNotesRef(): void {
  try {
    // Check if ref exists and is valid
    execFileSync("git", ["show-ref", "--verify", "--quiet", NOTES_REF], {
      stdio: "ignore",
    });
    
    // Try to read from it to verify it's valid
    try {
      execFileSync("git", ["notes", "--ref", NOTES_REF, "list"], {
        stdio: "ignore",
      });
    } catch {
      // Ref exists but is broken, delete and recreate
      try {
        execFileSync("git", ["update-ref", "-d", NOTES_REF], {
          stdio: "ignore",
        });
      } catch {
        // Ignore if deletion fails
      }
      // Will fall through to creation below
    }
  } catch {
    // Ref doesn't exist, create it
  }
  
  // Create ref if it doesn't exist (or was broken)
  try {
    execFileSync("git", ["show-ref", "--verify", "--quiet", NOTES_REF], {
      stdio: "ignore",
    });
    // Ref exists and is valid
    return;
  } catch {
    // Ref doesn't exist, create it properly
    try {
      execFileSync("git", ["rev-parse", "HEAD"], { stdio: "ignore" });
      // HEAD exists, create ref by adding a dummy note then removing it
      execFileSync(
        "git",
        ["notes", "--ref", NOTES_REF, "add", "-m", "init", "HEAD"],
        { stdio: "ignore" }
      );
      execFileSync(
        "git",
        ["notes", "--ref", NOTES_REF, "remove", "HEAD"],
        { stdio: "ignore" }
      );
    } catch {
      // HEAD doesn't exist yet, create empty tree ref
      const emptyTree = execFileSync(
        "git",
        ["mktree"],
        { input: "", encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
      ).trim();
      if (emptyTree) {
        execFileSync("git", ["update-ref", NOTES_REF, emptyTree], {
          stdio: "ignore",
        });
      }
    }
  }
}
