import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join } from "node:path"
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs"
import { defineConfig, loadConfig } from "../cli/config.js"
import { TypedriftAnalyser }        from "../cli/analysis/analyser.js"
import { runCheck }                 from "../cli/commands/check.js"
import { runGenerate }              from "../cli/commands/generate.js"

const FIXTURES = join(import.meta.dirname ?? __dirname, "fixtures")
const COMPLETE  = join(FIXTURES, "complete-project")
const INCOMPLETE = join(FIXTURES, "incomplete-project")

// ── defineConfig ──────────────────────────────────────────────────────────────

describe("defineConfig()", () => {
  it("returns config unchanged — identity function", () => {
    const config = defineConfig({
      include:  ["src/**/*.ts"],
      registry: "src/lib/registry.ts",
      output:   "src/lib",
      aliases:  { "@": "src" },
    })
    expect(config.include).toEqual(["src/**/*.ts"])
    expect(config.registry).toBe("src/lib/registry.ts")
    expect(config.aliases).toEqual({ "@": "src" })
  })

  it("accepts partial config", () => {
    const config = defineConfig({ include: ["src/**/*.ts"] })
    expect(config.include).toEqual(["src/**/*.ts"])
    expect(config.output).toBeUndefined()
  })
})

// ── loadConfig ────────────────────────────────────────────────────────────────

describe("loadConfig()", () => {
  it("returns resolved defaults when no config file exists", async () => {
    const config = await loadConfig(COMPLETE)
    expect(Array.isArray(config.include)).toBe(true)
    expect(config.include.length).toBeGreaterThan(0)
    expect(typeof config.output).toBe("string")
    expect(typeof config.tsconfig).toBe("string")
  })

  it("auto-detects registry file from known locations", async () => {
    const config = await loadConfig(COMPLETE)
    // Should detect src/lib/registry.ts which exists in the fixture
    expect(config.registry).toContain("registry")
  })
})

// ── TypedriftAnalyser — complete project ──────────────────────────────────────

describe("TypedriftAnalyser — complete project", () => {
  async function getAnalyser() {
    const config = await loadConfig(COMPLETE)
    return new TypedriftAnalyser(config, COMPLETE)
  }

  it("extracts Post and User models", async () => {
    const analyser = await getAnalyser()
    const result   = await analyser.analyse()
    const names    = result.models.map(m => m.name)
    expect(names).toContain("Post")
    expect(names).toContain("User")
  })

  it("extracts Post model fields and relations", async () => {
    const analyser = await getAnalyser()
    const result   = await analyser.analyse()
    const post     = result.models.find(m => m.name === "Post")!
    expect(post).toBeDefined()
    expect(post.fields.map(f => f.name)).toContain("title")
    expect(post.relations.map(r => r.name)).toContain("author")
    expect(post.relations.find(r => r.name === "author")?.relatedModel).toBe("User")
  })

  it("extracts views", async () => {
    const analyser = await getAnalyser()
    const result   = await analyser.analyse()
    const names    = result.views.map(v => v.name)
    expect(names).toContain("PostData")
    expect(names).toContain("PostFeed")
  })

  it("identifies PostFeed as a list view", async () => {
    const analyser = await getAnalyser()
    const result   = await analyser.analyse()
    const feed     = result.views.find(v => v.name === "PostFeed")!
    expect(feed.isList).toBe(true)
  })

  it("extracts view selected fields", async () => {
    const analyser = await getAnalyser()
    const result   = await analyser.analyse()
    const postData = result.views.find(v => v.name === "PostData")!
    expect(postData.selectedFields).toContain("title")
    expect(postData.selectedRelations).toContain("author")
  })

  it("extracts registered resolvers", async () => {
    const analyser = await getAnalyser()
    const result   = await analyser.analyse()
    const postReg  = result.resolvers.find(r => r.modelName === "Post")!
    expect(postReg).toBeDefined()
    expect(postReg.hasRoot).toBe(true)
    expect(postReg.relations).toContain("author")
  })

  it("reports zero issues for complete project", async () => {
    const analyser = await getAnalyser()
    const result   = await analyser.analyse()
    expect(result.issues).toHaveLength(0)
  })
})

// ── TypedriftAnalyser — incomplete project ────────────────────────────────────

describe("TypedriftAnalyser — incomplete project", () => {
  async function getAnalyser() {
    const config = await loadConfig(INCOMPLETE)
    return new TypedriftAnalyser(config, INCOMPLETE)
  }

  it("detects missing author resolver", async () => {
    const analyser = await getAnalyser()
    const result   = await analyser.analyse()
    const issue    = result.issues.find(
      i => i.type === "missing-resolver" && i.relation === "author"
    )
    expect(issue).toBeDefined()
    expect(issue!.modelName).toBe("Post")
    expect(issue!.severity).toBe("error")
  })

  it("detects missing tags resolver", async () => {
    const analyser = await getAnalyser()
    const result   = await analyser.analyse()
    const issue    = result.issues.find(
      i => i.type === "missing-resolver" && i.relation === "tags"
    )
    expect(issue).toBeDefined()
    expect(issue!.modelName).toBe("Post")
  })

  it("records which views use the missing resolver", async () => {
    const analyser = await getAnalyser()
    const result   = await analyser.analyse()
    const issue    = result.issues.find(i => i.relation === "author")!
    expect(issue.usedIn.length).toBeGreaterThan(0)
    expect(issue.usedIn[0]!.viewName).toBe("PostDetail")
  })

  it("reports two issues for incomplete project", async () => {
    const analyser = await getAnalyser()
    const result   = await analyser.analyse()
    // author and tags both missing
    expect(result.issues.length).toBeGreaterThanOrEqual(2)
  })
})

