// ─── inspect command ──────────────────────────────────────────────────────────

import pc from "picocolors"
import type { ResolvedConfig } from "../config.js"
import { TypedriftAnalyser } from "../analysis/analyser.js"
import type { AnalysisResult } from "../analysis/analyser.js"

export type InspectOptions = {
  cwd:    string
  config: ResolvedConfig
}

function hr(label: string): void {
  const line = "─".repeat(Math.max(0, 49 - label.length))
  console.log(pc.bold(`\n${label} `) + pc.dim(line))
}

function tick(ok: boolean): string {
  return ok ? pc.green("✓") : pc.red("✗")
}

export async function runInspect(opts: InspectOptions): Promise<void> {
  const { cwd, config } = opts

  console.log(pc.bold("\nTypedrift Registry Inspector"))
  console.log(pc.dim(`Project: ${cwd}\n`))

  const analyser = new TypedriftAnalyser(config, cwd)
  const result   = await analyser.analyse()

  // ── Models ────────────────────────────────────────────────────────────────

  hr(`Models (${result.models.length})`)

  if (result.models.length === 0) {
    console.log(pc.dim("  No models found. Are your source files in the include path?"))
  }

  for (const model of result.models) {
    const resolver = result.resolvers.find(r => r.modelName === model.name)
    console.log()
    console.log(pc.bold(`  ${model.name}`) + pc.dim(`  ${model.filePath}`))

    // Fields
    if (model.fields.length > 0) {
      console.log(
        pc.dim("    Fields: ") +
        model.fields.map(f => f.name + (f.nullable ? "?" : "")).join(", ")
      )
    }

    // Relations
    if (model.relations.length > 0) {
      console.log(
        pc.dim("    Relations: ") +
        model.relations.map(r =>
          `${r.name} → ${r.relatedModel}${r.cardinality === "many" ? "[]" : ""}`
        ).join(", ")
      )
    }

    // Root resolver
    console.log(
      `    Root:      ${tick(!!resolver?.hasRoot)} ` +
      (resolver?.hasRoot
        ? pc.dim(`registered (${resolver.filePath}:${resolver.line})`)
        : pc.red("NOT registered"))
    )

    // Relation resolvers
    if (model.relations.length > 0) {
      console.log(pc.dim("    Relations:"))
      for (const rel of model.relations) {
        const hasResolver = resolver?.relations.includes(rel.name) ?? false
        // Check if this relation is selected in any view
        const usedInViews = result.views.filter(v =>
          v.modelName === model.name &&
          v.selectedRelations.includes(rel.name)
        )
        const suffix = usedInViews.length === 0
          ? pc.dim(" (not selected in any view)")
          : ""
        console.log(
          `      ${tick(hasResolver)}  ${rel.name}` +
          (hasResolver ? pc.dim(" registered") : pc.red(" NOT registered")) +
          suffix
        )
      }
    }
  }

  // ── Views ─────────────────────────────────────────────────────────────────

  hr(`Views (${result.views.length})`)

  if (result.views.length === 0) {
    console.log(pc.dim("  No views found."))
  }

  for (const view of result.views) {
    const relStr = view.selectedRelations.length > 0
      ? `, ${view.selectedRelations.map(r => r + ".{…}").join(", ")}`
      : ""
    const listStr = view.isList ? pc.dim("  [list]") : ""
    const cacheStr = view.hasCache ? pc.dim("  [cached]") : ""

    console.log(
      `  ${pc.bold(view.name)}` +
      pc.dim(`  ${view.modelName} → { ${view.selectedFields.join(", ")}${relStr} }`) +
      listStr + cacheStr
    )
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  hr(`Actions (${result.actions.length})`)

  if (result.actions.length === 0) {
    console.log(pc.dim("  No actions found."))
  }

  for (const action of result.actions) {
    const guardStr     = action.hasGuard     ? pc.green("guard ✓")     : pc.dim("no guard")
    const successStr   = action.hasOnSuccess ? pc.dim("onSuccess ✓")   : pc.dim("no onSuccess")

    console.log(
      `  ${pc.bold(action.name)}` +
      pc.dim(`  ${action.filePath}:${action.line}`) +
      `  ${guardStr}  ${successStr}`
    )
  }

  // ── Issues ────────────────────────────────────────────────────────────────

  hr(`Issues (${result.issues.length})`)

  if (result.issues.length === 0) {
    console.log(pc.green("  ✓ No issues found — registry is complete"))
  } else {
    for (const issue of result.issues) {
      if (issue.type === "missing-resolver") {
        console.log(
          `  ${pc.red("✗")} ${pc.bold(`${issue.modelName}.${issue.relation}`)} — relation resolver not registered`
        )
      } else if (issue.type === "missing-root") {
        console.log(
          `  ${pc.red("✗")} ${pc.bold(issue.modelName)} — root resolver not registered`
        )
      }
      for (const usage of issue.usedIn) {
        console.log(pc.dim(`    Used in: ${usage.filePath} (${usage.viewName})`))
      }
    }
  }

  console.log()
}
