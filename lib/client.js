window.__ModuleLoader__.load({
  id: "dsh-edit-guardian",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");
    var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    var IconEditOutline16 = primitives.IconEditOutline16;
    var IconApiOutline14 = primitives.IconApiOutline14;
    var IconChevronDownOutline14 = primitives.IconChevronDownOutline14;
    var StateDot = primitives.StateDot;
    var TerminalBlock = primitives.TerminalBlock;

    var abbreviateHomePath = function (text, home) { return text; };
    var isAppendSurfaceEvent = function () { return true; };
    try {
      var runtimeClient = require("@deepseek-ai/dsh-client-runtime/client");
      if (runtimeClient && typeof runtimeClient.abbreviateHomePath === "function") {
        abbreviateHomePath = runtimeClient.abbreviateHomePath;
      }
      if (runtimeClient && typeof runtimeClient.isAppendSurfaceEvent === "function") {
        isAppendSurfaceEvent = runtimeClient.isAppendSurfaceEvent;
      }
    } catch (_) {}

    // ------------------------------------------------------------------
    // Shared helpers
    // ------------------------------------------------------------------
    function parseArgs(raw) {
      if (typeof raw !== "string" || raw === "") return undefined;
      try {
        var parsed = JSON.parse(raw);
        return parsed !== null && typeof parsed === "object" ? parsed : undefined;
      } catch (_) {
        return undefined;
      }
    }

    function preventFocusScroll(event) {
      if (event && event.preventDefault) event.preventDefault();
    }

    function firstLine(text) {
      if (text === undefined || text === null) return "";
      var nl = text.indexOf("\n");
      return nl === -1 ? text : text.slice(0, nl);
    }

    function relativizeToCwd(text, cwd) {
      if (cwd === undefined || cwd === "") return text;
      var root = String(cwd).replace(/[/\\]+$/, "");
      if (text.slice(0, root.length + 1) === root + "/" || text.slice(0, root.length + 1) === root + "\\") {
        return text.slice(root.length + 1);
      }
      return text;
    }

    function displayPath(path, cwd, home) {
      return abbreviateHomePath(relativizeToCwd(path, cwd), home);
    }

    function narrowDiffs(diffs) {
      if (!Array.isArray(diffs) || diffs.length === 0) return null;
      var out = [];
      for (var i = 0; i < diffs.length; i++) {
        var hunk = diffs[i];
        if (typeof hunk !== "object" || hunk === null) return null;
        if (typeof hunk.path !== "string") return null;
        if (hunk.oldText !== null && typeof hunk.oldText !== "string") return null;
        if (typeof hunk.newText !== "string") return null;
        out.push({ path: hunk.path, oldText: hunk.oldText, newText: hunk.newText });
      }
      return out;
    }

    function diffModel(block) {
      var view = null;
      if (block !== null && typeof block === "object" && "kind" in block) {
        view = block.resultView && block.resultView.card === "diff" ? block.resultView : null;
        if (view === null) view = block.callView && block.callView.card === "diff" ? block.callView : null;
      } else {
        view = block && block.callView && block.callView.card === "diff" ? block.callView : null;
      }
      if (view === null) return null;
      var diffs = narrowDiffs(view.diffs);
      return diffs === null ? null : { diffs: diffs };
    }

    function resultText(block) {
      if (!block || !Array.isArray(block.content)) return "";
      var parts = [];
      for (var i = 0; i < block.content.length; i++) {
        var item = block.content[i];
        if (item && item.type === "text") parts.push(item.text);
        else parts.push(JSON.stringify(item));
      }
      if (parts.length === 0 && block.error) parts.push(block.error.name + ": " + block.error.code);
      return parts.join("\n");
    }

    function lcsLength(a, b) {
      var n = a.length;
      var m = b.length;
      if (n === 0 || m === 0) return 0;
      if (n * m > 400000) {
        var overlap = 0;
        var bIndex = {};
        for (var i = 0; i < m; i++) bIndex[b[i]] = true;
        for (var j = 0; j < n; j++) if (bIndex[a[j]] === true) overlap += 1;
        return overlap > Math.min(n, m) ? Math.min(n, m) : overlap;
      }
      var prev = new Array(m + 1).fill(0);
      for (var i = 1; i <= n; i++) {
        var cur = new Array(m + 1).fill(0);
        var ai = a[i - 1];
        for (var j = 1; j <= m; j++) {
          cur[j] = ai === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
        }
        prev = cur;
      }
      return prev[m];
    }

    function hunkLineStats(oldText, newText) {
      var a = oldText === null ? [] : oldText.split("\n");
      var b = newText.split("\n");
      if (oldText === null) return { added: b.length, removed: 0 };
      var start = 0;
      while (start < a.length && start < b.length && a[start] === b[start]) start++;
      var endA = a.length;
      var endB = b.length;
      while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA -= 1;
        endB -= 1;
      }
      var midA = a.slice(start, endA);
      var midB = b.slice(start, endB);
      var lcs = lcsLength(midA, midB);
      return { removed: midA.length - lcs, added: midB.length - lcs };
    }

    function lineStatsForDiffs(diffs) {
      var added = 0;
      var removed = 0;
      for (var i = 0; i < diffs.length; i++) {
        var s = hunkLineStats(diffs[i].oldText, diffs[i].newText);
        added += s.added;
        removed += s.removed;
      }
      return { added: added, removed: removed };
    }

    // ------------------------------------------------------------------
    // Line diff renderer with visible context
    // ------------------------------------------------------------------
    function lcsTable(a, b) {
      var n = a.length;
      var m = b.length;
      var table = new Array(n + 1);
      for (var i = 0; i <= n; i++) {
        table[i] = new Array(m + 1).fill(0);
      }
      for (var i = 1; i <= n; i++) {
        var ai = a[i - 1];
        for (var j = 1; j <= m; j++) {
          table[i][j] = ai === b[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1]);
        }
      }
      return table;
    }

    function diffLines(a, b) {
      var start = 0;
      while (start < a.length && start < b.length && a[start] === b[start]) start++;
      var endA = a.length;
      var endB = b.length;
      while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA -= 1;
        endB -= 1;
      }

      var ops = [];
      for (var i = 0; i < start; i++) ops.push({ type: "equal", text: a[i] });

      var midA = a.slice(start, endA);
      var midB = b.slice(start, endB);
      if (midA.length === 0 && midB.length === 0) {
        // nothing to do
      } else if (midA.length * midB.length > 400000) {
        for (var j = 0; j < midA.length; j++) ops.push({ type: "remove", text: midA[j] });
        for (var k = 0; k < midB.length; k++) ops.push({ type: "add", text: midB[k] });
      } else {
        var table = lcsTable(midA, midB);
        var i2 = midA.length;
        var j2 = midB.length;
        var rev = [];
        while (i2 > 0 && j2 > 0) {
          if (midA[i2 - 1] === midB[j2 - 1]) {
            rev.push({ type: "equal", text: midA[i2 - 1] });
            i2 -= 1;
            j2 -= 1;
          } else if (table[i2 - 1][j2] >= table[i2][j2 - 1]) {
            rev.push({ type: "remove", text: midA[i2 - 1] });
            i2 -= 1;
          } else {
            rev.push({ type: "add", text: midB[j2 - 1] });
            j2 -= 1;
          }
        }
        while (i2 > 0) {
          rev.push({ type: "remove", text: midA[i2 - 1] });
          i2 -= 1;
        }
        while (j2 > 0) {
          rev.push({ type: "add", text: midB[j2 - 1] });
          j2 -= 1;
        }
        for (var r = rev.length - 1; r >= 0; r--) ops.push(rev[r]);
      }

      var suffix = a.length - endA;
      for (var s = 0; s < suffix; s++) ops.push({ type: "equal", text: a[endA + s] });
      return ops;
    }

    function renderDiffLine(op, idx) {
      var text = op.text === "" ? " " : op.text;
      if (op.type === "remove") {
        return React.createElement("div", { key: idx, className: "dshg_diff_line dshg_diff_del" }, "- " + text);
      }
      if (op.type === "add") {
        return React.createElement("div", { key: idx, className: "dshg_diff_line dshg_diff_add" }, "+ " + text);
      }
      return React.createElement("div", { key: idx, className: "dshg_diff_line dshg_diff_ctx" }, "  " + text);
    }

    function GuardianDiff(props) {
      var diffs = props.diffs || [];
      var blocks = [];
      var lineKey = 0;
      for (var h = 0; h < diffs.length; h++) {
        var hunk = diffs[h];
        var oldLines = hunk.oldText === null ? [] : hunk.oldText.split("\n");
        var newLines = hunk.newText.split("\n");
        var ops;
        if (hunk.oldText === null) {
          ops = newLines.map(function (line) { return { type: "add", text: line }; });
        } else {
          ops = diffLines(oldLines, newLines);
        }
        var lines = ops.map(function (op, idx) {
          return renderDiffLine(op, lineKey++);
        });
        blocks.push(React.createElement("div", { key: h, className: "dshg_diff_hunk" }, lines));
      }
      return React.createElement("div", { className: "dshg_diff" }, blocks);
    }

    // ------------------------------------------------------------------
    // Terminal-card model + dangerous-command highlighting
    // ------------------------------------------------------------------
    function terminalCardModel(block, sessionCwd) {
      var call = block.callView && block.callView.card === "terminal" ? block.callView : null;
      if (!("kind" in block)) {
        if (call === null) return null;
        return {
          description: call.description,
          card: {
            command: call.title,
            cwd: call.cwd || sessionCwd,
            output: undefined,
            exitCode: undefined,
            signal: undefined,
            running: true
          }
        };
      }
      var result = block.resultView && block.resultView.card === "terminal" ? block.resultView : null;
      if (result === null) return null;
      return {
        description: call ? call.description : undefined,
        card: {
          command: result.title || (call && call.title) || "",
          cwd: call ? (call.cwd || sessionCwd) : undefined,
          output: result.output,
          exitCode: result.exitCode,
          signal: result.signal,
          running: false
        }
      };
    }

    function terminalFailed(model) {
      var c = model.card;
      return c.running !== true && ((c.exitCode !== undefined && c.exitCode !== 0) || c.signal !== undefined);
    }

    function terminalLabels() {
      return {
        signal: function (s) { return "signal: " + s; },
        exitCode: function (c) { return "exit code: " + c; },
        running: "running",
        failed: "failed",
        done: "done",
        copy: "copy",
        copied: "copied",
        noOutput: "(no output)",
        collapseAria: "collapse output",
        collapse: "collapse",
        expandAria: function (n) { return "expand " + n + " lines"; },
        expand: function (n) { return "expand " + n + " lines"; }
      };
    }

    var DANGER_SOURCE = "\\brm\\b|\\brmdir\\b|\\bRemove-Item\\b|\\bdel\\b|\\brd\\b|\\bformat\\b|\\bmkfs\\b|\\bdiskpart\\b|\\bdd\\b[^\\n|&;]*\\bof=|\\bgit\\s+clean\\b|\\bgit\\s+reset\\b[^\\n|&;]*--hard|\\bgit\\s+push\\b[^\\n|&;]*--force|\\b(?:shutdown|reboot|halt|poweroff)\\b|\\bRestart-Computer\\b|\\bStop-Computer\\b|\\bClear-Content\\b|\\bcurl\\b[^\\n|&;]*\\|\\s*(?:ba)?sh\\b|\\bwget\\b[^\\n|&;]*\\|\\s*(?:ba)?sh\\b";

    function dangerSegments(command) {
      var re = new RegExp(DANGER_SOURCE, "gi");
      var ranges = [];
      var m;
      while ((m = re.exec(command)) !== null) {
        if (m[0].length === 0) {
          re.lastIndex += 1;
          continue;
        }
        ranges.push([m.index, m.index + m[0].length]);
      }
      if (ranges.length === 0) return [{ text: command, danger: false }];
      ranges.sort(function (a, b) { return a[0] - b[0]; });
      var merged = [ranges[0]];
      for (var i = 1; i < ranges.length; i++) {
        var last = merged[merged.length - 1];
        if (ranges[i][0] <= last[1]) {
          last[1] = Math.max(last[1], ranges[i][1]);
        } else {
          merged.push(ranges[i]);
        }
      }
      var out = [];
      var cursor = 0;
      for (var j = 0; j < merged.length; j++) {
        var r = merged[j];
        if (r[0] > cursor) out.push({ text: command.slice(cursor, r[0]), danger: false });
        out.push({ text: command.slice(r[0], r[1]), danger: true });
        cursor = r[1];
      }
      if (cursor < command.length) out.push({ text: command.slice(cursor), danger: false });
      return out;
    }

    function renderDangerSegments(segments) {
      return segments.map(function (seg, idx) {
        return React.createElement("span", { key: idx, className: seg.danger ? "dshg_danger" : undefined }, seg.text);
      });
    }

    // ------------------------------------------------------------------
    // Styles
    // ------------------------------------------------------------------
    var css = [
      ".dshg_card{min-width:0;display:flex;flex-direction:column}",
      ".dshg_row{min-width:0;height:24px;display:flex;align-items:center;gap:6px;font-size:13px;line-height:20px}",
      ".dshg_leading{width:16px;height:16px;color:var(--dsw-alias-label-tertiary);flex:none;display:inline-flex;align-items:center;justify-content:center;margin-right:2px}",
      ".dshg_path{min-width:0;max-width:60%;color:var(--dsw-alias-label-primary);background:0 0;border:none;padding:0;font:inherit;line-height:20px;text-align:left;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;cursor:pointer}",
      ".dshg_path:hover:not(:disabled){text-decoration:underline}",
      ".dshg_path_perm{color:var(--dsw-alias-state-error-primary)}",
      ".dshg_perm_badge{flex:none;display:inline-flex;align-items:center;height:18px;color:var(--dsw-alias-state-error-primary);border:1px solid var(--dsw-alias-state-error-primary);border-radius:9px;padding:0 6px;font-size:11px;line-height:16px;max-width:40%;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}",
      ".dshg_stats{flex:none;display:inline-flex;align-items:center;gap:8px;font-family:var(--ds-font-family-code);font-size:12px;line-height:18px}",
      ".dshg_add{color:var(--dsw-alias-state-success-primary)}",
      ".dshg_rem{color:var(--dsw-alias-state-error-primary)}",
      ".dshg_toggle{flex:none;height:20px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:0 8px;font-size:12px;line-height:18px;cursor:pointer}",
      ".dshg_toggle:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}",
      ".dshg_error{min-width:0;color:var(--dsw-alias-state-error-primary);text-overflow:ellipsis;white-space:nowrap;overflow:hidden}",
      ".dshg_body{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow-x:hidden;overflow-y:auto;overflow-anchor:none;max-height:320px;margin:4px 0 4px 22px}",
      ".dshg_diff{flex-direction:column;display:flex;gap:2px}",
      ".dshg_diff_hunk{border-top:1px solid var(--dsw-alias-border-l2);padding:2px 0}",
      ".dshg_diff_hunk:first-child{border-top:none;padding-top:0}",
      ".dshg_diff_line{white-space:pre-wrap;word-break:break-word;font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;min-height:18px}",
      ".dshg_diff_ctx{color:var(--dsw-alias-label-primary)}",
      ".dshg_diff_del{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-state-error-tertiary,transparent)}",
      ".dshg_diff_add{color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-state-success-tertiary,transparent)}",
      ".dshg_title{font-weight:400;color:var(--dsw-alias-label-primary);flex:none}",
      ".dshg_sep{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 2px}",
      ".dshg_summary_text{min-width:0;display:inline-flex;align-items:center;gap:0;color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;overflow:hidden;font-family:var(--ds-font-family-code);font-size:12px;line-height:18px}",
      ".dshg_danger{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-state-error-tertiary,transparent);border-radius:3px;padding:0 2px;font-weight:600}",
      ".dshg_chevron{color:var(--dsw-alias-label-secondary);flex:none}",
      ".dshg_terminal{margin:4px 0 4px 22px;border:1px solid var(--dsw-alias-border-l1)}",
      ".dshg_summary{flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-interactive-bg-hover);border-radius:10px;margin:2px 0 6px;padding:8px 12px;display:flex}",
      ".dshg_summary_head{display:flex;align-items:center;gap:8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}",
      ".dshg_summary_files{display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto}",
      ".dshg_summary_file{display:flex;flex-direction:column;gap:4px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-input-major);border-radius:10px;padding:6px 10px;min-width:0;overflow-anchor:none}",
      ".dshg_summary_file_row{display:flex;align-items:center;gap:6px;min-width:0}",
      ".dshg_summary_path{flex:1 1 auto;min-width:0;max-width:none;color:var(--dsw-alias-label-primary);background:0 0;border:none;padding:0;font:inherit;text-align:left;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;cursor:pointer}",
      ".dshg_summary_path:hover{text-decoration:underline}",
      ".dshg_summary_diff{margin:0;max-height:260px;overflow-y:auto}",
      ".dshg_undo{height:18px;color:var(--dsw-alias-label-secondary);background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:0 6px;font-size:12px;line-height:16px;cursor:pointer;flex:none}",
      ".dshg_undo:hover{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}",
      ".dshg_keep{height:18px;color:var(--dsw-alias-label-secondary);background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:0 6px;font-size:12px;line-height:16px;cursor:pointer;flex:none}",
      ".dshg_keep:hover{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}",
      ".dshg_reason_btn{height:18px;color:var(--dsw-alias-label-secondary);background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:0 6px;font-size:12px;line-height:16px;cursor:pointer;flex:none}",
      ".dshg_reason_btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary)}",
      ".dshg_reason_body{white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;font-size:12px;line-height:18px;max-height:140px;overflow-y:auto}",
      ".dshg_undo_all{height:20px;color:var(--dsw-alias-label-secondary);background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:0 8px;font-size:12px;line-height:18px;cursor:pointer;flex:none}",
      ".dshg_undo_all:hover{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}",
      ".dshg_msg{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}"
    ].join("\n");
    var tagId = "dsh-edit-guardian/file-change-row.module.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-edit-guardian";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    // ------------------------------------------------------------------
    // File-change row (write / edit / str_replace_editor)
    // ------------------------------------------------------------------
    function FileChangeRow(props) {
      var block = props.block;
      var cwd = props.cwd;
      var home = props.home;
      var openFile = props.openFile;

      var settled = block !== null && typeof block === "object" && "kind" in block;
      var argsRaw = settled ? (block.call && block.call.argsRaw) || "" : (block && block.argsRaw) || "";
      var args = parseArgs(argsRaw);
      var path = (args && (typeof args.file_path === "string" ? args.file_path : typeof args.path === "string" ? args.path : "")) || "";
      var shownPath = displayPath(path, cwd, home);
      var escalation = args && typeof args.sandbox_permissions === "string" && args.sandbox_permissions.length > 0;

      var model = diffModel(block);
      var stats = model === null ? null : lineStatsForDiffs(model.diffs);
      var state = settled ? (block.isError ? "error" : "ok") : "running";

      var openState = React.useState(false);
      var open = openState[0];
      var setOpen = openState[1];

      var children = [];

      children.push(React.createElement("span", { key: "leading", className: "dshg_leading" },
        React.createElement(IconEditOutline16, { size: 14 })));

      var pathProps = { key: "path", type: "button", className: escalation ? "dshg_path dshg_path_perm" : "dshg_path", title: path };
      if (openFile && path) pathProps.onClick = function () { openFile(path); };
      children.push(React.createElement("button", pathProps, shownPath || path || "(file)"));
      if (escalation) {
        children.push(React.createElement("span", { key: "perm", className: "dshg_perm_badge", title: "需要沙盒外权限: " + args.sandbox_permissions }, "需要权限: " + args.sandbox_permissions));
      }

      if (stats !== null && state !== "error") {
        var added = stats.added;
        var removed = stats.removed;
        if (added > 0 || removed > 0) {
          var statChildren = [];
          if (added > 0) statChildren.push(React.createElement("span", { key: "a", className: "dshg_add" }, "+" + added + "行"));
          if (removed > 0) statChildren.push(React.createElement("span", { key: "r", className: "dshg_rem" }, "-" + removed + "行"));
          children.push(React.createElement("span", { key: "stats", className: "dshg_stats" }, statChildren));
        }
      }

      if (model !== null) {
        children.push(React.createElement("button", {
          key: "toggle",
          type: "button",
          className: "dshg_toggle",
          onMouseDown: preventFocusScroll,
          onClick: function () { setOpen(!open); }
        }, open ? "隐藏 diff" : "显示 diff"));
      } else if (state === "error") {
        children.push(React.createElement("span", { key: "err", className: "dshg_error" }, firstLine(resultText(block))));
      }

      var row = React.createElement("div", { className: "dshg_row", "data-state": state }, children);
      var body = null;
      if (open && model !== null) {
        body = React.createElement("div", { className: "dshg_body" },
          React.createElement(GuardianDiff, { diffs: model.diffs }));
      }

      return React.createElement("div", { className: "dshg_card" }, row, body);
    }

    // ------------------------------------------------------------------
    // Danger-aware bash / pwsh row
    // ------------------------------------------------------------------
    function DangerBashRow(props) {
      var block = props.block;
      var cwd = props.cwd;
      var toolName = props.toolName;
      var model = terminalCardModel(block, cwd);

      var settled = block !== null && typeof block === "object" && "kind" in block;
      var state = "running";
      if (settled) {
        if (model !== null && terminalFailed(model)) state = "error";
        else if (block.isError) state = "error";
        else state = "ok";
      }

      var openState = React.useState(false);
      var open = openState[0];
      var setOpen = openState[1];

      var title = toolName === "pwsh" ? "Pwsh" : "Bash";
      var argsRaw = settled ? (block.call && block.call.argsRaw) || "" : (block && block.argsRaw) || "";
      var shellArgs = parseArgs(argsRaw);
      var escalation = shellArgs && typeof shellArgs.sandbox_permissions === "string" && shellArgs.sandbox_permissions.length > 0;
      var permDir = escalation
        ? ((shellArgs && typeof shellArgs.workdir === "string" && shellArgs.workdir.length > 0) ? shellArgs.workdir : cwd || "(workspace)")
        : null;

      if (model === null) {
        // Generic fallback for execution errors and background starts.
        var summary = (shellArgs && typeof shellArgs.description === "string" && shellArgs.description) || firstLine(argsRaw);
        var output = settled ? resultText(block) : "";
        return React.createElement("div", { className: "dshg_card" },
          React.createElement("div", { className: "dshg_row", "data-state": state },
            React.createElement("span", { className: "dshg_leading" },
              state === "error"
                ? React.createElement(StateDot, { state: "error" })
                : React.createElement(IconApiOutline14, { size: 14 })),
            React.createElement("span", { className: "dshg_title" }, title),
            React.createElement("span", { className: "dshg_sep" }),
            permDir !== null
              ? React.createElement("span", { key: "perm", className: "dshg_perm_badge", title: "需要沙盒外权限: " + shellArgs.sandbox_permissions }, "需要权限: " + shellArgs.sandbox_permissions + " · " + permDir)
              : null,
            React.createElement("span", { className: "dshg_summary_text" }, summary || (settled ? firstLine(output) : "…"))
          ));
      }

      var command = model.card.command || "";
      var segments = dangerSegments(command);
      var expandable = true;
      var leading = open
        ? React.createElement(IconChevronDownOutline14, { className: "dshg_chevron" })
        : state === "error"
          ? React.createElement(StateDot, { state: "error" })
          : React.createElement(IconApiOutline14, { size: 14 });

      var rowChildren = [
        React.createElement("span", { key: "leading", className: "dshg_leading" }, leading),
        React.createElement("span", { key: "title", className: "dshg_title" }, title),
        React.createElement("span", { key: "sep", className: "dshg_sep" }),
        permDir !== null
          ? React.createElement("span", { key: "perm", className: "dshg_perm_badge", title: "需要沙盒外权限: " + shellArgs.sandbox_permissions }, "需要权限: " + shellArgs.sandbox_permissions + " · " + permDir)
          : null,
        React.createElement("span", { key: "cmd", className: "dshg_summary_text", title: model.description || command },
          renderDangerSegments(segments))
      ];

      var body = null;
      if (open) {
        body = React.createElement("div", { className: "dshg_terminal" },
          React.createElement(TerminalBlock, Object.assign({}, model.card, {
            labels: terminalLabels()
          })));
      }

      return React.createElement("div", { className: "dshg_card" },
        React.createElement("div", {
          className: "dshg_row",
          "data-state": state,
          role: "button",
          tabIndex: expandable ? 0 : undefined,
          "aria-expanded": expandable ? open : undefined,
          onClick: expandable ? function () { setOpen(!open); } : undefined,
          onKeyDown: expandable ? function (event) {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setOpen(!open);
            }
          } : undefined
        }, rowChildren),
        body);
    }

    // ------------------------------------------------------------------
    // Turn-tail summary (cumulative, per-session keep/undo resolution)
    // ------------------------------------------------------------------
    var resolvedCallsBySession = new Map();
    var summaryListeners = new Set();

    function resolvedSet(sessionId) {
      var set = resolvedCallsBySession.get(sessionId);
      if (set === undefined) {
        set = new Set();
        resolvedCallsBySession.set(sessionId, set);
      }
      return set;
    }

    function resolveCalls(sessionId, callIds) {
      var set = resolvedSet(sessionId);
      var changed = false;
      for (var i = 0; i < callIds.length; i++) {
        if (callIds[i] && !set.has(callIds[i])) {
          set.add(callIds[i]);
          changed = true;
        }
      }
      if (changed) summaryListeners.forEach(function (fn) { fn(); });
    }

    function useSummaryVersion(sessionId) {
      var state = React.useState(0);
      var setVersion = state[1];
      React.useEffect(function () {
        var fn = function () { setVersion(function (v) { return v + 1; }); };
        summaryListeners.add(fn);
        return function () { summaryListeners.delete(fn); };
      }, [sessionId]);
      return state[0];
    }

    function buildReasonByCallId(nodes) {
      var map = {};
      var lastUserText = "";
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (!node) continue;

        if (node.kind === "user" && Array.isArray(node.content)) {
          var userParts = [];
          for (var u = 0; u < node.content.length; u++) {
            var part = node.content[u];
            if (part && part.type === "text" && typeof part.text === "string" && part.text.trim() !== "") {
              userParts.push(part.text.trim());
            }
          }
          if (userParts.length > 0) lastUserText = userParts.join(" ").slice(0, 200);
          continue;
        }

        if (node.kind !== "assistant" || !Array.isArray(node.blocks)) continue;
        var texts = [];
        for (var b = 0; b < node.blocks.length; b++) {
          var block = node.blocks[b];
          if ((block.kind === "text" || block.kind === "reasoning") && typeof block.text === "string" && block.text.trim() !== "") {
            texts.push(block.text.trim());
          }
        }
        var assistantText = texts.join(" ").slice(0, 240);
        for (var c = 0; c < node.blocks.length; c++) {
          var call = node.blocks[c];
          if (call && call.kind === "tool-call" && call.callId) {
            map[call.callId] = {
              user: lastUserText,
              assistant: assistantText
            };
          }
        }
      }
      return map;
    }

    function computeUnkeptFiles(nodes, sessionId, reasonByCallId) {
      var resolved = resolvedCallsBySession.get(sessionId);
      var byPath = new Map();
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (!node || node.kind !== "tool-result") continue;
        if (node.isError) continue;
        var name = node.call && node.call.name;
        if (name !== "write" && name !== "edit") continue;
        if (resolved && node.callId && resolved.has(node.callId)) continue;

        var model = diffModel(node);
        if (model === null) continue;
        var stats = lineStatsForDiffs(model.diffs);
        if (stats.added === 0 && stats.removed === 0) continue;

        var path = model.diffs[0].path;
        var file = byPath.get(path);
        if (file === undefined) {
          file = { path: path, added: 0, removed: 0, diffs: [], callIds: [], reasons: [] };
          byPath.set(path, file);
        }
        file.added += stats.added;
        file.removed += stats.removed;
        for (var d = 0; d < model.diffs.length; d++) file.diffs.push(model.diffs[d]);
        if (node.callId && file.callIds.indexOf(node.callId) === -1) file.callIds.push(node.callId);
        if (node.callId && reasonByCallId && reasonByCallId[node.callId]) {
          var info = reasonByCallId[node.callId];
          var parts = [];
          if (info.user) parts.push("用户目标：" + info.user);
          if (info.assistant) parts.push("Agent 意图：" + info.assistant);
          if (parts.length > 0 && file.reasons.indexOf(parts.join("\n")) === -1) {
            file.reasons.push(parts.join("\n"));
          }
        }
      }
      return Array.from(byPath.values());
    }

    function selectGuardianSummary() {
      return true;
    }

    function GuardianSummary(props) {
      var sessionId = props.sessionId;
      var useSession = props.useSession;
      var executeCommand = props.executeCommand;
      var openFile = props.openFile;

      var busyState = React.useState(null);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var msgState = React.useState("");
      var msg = msgState[0];
      var setMsg = msgState[1];
      var openPathState = React.useState(null);
      var openPath = openPathState[0];
      var setOpenPath = openPathState[1];
      var reasonPathState = React.useState(null);
      var reasonPath = reasonPathState[0];
      var setReasonPath = reasonPathState[1];
      var collapsedState = React.useState(false);
      var collapsed = collapsedState[0];
      var setCollapsed = collapsedState[1];

      useSummaryVersion(sessionId);
      if (typeof useSession !== "function") return null;
      var nodes = useSession(function (s) { return s && s.nodes ? s.nodes : []; });
      var reasonByCallId = buildReasonByCallId(nodes || []);
      var files = computeUnkeptFiles(nodes || [], sessionId, reasonByCallId);
      if (files.length === 0) return null;

      function undoPath(file) {
        if (busy !== null) return;
        setBusy(file.path);
        setMsg("");
        Promise.resolve(executeCommand("/undo " + file.path)).then(function () {
          resolveCalls(sessionId, file.callIds);
          setBusy(null);
          setMsg("已撤销：" + file.path);
        }).catch(function (err) {
          setBusy(null);
          setMsg("撤销失败：" + (err && err.message ? err.message : String(err)));
        });
      }

      function keepPath(file) {
        if (busy !== null) return;
        resolveCalls(sessionId, file.callIds);
        setMsg("已保留：" + file.path);
      }

      function keepAll() {
        if (busy !== null) return;
        var allCalls = [];
        for (var i = 0; i < files.length; i++) allCalls = allCalls.concat(files[i].callIds);
        resolveCalls(sessionId, allCalls);
        setMsg("已保留全部更改");
      }

      function undoAll() {
        if (busy !== null) return;
        setBusy("--all");
        setMsg("");
        var allCalls = [];
        for (var i = 0; i < files.length; i++) allCalls = allCalls.concat(files[i].callIds);
        Promise.resolve(executeCommand("/undo --all")).then(function () {
          resolveCalls(sessionId, allCalls);
          setBusy(null);
          setMsg("已提交全部撤销");
        }).catch(function (err) {
          setBusy(null);
          setMsg("全部撤销失败：" + (err && err.message ? err.message : String(err)));
        });
      }

      var fileRows = files.map(function (file) {
        var shown = displayPath(file.path, props.cwd, props.home);
        var open = openPath === file.path;
        var reasonOpen = reasonPath === file.path;
        var pathProps = { type: "button", className: "dshg_summary_path", title: file.path };
        if (openFile) pathProps.onClick = function () { openFile(file.path); };

        var statChildren = [];
        if (file.added > 0) statChildren.push(React.createElement("span", { key: "a", className: "dshg_add" }, "+" + file.added + "行"));
        if (file.removed > 0) statChildren.push(React.createElement("span", { key: "r", className: "dshg_rem" }, "-" + file.removed + "行"));

        var reasonText = file.reasons.length > 0
          ? file.reasons.join("\n---\n")
          : "未找到该次修改的动机文本（可能已被压缩或在更早的上下文中）。";

        return React.createElement("div", { key: file.path, className: "dshg_summary_file" },
          React.createElement("div", { className: "dshg_summary_file_row" },
            React.createElement("button", pathProps, shown),
            (file.added > 0 || file.removed > 0)
              ? React.createElement("span", { className: "dshg_stats" }, statChildren)
              : null,
            React.createElement("button", {
              type: "button",
              className: "dshg_toggle",
              onMouseDown: preventFocusScroll,
              onClick: function () { setOpenPath(open ? null : file.path); }
            }, open ? "隐藏 diff" : "显示 diff"),
            React.createElement("button", {
              type: "button",
              className: "dshg_reason_btn",
              onMouseDown: preventFocusScroll,
              onClick: function () { setReasonPath(reasonOpen ? null : file.path); }
            }, reasonOpen ? "收起原因" : "更改原因"),
            React.createElement("button", {
              type: "button",
              className: "dshg_keep",
              disabled: busy !== null,
              onMouseDown: preventFocusScroll,
              onClick: function () { keepPath(file); }
            }, "保留"),
            React.createElement("button", {
              type: "button",
              className: "dshg_undo",
              disabled: busy !== null,
              onMouseDown: preventFocusScroll,
              onClick: function () { undoPath(file); }
            }, busy === file.path ? "…" : "撤销")),
          reasonOpen
            ? React.createElement("div", { className: "dshg_reason_body" }, reasonText)
            : null,
          open
            ? React.createElement("div", { className: "dshg_body dshg_summary_diff" },
                React.createElement(GuardianDiff, { diffs: file.diffs }))
            : null);
      });

      return React.createElement("div", { className: "dshg_summary" },
        React.createElement("div", { className: "dshg_summary_head" },
          "文件更改汇总 (" + files.length + ")",
          React.createElement("button", {
            type: "button",
            className: "dshg_undo_all",
            disabled: busy !== null,
            onMouseDown: preventFocusScroll,
            onClick: keepAll
          }, "全部保留"),
          React.createElement("button", {
            type: "button",
            className: "dshg_undo_all",
            disabled: busy !== null,
            onMouseDown: preventFocusScroll,
            onClick: undoAll
          }, busy === "--all" ? "…" : "全部撤销"),
          React.createElement("button", {
            type: "button",
            className: "dshg_toggle",
            onMouseDown: preventFocusScroll,
            onClick: function () { setCollapsed(!collapsed); }
          }, collapsed ? "展开" : "折叠")),
        collapsed ? null : React.createElement("div", { className: "dshg_summary_files" }, fileRows),
        msg !== "" ? React.createElement("div", { className: "dshg_msg" }, msg) : null);
    }

    // ------------------------------------------------------------------
    // Registration
    // ------------------------------------------------------------------
    function apply(ctx) {
      var commandsRemote = ctx.remote && ctx.remote.commands ? ctx.remote.commands : ctx.get("remote.commands");

      ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
        name: "conversation.input.dock",
        id: "dsh-edit-guardian-summary",
        order: 10,
        inject: commandsRemote
          ? (sessionId) => ({ executeCommand: (line) => commandsRemote.execute(sessionId, line) })
          : () => ({ executeCommand: () => Promise.reject(new Error("remote.commands unavailable")) })
      }, GuardianSummary));

      ctx.slots.inject("tool.call.toolview", function* () {
        var fileBase = { name: "tool.call.toolview", priority: -1000000 };
        yield ctx.slots.register(Object.assign({}, fileBase, { key: "write" }), FileChangeRow);
        yield ctx.slots.register(Object.assign({}, fileBase, { key: "edit" }), FileChangeRow);
        yield ctx.slots.register(Object.assign({}, fileBase, { key: "str_replace_editor" }), FileChangeRow);

        var shellBase = { name: "tool.call.toolview", priority: -1000000 };
        yield ctx.slots.register(Object.assign({}, shellBase, { key: "bash" }), DangerBashRow);
        yield ctx.slots.register(Object.assign({}, shellBase, { key: "pwsh" }), DangerBashRow);
      });
    }

    exports.apply = apply;
    exports.inject = ["slots", "remote", "remote.commands"];
    return module.exports;
  }
});
