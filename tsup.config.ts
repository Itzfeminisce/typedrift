import { defineConfig } from "tsup"

export default defineConfig([
  // Main library + adapters (browser/RSC safe)
  {
    entry: {
      "index":       "src/index.ts",
      "next/index":  "src/next/index.ts",
      "start/index": "src/start/index.ts",
    },
    format:    ["esm", "cjs"],
    dts:       true,
    sourcemap: true,
    clean:     true,
    splitting: false,
    treeshake: true,
    external:  [
      "react", "next", "next/navigation", "next/cache", "next/headers",
      "@tanstack/react-router", "@tanstack/react-start",
    ],
  },
  // CLI (Node.js only — no browser)
  {
    entry: {
      "cli/index": "src/cli/index.ts",
      "cli/bin":   "src/cli/bin.ts",
    },
    format:    ["esm", "cjs"],
    dts:       true,
    sourcemap: true,
    splitting: false,
    treeshake: true,
    platform:  "node",
    target:    "node18",
    external:  ["ts-morph", "chokidar", "picocolors"],
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
])
