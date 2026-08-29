/**
 * dsh-edit-guardian (host half)
 *
 * 1. Watches `tools/pre-execute` for bash/pwsh calls whose command matches a
 *    potentially destructive pattern (rm, Remove-Item, format, git push --force,
 *    curl|sh, ...). In normal permission modes the execution is routed through
 *    the DSH approval seam so the Web UI asks before anything runs. When the
 *    session's sandbox mode is `danger-full-access` ("Full access" preset), the
 *    user already chose to trust everything, so the gate lets it through.
 *
 * 2. Records successful `write` / `edit` results and exposes a `/undo` command
 *    that restores one file (or all recorded files) to their pre-edit content.
 *    `write`-created files (before === null) are removed again. Snapshots are
 *    persisted under $DSH_HOME/storages/dsh-edit-guardian so a web restart does
 *    not lose the ability to undo previously recorded changes.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";

const name = "dsh-edit-guardian";
const inject = ["commands"];

const DANGEROUS_PATTERNS = [
  { label: "rm", pattern: /\brm\b/, detail: "deletes files or directories" },
  { label: "rmdir", pattern: /\brmdir\b/, detail: "removes directories" },
  { label: "Remove-Item", pattern: /\bRemove-Item\b/i, detail: "PowerShell file/directory deletion" },
  { label: "del", pattern: /\bdel\b/, detail: "Windows file deletion" },
  { label: "rd", pattern: /\brd\b/, detail: "Windows directory removal" },
  { label: "format", pattern: /\bformat\b/, detail: "formats a volume" },
  { label: "mkfs", pattern: /\bmkfs\b/, detail: "creates a filesystem (destructive)" },
  { label: "diskpart", pattern: /\bdiskpart\b/, detail: "disk partitioning (destructive)" },
  { label: "dd", pattern: /\bdd\b[^\n|&;]*\bof=/, detail: "raw device writes (destructive)" },
  { label: "git clean", pattern: /\bgit\s+clean\b/, detail: "removes untracked files" },
  { label: "git reset --hard", pattern: /\bgit\s+reset\b[^\n|&;]*--hard/, detail: "discards commits and working-tree changes" },
  { label: "git push --force", pattern: /\bgit\s+push\b[^\n|&;]*--force/, detail: "force-overwrites remote history" },
  { label: "shutdown", pattern: /\b(?:shutdown|reboot|halt|poweroff)\b/, detail: "shuts down or restarts the machine" },
  { label: "Restart-Computer", pattern: /\bRestart-Computer\b/i, detail: "PowerShell machine restart" },
  { label: "Stop-Computer", pattern: /\bStop-Computer\b/i, detail: "PowerShell machine shutdown" },
  { label: "Clear-Content", pattern: /\bClear-Content\b/i, detail: "PowerShell content erasure" },
  { label: "curl|sh", pattern: /\bcurl\b[^\n|&;]*\|\s*(?:ba)?sh\b/, detail: "executes a remote script through the shell" },
  { label: "wget|sh", pattern: /\bwget\b[^\n|&;]*\|\s*(?:ba)?sh\b/, detail: "executes a remote script through the shell" }
];

function detectDangerous(command) {
  for (const entry of DANGEROUS_PATTERNS) {
    if (entry.pattern.test(command)) return entry;
  }
  return undefined;
}

/** Session-scoped {pathKey -> {path, before}} records for undo. */
const changesBySession = new Map();

function pathKey(path) {
  return process.platform === "win32" ? String(path).toLowerCase() : String(path);
}

function loadFilesSync(sessionId) {
  const existing = changesBySession.get(sessionId);
  if (existing !== undefined) return existing;

  const map = new Map();
  try {
    const file = undoFile(sessionId);
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, "utf8"));
      if (Array.isArray(data.files)) {
        for (const entry of data.files) {
          if (entry && typeof entry.path === "string") {
            map.set(pathKey(entry.path), { path: entry.path, before: entry.before ?? null });
          }
        }
      }
    }
  } catch {
    // unreadable snapshot — start with an empty map
  }
  changesBySession.set(sessionId, map);
  return map;
}

function changesFor(agent) {
  return loadFilesSync(agent.session.id);
}

function absolutePath(agent, path) {
  return isAbsolute(path) ? path : resolve(agent.session.header.cwd ?? process.cwd(), path);
}

