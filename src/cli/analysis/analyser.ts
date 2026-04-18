// ─── CLI static analysis ──────────────────────────────────────────────────────
//
// Uses ts-morph to analyse the project AST without running the code.
// Extracts: models, views, registered resolvers, actions.

import { Project, SyntaxKind, Node, type SourceFile } from "ts-morph"
import { join, relative, resolve } from "node:path"
import { existsSync } from "node:fs"
import type { ResolvedConfig } from "../config.js"

// ── Result types ──────────────────────────────────────────────────────────────

export type FieldKind = "scalar" | "relation"

export type FieldInfo = {
  name:          string
  kind:          FieldKind
  relatedModel?: string | undefined
  cardinality?:  "one" | "many" | undefined
  nullable?:     boolean | undefined
}

export type ModelInfo = {
  name:     string
  filePath: string
  fields:   FieldInfo[]
  relations: FieldInfo[]
}

export type ViewInfo = {
  name:        string
  filePath:    string
  line:        number
  modelName:   string
  selectedFields: string[]
  selectedRelations: string[]
  isList:      boolean
  hasCache:    boolean
}

export type ResolverInfo = {
  modelName:    string
  hasRoot:      boolean
  relations:    string[]   // relation keys that have resolvers
  filePath:     string
  line:         number
}

export type ActionInfo = {
  name:     string
  filePath: string
  line:     number
  hasGuard: boolean
  hasOnSuccess: boolean
}

export type AnalysisResult = {
  models:    ModelInfo[]
  views:     ViewInfo[]
  resolvers: ResolverInfo[]
  actions:   ActionInfo[]
  issues:    AnalysisIssue[]
}

export type AnalysisIssue = {
  type:      "missing-resolver" | "missing-root" | "unused-model"
  modelName: string
  relation?: string
  usedIn:    { filePath: string; viewName: string }[]
  severity:  "error" | "warning"
}

// ── Analyser ──────────────────────────────────────────────────────────────────

export class TypedriftAnalyser {
  private project: Project
  private config:  ResolvedConfig
  private cwd:     string

  constructor(config: ResolvedConfig, cwd: string) {
    this.config = config
    this.cwd    = cwd

    const projectOpts: any = {
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs:         true,
        skipLibCheck:    true,
        noEmit:          true,
        moduleResolution: 100,
      },
    }
    if (existsSync(config.tsconfig)) {
      projectOpts.tsConfigFilePath = config.tsconfig
    }
    this.project = new Project(projectOpts)

    // Add source files — use tsconfig if available, fallback to include globs
    const tsconfigPath = existsSync(config.tsconfig)
      ? config.tsconfig
      : join(cwd, "tsconfig.json")

