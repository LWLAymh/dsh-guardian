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
          };
        }
        if (name === "@deepseek-ai/dsh-client-runtime/client") {
          return { abbreviateHomePath: (t, h) => t };
        }
        throw new Error("unexpected require: " + name);
      };
      const plugin = reg.factory(stubRequire);
      console.log("plugin type:", typeof plugin);
      console.log("plugin.inject:", JSON.stringify(plugin.inject));
      const slots = {
        inject(name, fn) {
          console.log("slots.inject", name);
          const it = fn();
          let step;
          while (!(step = it.next()).done) {
            step.value; // disposer
          }
        },
        register(options, comp) {
          console.log("register options:", JSON.stringify(options), "comp:", comp.name);
          return () => {};
        },
      };
      plugin.apply({ slots });
    },
  },
};

const path = require("node:path");
require(path.resolve(__dirname, "../lib/client.js"));
