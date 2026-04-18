// ─── typedrift/cli — public API ───────────────────────────────────────────────
//
// Import from "typedrift/cli" in your config file:
//
//   import { defineConfig } from "typedrift/cli"
//
//   export default defineConfig({
//     include:  ["src/**/*.ts", "src/**/*.tsx"],
//     registry: "src/lib/registry.ts",
//     output:   "src/lib",
//     aliases:  { "@": "src", "~": "src" },
//   })

export { defineConfig }       from "./config.js"
export type { TypedriftConfig, ResolvedConfig } from "./config.js"

// Analysis types — useful for tooling built on top of the CLI
export type {
  ModelInfo, ViewInfo, ResolverInfo,
  ActionInfo, AnalysisIssue, AnalysisResult,
  FieldInfo, FieldKind,
}                             from "./analysis/analyser.js"
export { TypedriftAnalyser }  from "./analysis/analyser.js"