function undoDir() {
  return join(process.env.DSH_HOME ?? ".dsh", "storages", "dsh-edit-guardian");
}

function undoFile(sessionId) {
  const safe = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(undoDir(), `undo-${safe}.json`);
}

async function persistFiles(sessionId) {
  try {
    await mkdir(undoDir(), { recursive: true });
    const files = changesBySession.get(sessionId);
    if (files === undefined || files.size === 0) {
      await rm(undoFile(sessionId), { force: true });
      return;
    }
    const data = {
      files: [...files.values()].map((snap) => ({ path: snap.path, before: snap.before }))
    };
    await writeFile(undoFile(sessionId), JSON.stringify(data), "utf8");
  } catch {
    // persistence is best-effort; in-memory undo still works for this process
  }
}

async function restoreFile(snap) {
  if (snap.before === null || snap.before === undefined) {
    await rm(snap.path, { force: true });
  } else {
    await writeFile(snap.path, snap.before, "utf8");
  }
}

function apply(ctx) {
  // 1) Dangerous-command gate -------------------------------------------
  ctx.on("tools/pre-execute", (exec, next) => {
    if (exec.name !== "bash" && exec.name !== "pwsh") return next();
    const command = exec.arguments?.command;
    if (typeof command !== "string" || command.trim().length === 0) return next();

    const hit = detectDangerous(command);
    if (hit === undefined) return next();

    // Full access is the DSH "trust everything" permission preset. When the
    // session is already running danger-full-access, do not prompt again.
    const sandboxPolicy = ctx.get("sandboxPolicy");
    if (sandboxPolicy !== undefined && exec.agent !== undefined) {
      try {
        const resolved = sandboxPolicy.resolve({ session: exec.agent.session });
        if (resolved.mode === "danger-full-access") return next();
      } catch {
        // fall through to the approval ask below
      }
    }

    return {
      kind: "ask",
      reason: `potentially dangerous command pattern "${hit.label}": ${hit.detail}`
    };
  });

  // 2) Record write/edit results for /undo --------------------------------
  ctx.on("tools/result", (exec, result) => {
    try {
      if (result.isError || exec.agent === undefined) return;
      if (exec.name !== "write" && exec.name !== "edit") return;
      const value = result.value;
      if (typeof value !== "object" || value === null) return;
      if (typeof value.path !== "string" || !("before" in value)) return;

      const files = changesFor(exec.agent);
      const path = absolutePath(exec.agent, value.path);
      const key = pathKey(path);
      if (files.get(key) === undefined) {
        files.set(key, { path, before: value.before });
        persistFiles(exec.agent.session.id);
      }
    } catch {
      // recording is best-effort; never disturb the tool pipeline
    }
  });

  // 3) /undo command ------------------------------------------------------
  ctx.commands.register({
    name: "undo",
    description: "undo file changes recorded from write/edit tools",
    input: { hint: "[<path>|--all]" },
    async handler(invocation) {
      const sessionId = invocation.agent.session.id;
      const files = loadFilesSync(sessionId);
      if (files === undefined || files.size === 0) {
        return { kind: "error", text: "No recorded file changes to undo." };
      }

      const input = invocation.rawInput.trim();
      if (input === "" || input === "--all") {
        const keys = [...files.keys()];
        const reverted = [];
        for (const key of keys) {
          const snap = files.get(key);
          try {
            await restoreFile(snap);
            files.delete(key);
            reverted.push(snap.path);
          } catch (error) {
            return {
              kind: "error",
              text: `Failed to revert ${snap.path}: ${error instanceof Error ? error.message : String(error)}`
            };
          }
        }
        await persistFiles(sessionId);
        return { kind: "success", text: `Reverted ${reverted.length} file(s):\n${reverted.join("\n")}` };
      }

      const target = absolutePath(invocation.agent, input);
      const snap = files.get(pathKey(input)) ?? files.get(pathKey(target));
      if (snap === undefined) {
        return { kind: "error", text: `No recorded change for path: ${input}` };
      }
      try {
        await restoreFile(snap);
        files.delete(pathKey(snap.path));
        await persistFiles(sessionId);
        return { kind: "success", text: `Reverted ${snap.path}.` };
      } catch (error) {
        return {
          kind: "error",
          text: `Failed to revert ${snap.path}: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    }
  });
}

export { apply, inject, name };
