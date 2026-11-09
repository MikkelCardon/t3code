import { describe, expect, it } from "vite-plus/test";

import { buildChangeFlow } from "./changeFlow.logic";

describe("buildChangeFlow", () => {
  it("links changed files through relative, aliased and workspace imports", () => {
    const flow = buildChangeFlow([
      {
        path: "apps/web/src/components/Overview.tsx",
        contents: [
          'import { useState } from "react";',
          'import { KeyFigure } from "./KeyFigure";',
          'import {\n  benchmark,\n  type Benchmark as Result,\n} from "~/lib/benchmark";',
          'import { isTestChangedFile } from "@t3tools/shared/changedFileKind";',
          'import debounce from "lodash/debounce";',
          'const lazy = import("../lazy/index.js");',
        ].join("\n"),
      },
      { path: "apps/web/src/components/KeyFigure.tsx", contents: "" },
      { path: "apps/web/src/lib/benchmark.ts", contents: "" },
      {
        path: "apps/web/src/lib/benchmark.test.ts",
        contents: 'import { benchmark } from "./benchmark";',
      },
      { path: "apps/web/src/lazy/index.ts", contents: "" },
      { path: "apps/web/src/utils/debounce.ts", contents: "" },
      { path: "packages/shared/src/changedFileKind.ts", contents: "" },
      { path: "docs/react.md", contents: 'import x from "./KeyFigure";' },
    ]);

    expect(flow.links).toEqual([
      {
        from: "apps/web/src/components/Overview.tsx",
        to: "apps/web/src/components/KeyFigure.tsx",
        names: ["KeyFigure"],
      },
      {
        from: "apps/web/src/components/Overview.tsx",
        to: "apps/web/src/lib/benchmark.ts",
        names: ["benchmark", "Benchmark"],
      },
      {
        from: "apps/web/src/components/Overview.tsx",
        to: "packages/shared/src/changedFileKind.ts",
        names: ["isTestChangedFile"],
      },
      {
        from: "apps/web/src/components/Overview.tsx",
        to: "apps/web/src/lazy/index.ts",
        names: [],
      },
      {
        from: "apps/web/src/lib/benchmark.test.ts",
        to: "apps/web/src/lib/benchmark.ts",
        names: ["benchmark"],
      },
    ]);
    expect(flow.layers).toEqual([
      ["apps/web/src/components/Overview.tsx", "apps/web/src/lib/benchmark.test.ts"],
      [
        "apps/web/src/components/KeyFigure.tsx",
        "apps/web/src/lib/benchmark.ts",
        "apps/web/src/lazy/index.ts",
        "packages/shared/src/changedFileKind.ts",
      ],
    ]);
  });

  it("puts a file below its deepest importer and survives an import cycle", () => {
    const flow = buildChangeFlow([
      { path: "a.ts", contents: 'import "./b";\nimport { c } from "./c";' },
      { path: "b.ts", contents: 'export * from "./c";' },
      { path: "c.ts", contents: 'const b = require("./b");' },
    ]);

    expect(flow.layers).toEqual([["a.ts"], ["c.ts"], ["b.ts"]]);
  });
});
