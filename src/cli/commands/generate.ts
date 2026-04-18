// ─── generate command ─────────────────────────────────────────────────────────

import pc from "picocolors"
import { writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import type { ResolvedConfig } from "../config.js"
import { TypedriftAnalyser } from "../analysis/analyser.js"
import type { AnalysisIssue, ModelInfo } from "../analysis/analyser.js"

export type GenerateOptions = {
  cwd:      string
  config:   ResolvedConfig
  missing?: boolean | undefined
  model?:   string  | undefined
}

// ── Generate missing resolvers ────────────────────────────────────────────────

export async function runGenerate(opts: GenerateOptions): Promise<void> {
  const { cwd, config } = opts

  if (opts.missing) {
    await generateMissingResolvers(opts)
    return
  }

  if (opts.model) {
    await generateModelStub(opts.model, opts)
    return
  }

  // Default — show what can be generated
  const analyser = new TypedriftAnalyser(config, cwd)
  const result   = await analyser.analyse()

  console.log(pc.bold("\nTypedrift generate"))
  console.log()

  if (result.issues.length > 0) {
    console.log(`Found ${pc.red(result.issues.length + " issue(s)")}:`)
    for (const issue of result.issues) {
      if (issue.type === "missing-resolver") {
        console.log(`  ${pc.red("✗")} ${issue.modelName}.${issue.relation} — resolver missing`)
      } else if (issue.type === "missing-root") {
        console.log(`  ${pc.red("✗")} ${issue.modelName} — root resolver missing`)
      }
    }
    console.log()
    console.log(pc.dim("Run: ") + pc.cyan("npx typedrift generate --missing") + pc.dim(" to scaffold these"))
  } else {
    console.log(pc.green("✓") + "  Registry is complete — nothing to generate")
  }

  console.log()
  console.log("Other generators:")
  console.log(pc.dim("  npx typedrift generate --model <Name>  ") + "Scaffold a new model")
  console.log()
}

// ── Generate missing resolvers ────────────────────────────────────────────────

async function generateMissingResolvers(opts: GenerateOptions): Promise<void> {
  const { cwd, config } = opts

  const analyser = new TypedriftAnalyser(config, cwd)
  const result   = await analyser.analyse()

  if (result.issues.length === 0) {
    console.log(pc.green("\n✓") + "  Registry is complete — nothing to generate")
    return
  }

  console.log(pc.bold("\nGenerating missing resolvers...\n"))

  // Group issues by model
  const byModel = new Map<string, AnalysisIssue[]>()
  for (const issue of result.issues) {
    if (!byModel.has(issue.modelName)) byModel.set(issue.modelName, [])
    byModel.get(issue.modelName)!.push(issue)
  }

  for (const [modelName, issues] of byModel) {
    const model = result.models.find(m => m.name === modelName)
    const code  = generateResolverStub(modelName, issues, model)

    const outputPath = join(
      config.output,
      `registry/${modelName.toLowerCase()}.resolver.ts`
    )

    writeFileSafe(outputPath, code)
    console.log(pc.green("✓") + `  Generated: ${outputPath}`)
    console.log()
    console.log(pc.dim("  ┌" + "─".repeat(50)))
    code.split("\n").forEach(line => console.log(pc.dim("  │ ") + line))
    console.log(pc.dim("  └" + "─".repeat(50)))
    console.log()
  }

  console.log(pc.dim("Merge these into your registry or import as standalone files."))
  console.log(pc.dim("Replace all TODO comments with your actual DB calls."))
}

function generateResolverStub(
  modelName: string,
  issues:    AnalysisIssue[],
  model?:    ModelInfo,
): string {
  const missingRoot      = issues.some(i => i.type === "missing-root")
  const missingRelations = issues.filter(i => i.type === "missing-resolver")

  const lines: string[] = [
    `import { batch } from "typedrift"`,
    `import { registry } from "../registry"`,
    `import { ${modelName} } from "../models"`,
    ``,
    `registry.register(${modelName}, {`,
  ]

  if (missingRoot) {
    lines.push(
      `  root: async ({ id }, ctx) => {`,
      `    // TODO: implement`,
      `    return ctx.services.db.${modelName.toLowerCase()}.findUnique({ where: { id } })`,
      `  },`,
    )
  }

  if (missingRelations.length > 0) {
    lines.push(`  relations: {`)

    for (const issue of missingRelations) {
      const rel         = issue.relation!
      const relModel    = model?.relations.find(r => r.name === rel)
      const isList      = relModel?.cardinality === "many"
      const relatedName = relModel?.relatedModel ?? "RelatedModel"
      const fkField     = isList ? `${modelName.toLowerCase()}Id` : `${rel}Id`

      if (isList) {
        lines.push(
          `    ${rel}: batch.many("${fkField}", async (ids, ctx) => {`,
          `      // TODO: implement — fetch ${rel} for parent ids`,
          `      return ctx.services.db.${rel}.findMany({`,
          `        where: { ${fkField}: { in: ids } },`,
          `      })`,
          `    }),`,
        )
      } else {
        lines.push(
          `    ${rel}: batch.one("${fkField}", async (ids, ctx) => {`,
          `      // TODO: implement — fetch ${relatedName} by ids`,
          `      return ctx.services.db.${rel}.findMany({`,
          `        where: { id: { in: ids } },`,
          `      })`,
          `    }),`,
        )
      }
    }

    lines.push(`  },`)
  }

  lines.push(`})`)
  return lines.join("\n")
}

// ── Generate model stub ───────────────────────────────────────────────────────

async function generateModelStub(modelName: string, opts: GenerateOptions): Promise<void> {
  const { config } = opts

  const code = [
    `import { model, field } from "typedrift"`,
    ``,
    `export const ${modelName} = model("${modelName}", {`,
    `  id:        field.id(),`,
    `  // TODO: add your fields`,
    `  createdAt: field.date(),`,
    `  updatedAt: field.date(),`,
    `  // TODO: add relations`,
    `  // author: ref(User),`,
    `})`,
  ].join("\n")

  const outputPath = join(
    config.output,
    `models/${modelName.toLowerCase()}.ts`
  )

  writeFileSafe(outputPath, code)

  console.log(pc.bold(`\nGenerated: ${outputPath}\n`))
  console.log(code)
  console.log()
}

// ── File writer ───────────────────────────────────────────────────────────────

function writeFileSafe(filePath: string, content: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  // Never overwrite existing files
  if (existsSync(filePath)) {
    console.log(pc.yellow("~") + `  Skipped (already exists): ${filePath}`)
    return
  }
  writeFileSync(filePath, content + "\n", "utf-8")
}
