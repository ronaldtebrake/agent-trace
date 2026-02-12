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
    throw new Error(`Failed to write git note: ${proc.stderr?.toString() || "unknown error"}`);
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
    const output = execFileSync(
      "git",
      ["notes", "--ref", NOTES_REF, "list"],
      { encoding: "utf-8" }
    );

    return output
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        // Format: <commit-sha> <notes-object-sha>
        const parts = line.split(/\s+/);
        return parts[0];
      })
      .filter((sha) => sha.length === 40); // Valid SHA
  } catch {
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
  return commits.map((commit) => {
    const traces = readTracesFromNotes(commit);
    return {
      commit,
      traceCount: traces.length,
      timestamp: traces[0]?.timestamp,
    };
  });
}

/**
 * Ensure notes ref exists and is configured
 */
export function ensureNotesRef(): void {
  try {
    // Check if ref exists
    execFileSync("git", ["show-ref", "--verify", "--quiet", NOTES_REF], {
      stdio: "ignore",
    });
  } catch {
    // Create empty notes ref by adding and removing a note
    try {
      execFileSync("git", ["rev-parse", "HEAD"], { stdio: "ignore" });
      // HEAD exists, create ref properly
      execFileSync(
        "git",
        ["notes", "--ref", NOTES_REF, "add", "-m", "", "HEAD"],
        { stdio: "ignore" }
      );
      execFileSync(
        "git",
        ["notes", "--ref", NOTES_REF, "remove", "HEAD"],
        { stdio: "ignore" }
      );
    } catch {
      // HEAD doesn't exist yet, create empty ref
      const emptyBlob = execFileSync(
        "git",
        ["hash-object", "-t", "blob", "-w", "--stdin"],
        { input: "", encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }
      ).trim();
      execFileSync("git", ["update-ref", NOTES_REF, emptyBlob], {
        stdio: "ignore",
      });
    }
  }
}
