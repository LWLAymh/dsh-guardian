global.window = {
  __ModuleLoader__: {
    load(reg) {
      console.log("module id:", reg.id);
      const stubRequire = (name) => {
        if (name === "react") {
          return {
            useState: (v) => [v, (nv) => { console.log("setState", nv); }],
            createElement: (type, props, ...kids) => ({ type, props, kids }),
          };
        }
        if (name === "@deepseek-ai/dsh-client-ui-primitives") {
          return {
            DiffBlock: (p) => ({ type: "DiffBlock", props: p }),
            IconEditOutline16: (p) => ({ type: "IconEditOutline16", props: p }),
            IconApiOutline14: (p) => ({ type: "IconApiOutline14", props: p }),
            IconChevronDownOutline14: (p) => ({ type: "IconChevronDownOutline14", props: p }),
            StateDot: (p) => ({ type: "StateDot", props: p }),
            TerminalBlock: (p) => ({ type: "TerminalBlock", props: p }),
          };
        }
        if (name === "@deepseek-ai/dsh-client-runtime/client") {
          return {
            abbreviateHomePath: (t, h) => t,
            isAppendSurfaceEvent: () => true,
          };
        }
        throw new Error("unexpected require: " + name);
      };
      const plugin = reg.factory(stubRequire);
      console.log("plugin type:", typeof plugin);
      console.log("plugin.inject:", JSON.stringify(plugin.inject));

      const conversationEvents = {
        register(def) {
          console.log("conversationEvents.register:", def.kind);
        },
      };
      const slots = {
        inject(name, fn) {
          console.log("slots.inject", name);
          const result = fn();
          if (result && typeof result.next === "function") {
            let step;
            while (!(step = result.next()).done) {
              const dispose = step.value;
              console.log("registered:", dispose && dispose.options ? JSON.stringify(dispose.options) : "disposer");
            }
          } else {
            console.log("registered disposer");
          }
        },
        register(options, comp) {
          console.log("register options:", JSON.stringify(options), "comp:", comp.name);
          return { options };
        },
      };
      const ctx = {
        get(name) {
          if (name === "remote.commands") return { execute: (sid, line) => Promise.resolve({ ok: true, line, sid }) };
          return undefined;
        },
        remote: { commands: { execute: (sid, line) => Promise.resolve({ ok: true, line, sid }) } },
        conversationEvents,
        slots,
      };
      plugin.apply(ctx);
    },
  },
};

const path = require("node:path");
require(path.resolve(__dirname, "../lib/client.js"));
