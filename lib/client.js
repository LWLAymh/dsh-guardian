window.__ModuleLoader__.load({
  id: "dsh-guardian",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");
    var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    var DiffBlock = primitives.DiffBlock;
    var IconEditOutline16 = primitives.IconEditOutline16;

    var abbreviateHomePath = function (text, home) { return text; };
    try {
      var runtimeClient = require("@deepseek-ai/dsh-client-runtime/client");
      if (runtimeClient && typeof runtimeClient.abbreviateHomePath === "function") {
        abbreviateHomePath = runtimeClient.abbreviateHomePath;
      }
    } catch (_) {}

    // ------------------------------------------------------------------
    // Pure helpers (mirroring the built-in tool-card models so the row
    // sees the same wire data the stock file-mutation row consumes)
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
        // Very large hunks: fall back to a cheap same-line overlap estimate
        // so the summary bar stays responsive; the expanded DiffBlock still
        // shows the authoritative diff.
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
      // Strip the shared prefix/suffix (the context lines of the hunk),
      // then count the changed middle as the LCS complement.
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
    // Styles (theme variables keep the row consistent with the rest of the UI)
    // ------------------------------------------------------------------
    var css = [
      ".dshg_card{min-width:0;display:flex;flex-direction:column}",
      ".dshg_row{min-width:0;height:24px;display:flex;align-items:center;gap:6px;font-size:13px;line-height:20px}",
      ".dshg_leading{width:16px;height:16px;color:var(--dsw-alias-label-tertiary);flex:none;display:inline-flex;align-items:center;justify-content:center;margin-right:2px}",
      ".dshg_path{min-width:0;max-width:60%;color:var(--dsw-alias-label-primary);background:0 0;border:none;padding:0;font:inherit;line-height:20px;text-align:left;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;cursor:pointer}",
      ".dshg_path:hover:not(:disabled){text-decoration:underline}",
      ".dshg_stats{flex:none;display:inline-flex;align-items:center;gap:8px;font-family:var(--ds-font-family-code);font-size:12px;line-height:18px}",
      ".dshg_add{color:var(--dsw-alias-state-success-primary)}",
      ".dshg_rem{color:var(--dsw-alias-state-error-primary)}",
      ".dshg_toggle{flex:none;height:20px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:0 8px;font-size:12px;line-height:18px;cursor:pointer}",
      ".dshg_toggle:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}",
      ".dshg_error{min-width:0;color:var(--dsw-alias-state-error-primary);text-overflow:ellipsis;white-space:nowrap;overflow:hidden}",
      ".dshg_body{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden;margin:4px 0 4px 22px}",
      ".dshg_diff{--dsl-diff-font:var(--dsw-font-markdown-code-block-small);--dsl-diff-line-height:18px}"
    ].join("\n");
    var tagId = "dsh-guardian/file-change-row.module.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-guardian";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    // ------------------------------------------------------------------
    // The row: path +line/-line stats and a "显示 diff" toggle
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

      var model = diffModel(block);
      var stats = model === null ? null : lineStatsForDiffs(model.diffs);
      var state = settled ? (block.isError ? "error" : "ok") : "running";

      var openState = React.useState(false);
      var open = openState[0];
      var setOpen = openState[1];

      var children = [];

      children.push(React.createElement("span", { key: "leading", className: "dshg_leading" },
        React.createElement(IconEditOutline16, { size: 14 })));

      var pathProps = { key: "path", type: "button", className: "dshg_path", title: path };
      if (openFile && path) pathProps.onClick = function () { openFile(path); };
      children.push(React.createElement("button", pathProps, shownPath || path || "(file)"));

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
          onClick: function () { setOpen(!open); }
        }, open ? "隐藏 diff" : "显示 diff"));
      } else if (state === "error") {
        children.push(React.createElement("span", { key: "err", className: "dshg_error" }, firstLine(resultText(block))));
      }

      var row = React.createElement("div", { className: "dshg_row", "data-state": state }, children);
      var body = null;
      if (open && model !== null) {
        body = React.createElement("div", { className: "dshg_body" },
          React.createElement(DiffBlock, { diffs: model.diffs, className: "dshg_diff" }));
      }

      return React.createElement("div", { className: "dshg_card" }, row, body);
    }

    // ------------------------------------------------------------------
    // Registration
    // ------------------------------------------------------------------
    function apply(ctx) {
      ctx.slots.inject("tool.call.toolview", function* () {
        // Lower priority numbers win keyed slot cells, and later static
        // registrations normally lose to the shipped file-mutation row.
        // A large negative priority makes this row the winner for these keys.
        var base = { name: "tool.call.toolview", priority: -1000000 };
        yield ctx.slots.register(Object.assign({}, base, { key: "write" }), FileChangeRow);
        yield ctx.slots.register(Object.assign({}, base, { key: "edit" }), FileChangeRow);
        yield ctx.slots.register(Object.assign({}, base, { key: "str_replace_editor" }), FileChangeRow);
      });
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  }
});
