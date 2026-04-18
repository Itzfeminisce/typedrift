// ─── check command ────────────────────────────────────────────────────────────

import pc from "picocolors"
import type { ResolvedConfig } from "../config.js"
import { TypedriftAnalyser } from "../analysis/analyser.js"
import type { AnalysisResult, AnalysisIssue } from "../analysis/analyser.js"

export type CheckOptions = {
  cwd:     string
  config:  ResolvedConfig
  watch?:  boolean
  silent?: boolean
}

// ── Formatter ─────────────────────────────────────────────────────────────────

function formatIssues(issues: AnalysisIssue[], result: AnalysisResult): void {
  const models    = result.models.length
  const resolvers = result.resolvers.length
  const views     = result.views.length

  console.log(pc.bold("\nTypedrift registry check"))
  console.log(pc.dim(`Models: ${models}  Views: ${views}  Resolvers: ${resolvers}\n`))

  if (issues.length === 0) {
    console.log(pc.green("✓") + "  Registry complete — all resolvers registered")
    return
  }

  // Group by model
  const byModel = new Map<string, AnalysisIssue[]>()
  for (const issue of issues) {
    const key = issue.modelName
    if (!byModel.has(key)) byModel.set(key, [])
    byModel.get(key)!.push(issue)
  }

  for (const [modelName, modelIssues] of byModel) {
    for (const issue of modelIssues) {
      if (issue.type === "missing-root") {
        console.log(
          pc.red("✗") + "  " +
          pc.bold(modelName) +
          pc.dim(" — root resolver NOT registered")
        )
      } else if (issue.type === "missing-resolver") {
        console.log(
          pc.red("✗") + "  " +
          pc.bold(`${modelName}.${issue.relation}`) +
          pc.dim(" — relation resolver NOT registered")
        )
      }

      if (issue.usedIn.length > 0) {
        console.log(pc.dim("   Used in:"))
        for (const usage of issue.usedIn) {
          console.log(
            pc.dim(`     ${usage.filePath}`) +
            pc.dim(` (${usage.viewName})`)
          )
        }
      }

      console.log()
    }
  }
}

function formatSummary(issues: AnalysisIssue[]): void {
  if (issues.length === 0) return

  const errors = issues.filter(i => i.severity === "error").length
  const warns  = issues.filter(i => i.severity === "warning").length

  const parts: string[] = []
  if (errors > 0) parts.push(pc.red(`${errors} error${errors > 1 ? "s" : ""}`))
  if (warns  > 0) parts.push(pc.yellow(`${warns} warning${warns > 1 ? "s" : ""}`))

  console.log(parts.join(", ") + " found")
  console.log(
    pc.dim(`Run: `) +
    pc.cyan("npx typedrift generate --missing") +
    pc.dim(" to scaffold missing resolvers")
  )
}

// ── check ─────────────────────────────────────────────────────────────────────

export async function runCheck(opts: CheckOptions): Promise<boolean> {
  const { cwd, config } = opts

  const analyser = new TypedriftAnalyser(config, cwd)
  const result   = await analyser.analyse()

  if (!opts.silent) {
    formatIssues(result.issues, result)
    formatSummary(result.issues)
  }

  return result.issues.length === 0
}

// ── watch ─────────────────────────────────────────────────────────────────────

export async function runWatch(opts: CheckOptions): Promise<void> {
  const { cwd, config } = opts

  console.log(pc.bold("Typedrift registry — watch mode"))
  console.log(pc.dim(`Watching: ${config.include.join(", ")}\n`))

  // Initial check
  await runCheck(opts)

  // Dynamic import chokidar — keeps it out of the main bundle
  const { watch } = await import("chokidar")

  const watcher = watch(config.include, {
    cwd,
    ignored: config.exclude,
    ignoreInitial: true,
    persistent: true,
  })

  watcher.on("change", async (path) => {
    const time = new Date().toLocaleTimeString()
    console.log(pc.dim(`\n[${time}] Change detected: ${path}`))
    await runCheck(opts)
  })

  watcher.on("add", async (path) => {
    const time = new Date().toLocaleTimeString()
    console.log(pc.dim(`\n[${time}] File added: ${path}`))
    await runCheck(opts)
  })
}
