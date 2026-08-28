/**
 * dsh-guardian (host half)
 *
 * Watches `tools/pre-execute` for bash/pwsh calls whose command matches a
 * potentially destructive pattern (rm, Remove-Item, format, git push --force,
 * curl|sh, ...). In a normal permission mode the execution is routed through
 * the DSH approval seam, so the Web UI shows an approve/reject prompt before
 * anything runs. When the session's sandbox mode is `danger-full-access`
 * (the Web UI's "Full access" permission preset), the user has already chosen
 * to trust everything, so the gate lets the command through without a prompt.
 */
const name = "dsh-guardian";
const inject = [];

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

function apply(ctx) {
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
}

export { apply, inject, name };