    if (existsSync(tsconfigPath)) {
      try {
        this.project.addSourceFilesFromTsConfig(tsconfigPath)
      } catch {
        // tsconfig exists but has issues — fall back to glob
        this.project.addSourceFilesAtPaths(config.include.map(p => join(cwd, p)))
      }
    } else {
      this.project.addSourceFilesAtPaths(config.include.map(p => join(cwd, p)))
    }
  }

  // ── Main analysis entry point ───────────────────────────────────────────────

  async analyse(): Promise<AnalysisResult> {
    const sourceFiles = this.project.getSourceFiles()

    const models    = this.extractModels(sourceFiles)
    const views     = this.extractViews(sourceFiles)
    const resolvers = this.extractResolvers(sourceFiles)
    const actions   = this.extractActions(sourceFiles)
    const issues    = this.computeIssues(models, views, resolvers)

    return { models, views, resolvers, actions, issues }
  }

  // ── Extract models ──────────────────────────────────────────────────────────

  private extractModels(sourceFiles: SourceFile[]): ModelInfo[] {
    const models: ModelInfo[] = []

    for (const file of sourceFiles) {
      // Find: model("ModelName", { ... })
      const calls = file.getDescendantsOfKind(SyntaxKind.CallExpression)

      for (const call of calls) {
        const expr = call.getExpression()
        if (!Node.isIdentifier(expr) || expr.getText() !== "model") continue

        const args = call.getArguments()
        if (args.length < 2) continue

        const nameArg = args[0]
        if (!Node.isStringLiteral(nameArg)) continue
        const modelName = nameArg.getLiteralText()

        const fieldsArg = args[1]
        if (!Node.isObjectLiteralExpression(fieldsArg)) continue

        const fields:    FieldInfo[] = []
        const relations: FieldInfo[] = []

        for (const prop of fieldsArg.getProperties()) {
          if (!Node.isPropertyAssignment(prop)) continue
          const fieldName = prop.getName()
          const init      = prop.getInitializer()
          if (!init) continue

          const text = init.getText()

          if (text.includes("ref(")) {
            // relation field
            const refMatch = text.match(/ref\((\w+)\)/)
            const related  = refMatch?.[1]
            const isList   = text.includes(".list()")
            const nullable = text.includes(".nullable()")
            relations.push({
              name:         fieldName,
              kind:         "relation",
              relatedModel: related,
              cardinality:  isList ? "many" : "one",
              nullable,
            })
          } else if (text.includes("field.")) {
            fields.push({
              name:     fieldName,
              kind:     "scalar",
              nullable: text.includes(".nullable()"),
            })
          }
        }

        models.push({
          name:      modelName,
          filePath:  this.rel(file.getFilePath()),
          fields,
          relations,
        })
      }
    }

    return models
  }

  // ── Extract views ───────────────────────────────────────────────────────────

  private extractViews(sourceFiles: SourceFile[]): ViewInfo[] {
    const views: ViewInfo[] = []

    for (const file of sourceFiles) {
      // Find variable declarations like: const PostData = Post.view({ ... })
      const varDecls = file.getDescendantsOfKind(SyntaxKind.VariableDeclaration)

      for (const decl of varDecls) {
        const init = decl.getInitializer()
        if (!init) continue

        const text = init.getText()
        if (!text.includes(".view(")) continue

        // Extract model name from: ModelName.view(...)
        const modelMatch = text.match(/^(\w+)\.view\(/)
        if (!modelMatch) continue
        const modelName = modelMatch[1]!

        const viewName = decl.getName()
        const line     = file.getLineAndColumnAtPos(decl.getStart()).line

        // Extract selected fields (heuristic — looks for: fieldName: true)
        const selectedFields    = [...text.matchAll(/(\w+):\s*true/g)].map(m => m[1]!)
        // Extract selected relations (heuristic — looks for: relationName: {)
        const selectedRelations: string[] = []
        const relMatches = text.matchAll(/(\w+):\s*\{/g)
        for (const m of relMatches) {
          if (m[1] !== "cache" && m[1] !== "filter" && m[1] !== "sort" && m[1] !== "paginate") {
            selectedRelations.push(m[1]!)
          }
        }

        views.push({
          name:               viewName,
          filePath:           this.rel(file.getFilePath()),
          line,
          modelName:          modelName ?? "",
          selectedFields,
          selectedRelations,
          isList:             text.includes(".list()"),
          hasCache:           text.includes("cache:"),
        })
      }
    }

    return views
  }

  // ── Extract resolvers ───────────────────────────────────────────────────────

  private extractResolvers(sourceFiles: SourceFile[]): ResolverInfo[] {
    const resolvers: ResolverInfo[] = []

    for (const file of sourceFiles) {
      // Find: registry.register(ModelName, { root: ..., relations: { ... } })
      const calls = file.getDescendantsOfKind(SyntaxKind.CallExpression)

      for (const call of calls) {
        const expr = call.getExpression()
        if (!Node.isPropertyAccessExpression(expr)) continue
        if (expr.getName() !== "register") continue

        const args = call.getArguments()
        if (args.length < 2) continue

        const modelArg = args[0]
        const modelName = Node.isIdentifier(modelArg) ? modelArg.getText() : null
        if (!modelName) continue

        const registrationArg = args[1]
        if (!Node.isObjectLiteralExpression(registrationArg)) continue

        let hasRoot    = false
        const relations: string[] = []

        for (const prop of registrationArg.getProperties()) {
          if (!Node.isPropertyAssignment(prop)) continue
          const key = prop.getName()

          if (key === "root") {
            hasRoot = true
          } else if (key === "relations") {
            const relObj = prop.getInitializer()
            if (!Node.isObjectLiteralExpression(relObj)) continue
            for (const relProp of relObj.getProperties()) {
              if (Node.isPropertyAssignment(relProp) || Node.isMethodDeclaration(relProp)) {
                relations.push(relProp.getName())
              }
            }
          }
        }

        const line = file.getLineAndColumnAtPos(call.getStart()).line

        // Check if this model was already registered (merge relation info)
        const existing = resolvers.find(r => r.modelName === modelName)
        if (existing) {
          if (hasRoot) existing.hasRoot = true
          existing.relations.push(...relations)
        } else {
          resolvers.push({
            modelName,
            hasRoot,
            relations,
            filePath: this.rel(file.getFilePath()),
            line,
          })
        }
      }
    }

    return resolvers
  }

  // ── Extract actions ─────────────────────────────────────────────────────────

  private extractActions(sourceFiles: SourceFile[]): ActionInfo[] {
    const actions: ActionInfo[] = []

    for (const file of sourceFiles) {
      const varDecls = file.getDescendantsOfKind(SyntaxKind.VariableDeclaration)

      for (const decl of varDecls) {
        const init = decl.getInitializer()
        if (!init) continue

        const text = init.getText()
        if (!text.startsWith("action(")) continue

        const name = decl.getName()
        const line = file.getLineAndColumnAtPos(decl.getStart()).line

        actions.push({
          name,
          filePath:     this.rel(file.getFilePath()),
          line,
          hasGuard:     text.includes("guard:"),
          hasOnSuccess: text.includes("onSuccess:"),
        })
      }
    }

    return actions
  }

  // ── Compute issues ──────────────────────────────────────────────────────────

  private computeIssues(
    models:    ModelInfo[],
    views:     ViewInfo[],
    resolvers: ResolverInfo[],
  ): AnalysisIssue[] {
    const issues: AnalysisIssue[] = []

    for (const view of views) {
      const resolver = resolvers.find(r => r.modelName === view.modelName)

      // Missing root resolver for model used in view
      if (!resolver || !resolver.hasRoot) {
        issues.push({
          type:      "missing-root",
          modelName: view.modelName,
          usedIn:    [{ filePath: view.filePath, viewName: view.name }],
          severity:  "error",
        })
        continue
      }

      // Missing relation resolvers for relations selected in view
      for (const rel of view.selectedRelations) {
        if (!resolver.relations.includes(rel)) {
          const existing = issues.find(
            i => i.type === "missing-resolver" &&
                 i.modelName === view.modelName &&
                 i.relation === rel
          )
          if (existing) {
            existing.usedIn.push({ filePath: view.filePath, viewName: view.name })
          } else {
            issues.push({
              type:      "missing-resolver",
              modelName: view.modelName,
              relation:  rel,
              usedIn:    [{ filePath: view.filePath, viewName: view.name }],
              severity:  "error",
            })
          }
        }
      }
    }

    return issues
  }

  private rel(filePath: string): string {
    return relative(this.cwd, filePath)
  }
}
