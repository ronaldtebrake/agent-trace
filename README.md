# Agent Trace CLI

A CLI tool for capturing and analyzing Agent Trace data to help open source maintainers identify AI-generated code contributions.

**Features:**
- 🔗 **Git Notes Storage** - Traces stored in git notes (no merge conflicts, works with stacked diffs)
- 🤖 **Automatic Capture** - Hooks for Cursor and Claude Code
- 📊 **Dashboard API** - REST API for building visualization dashboards
- 🔍 **Commit Analysis** - Analyze any commit for AI vs human attribution
- 📈 **Reports** - Generate contribution statistics

## Installation

```bash
npm install -g agent-trace-cli
```

Or install locally in your project:

```bash
npm install --save-dev agent-trace-cli
```

Hooks are automatically installed when the package is installed via the `prepare` script.

## Quick Start

1. **Populate test data** (for testing):
   ```bash
   agent-trace populate-test
   ```

2. **Start dashboard**:
   ```bash
   agent-trace dashboard
   ```
   Then open http://localhost:3000 in your browser

3. **Analyze a commit**:
   ```bash
   agent-trace analyze HEAD
   ```

## Usage

### Setup (if auto-install didn't work)

```bash
agent-trace setup
```

This configures `.cursor/hooks.json` or `.claude/settings.json` to automatically capture traces when AI tools modify files.

### Validate Configuration

Check if your repository is properly configured:

```bash
agent-trace validate
```

Use `--strict` to exit with error if not configured:

```bash
agent-trace validate --strict
```

### Analyze Commit

Analyze a commit for agent traces:

```bash
# Analyze current commit (HEAD)
agent-trace analyze HEAD

# Analyze specific commit SHA
agent-trace analyze abc123def

# Analyze branch tip
agent-trace analyze main

# JSON output
agent-trace analyze HEAD --format json
```

### Generate Report

Generate a contribution report:

```bash
# Full report
agent-trace report

# Report since date
agent-trace report --since 2026-01-01

# JSON output
agent-trace report --format json
```

### Dashboard

Start a dashboard API server:

```bash
# Start on default port (3000)
agent-trace dashboard

# Start on custom port
agent-trace dashboard --port 8080
```

The dashboard provides:
- **Web UI** at `http://localhost:3000` - Visual dashboard similar to the reference images
- **REST API** endpoints for custom frontends:
  - `GET /api/stats?from=<commit>&to=<commit>` - Get statistics
  - `GET /api/commits/<sha>/traces` - Get traces for a commit
  - `GET /api/files/<path>/attribution?from=<commit>&to=<commit>` - Get file attribution
  - `GET /api/health` - Health check

### Populate Test Data

Create sample traces and commits for testing:

```bash
agent-trace populate-test
```

This creates:
- Sample code files
- Multiple commits with traces
- Git notes with trace data

## How It Works

### Storage: Git Notes

Agent Trace uses **git notes** to store traces, which provides several advantages:

- ✅ **No merge conflicts** - Each commit has its own notes
- ✅ **Works with stacked diffs** - Traces stay with their commits across branches
- ✅ **Git worktrees compatible** - Notes are shared via `.git` directory
- ✅ **Rebase-safe** - Notes move with commits during rebase
- ✅ **CI-friendly** - Easy to check traces: `git notes show <commit>`

Traces are stored in the `refs/notes/agent-trace` namespace. Each commit can have multiple trace records stored as a JSON array.

### Automatic Trace Capture

When you install `agent-trace-cli`, it automatically sets up hooks in:

- `.cursor/hooks.json` (for Cursor IDE)
- `.claude/settings.json` (for Claude Code)
- `.git/hooks/post-commit` (to attach staging traces)

These hooks capture events when AI tools modify files:
- `postToolUse` / `PostToolUse` - After tool execution
- `afterFileEdit` - After file edits
- `afterShellExecution` - After shell commands
- `sessionStart` / `SessionStart` - Session start
- `sessionEnd` / `SessionEnd` - Session end

Traces are automatically attached to the current commit's git notes. If no commit exists yet, traces are stored in `.agent-trace/staging.jsonl` and attached on the next commit.

### Trace Format

Each trace record follows the [Agent Trace specification](https://github.com/cursor/agent-trace) and includes:

- File path and line ranges
- Contributor type (AI, human, mixed, unknown)
- Model identifier (e.g., `anthropic/claude-opus-4-5-20251101`)
- Conversation URL (if available)
- VCS information (commit SHA)
- Tool information (Cursor, Claude Code, etc.)

## Example Output

### Analyze Command

```
📊 Agent Trace Analysis

Target: HEAD
Commit: abc123def456...

Files analyzed:

  src/utils/parser.ts
    AI: 25 | Human: 0 | Total: 25
    Models: anthropic/claude-opus-4-5-20251101

  src/api/handlers.ts
    AI: 10 | Human: 5 | Total: 15
    Models: openai/gpt-4o

Summary:
  Total AI contributions: 35
  Total human contributions: 5
  Files analyzed: 2
```

### Report Command

```
📈 Agent Trace Contribution Report

Summary:
  Total traces: 42
  Files modified: 15
  AI contributions: 1250
  Human contributions: 320
  Mixed contributions: 15

Models used:
  anthropic/claude-opus-4-5-20251101: 800 ranges
  openai/gpt-4o: 450 ranges

Tools used:
  cursor: 35 traces
  claude-code: 7 traces
```

## Sharing Git Notes

Git notes are **not automatically pushed** with regular git operations. To share traces with your team:

```bash
# Push notes to remote
git push origin refs/notes/agent-trace

# Fetch notes from remote
git fetch origin refs/notes/agent-trace:refs/notes/agent-trace
```

After the initial push/fetch, you may want to configure automatic syncing:

```bash
# Add to .git/config
[remote "origin"]
    fetch = +refs/notes/*:refs/notes/*
```

This ensures notes are synced on `git fetch` and `git pull`.

## Configuration

Traces are stored in git notes (`refs/notes/agent-trace`). The staging file `.agent-trace/staging.jsonl` is temporary and can be gitignored:

```
.agent-trace/staging.jsonl
```

## VCS Support

The tool works with any Git-based version control system (GitHub, GitLab, Bitbucket, etc.). It analyzes commits using local git information, so you need to have the repository checked out locally.

To analyze a commit from a PR:
1. Check out the PR branch locally
2. Run `agent-trace analyze HEAD` or `agent-trace analyze <commit-sha>`

## Troubleshooting

### Hooks not working

1. Verify hooks are installed: `agent-trace validate`
2. Check `.cursor/hooks.json` or `.claude/settings.json` exists
3. Ensure the hook script path is correct
4. Restart Cursor/Claude Code after installing hooks

### No traces found

1. Make sure hooks are configured: `agent-trace validate`
2. Check git notes: `git notes --ref refs/notes/agent-trace list`
3. Verify you're in a git repository with at least one commit
4. Try making a file edit with an AI tool to trigger trace capture
5. Check staging file: `.agent-trace/staging.jsonl` (traces created before commits)

### Commit analysis fails

1. Ensure you're in a git repository
2. Verify the commit SHA or branch name exists
3. Make sure you have the commit checked out or accessible in your local repository

## Contributing

Contributions welcome! Please see the [Agent Trace specification](https://github.com/cursor/agent-trace) for details on the trace format.

## License

MIT