// ── runCheck command ──────────────────────────────────────────────────────────

describe("runCheck()", () => {
  it("returns true for complete project", async () => {
    const config = await loadConfig(COMPLETE)
    const ok     = await runCheck({ cwd: COMPLETE, config, silent: true })
    expect(ok).toBe(true)
  })

  it("returns false for incomplete project", async () => {
    const config = await loadConfig(INCOMPLETE)
    const ok     = await runCheck({ cwd: INCOMPLETE, config, silent: true })
    expect(ok).toBe(false)
  })

  it("logs output when not silent", async () => {
    const config = await loadConfig(COMPLETE)
    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: any[]) => logs.push(args.join(" "))

    try {
      await runCheck({ cwd: COMPLETE, config, silent: false })
    } finally {
      console.log = origLog
    }

    expect(logs.some(l => l.includes("complete") || l.includes("registered"))).toBe(true)
  })
})

// ── runGenerate command ───────────────────────────────────────────────────────

describe("runGenerate() --missing", () => {
  const tmpOutput = join(INCOMPLETE, ".tmp-generated")

  beforeEach(() => {
    if (existsSync(tmpOutput)) rmSync(tmpOutput, { recursive: true })
    mkdirSync(tmpOutput, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tmpOutput)) rmSync(tmpOutput, { recursive: true })
  })

  it("generates resolver stub files for missing resolvers", async () => {
    const config = await loadConfig(INCOMPLETE)
    const patchedConfig = { ...config, output: tmpOutput }

    await runGenerate({ cwd: INCOMPLETE, config: patchedConfig, missing: true })

    const registryDir = join(tmpOutput, "registry")
    expect(existsSync(registryDir)).toBe(true)

    const files = existsSync(registryDir)
      ? require("node:fs").readdirSync(registryDir)
      : []
    expect(files.length).toBeGreaterThan(0)
  })

  it("generated file contains batch import and registry.register", async () => {
    const config = await loadConfig(INCOMPLETE)
    const patchedConfig = { ...config, output: tmpOutput }

    await runGenerate({ cwd: INCOMPLETE, config: patchedConfig, missing: true })

    const registryDir = join(tmpOutput, "registry")
    if (!existsSync(registryDir)) return

    const { readdirSync } = await import("node:fs")
    const files = readdirSync(registryDir)
    expect(files.length).toBeGreaterThan(0)

    const content = readFileSync(join(registryDir, files[0]!), "utf-8")
    expect(content).toContain("batch")
    expect(content).toContain("registry.register")
    expect(content).toContain("TODO")
  })

  it("does not overwrite existing files", async () => {
    const config = await loadConfig(INCOMPLETE)
    const patchedConfig = { ...config, output: tmpOutput }

    // First generation
    await runGenerate({ cwd: INCOMPLETE, config: patchedConfig, missing: true })

    const registryDir = join(tmpOutput, "registry")
    if (!existsSync(registryDir)) return

    const { readdirSync, writeFileSync } = await import("node:fs")
    const files = readdirSync(registryDir)
    if (files.length === 0) return

    const filePath = join(registryDir, files[0]!)
    writeFileSync(filePath, "SENTINEL CONTENT", "utf-8")

    // Second generation — should not overwrite
    await runGenerate({ cwd: INCOMPLETE, config: patchedConfig, missing: true })

    const content = readFileSync(filePath, "utf-8")
    expect(content).toBe("SENTINEL CONTENT")
  })
})

// ── generateModelStub ─────────────────────────────────────────────────────────

describe("runGenerate() --model", () => {
  const tmpOutput = join(INCOMPLETE, ".tmp-model")

  beforeEach(() => {
    if (existsSync(tmpOutput)) rmSync(tmpOutput, { recursive: true })
    mkdirSync(tmpOutput, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tmpOutput)) rmSync(tmpOutput, { recursive: true })
  })

  it("generates model stub file", async () => {
    const config = await loadConfig(INCOMPLETE)
    const patchedConfig = { ...config, output: tmpOutput }

    await runGenerate({ cwd: INCOMPLETE, config: patchedConfig, model: "Invoice" })

    const modelPath = join(tmpOutput, "models/invoice.ts")
    expect(existsSync(modelPath)).toBe(true)
    const content = readFileSync(modelPath, "utf-8")
    expect(content).toContain("Invoice")
    expect(content).toContain("model(")
    expect(content).toContain("field.id()")
  })
})
