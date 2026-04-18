// ─── typedrift/cli — config ───────────────────────────────────────────────────

import { existsSync } from "node:fs"
import { resolve, join } from "node:path"
import { pathToFileURL } from "node:url"

// ── Config type ───────────────────────────────────────────────────────────────

export type TypedriftConfig = {
  /** Glob patterns to scan for models, views, actions. Default: ["src/**\/*.ts", "src/**\/*.tsx"] */
  include?: string[]
  /** Glob patterns to exclude. Default: ["**\/*.test.ts", "**\/*.spec.ts", "node_modules"] */
  exclude?: string[]
  /** Path to your registry file. Default: auto-detected */
  registry?: string
  /** Output directory for generated files. Default: src/lib */
  output?: string
  /** tsconfig.json path. Default: tsconfig.json */
  tsconfig?: string
  /** Path aliases matching your tsconfig. Default: auto-read from tsconfig */
  aliases?: Record<string, string>
}

export type ResolvedConfig = Required<TypedriftConfig>

// ── defineConfig ──────────────────────────────────────────────────────────────

/**
 * Define your Typedrift CLI configuration.
 * Place this in typedrift.config.ts at your project root.
 *
 * @example
 * // typedrift.config.ts
 * import { defineConfig } from "typedrift/cli"
 *
 * export default defineConfig({
 *   include:  ["src/**\/*.ts", "src/**\/*.tsx"],
 *   registry: "src/lib/registry.ts",
 *   output:   "src/lib",
 *   aliases:  { "@": "src", "~": "src" },
 * })
 */
export function defineConfig(config: TypedriftConfig): TypedriftConfig {
  return config
}

// ── Config loader ─────────────────────────────────────────────────────────────

const CONFIG_FILES = [
  "typedrift.config.ts",
  "typedrift.config.js",
  "typedrift.config.mjs",
]

export async function loadConfig(cwd: string): Promise<ResolvedConfig> {
  let userConfig: TypedriftConfig = {}

  // Try to find and load a config file
  for (const filename of CONFIG_FILES) {
    const configPath = join(cwd, filename)
    if (existsSync(configPath)) {
      try {
        // Dynamic import — works for both .ts (with tsx/ts-node) and .js/.mjs
        const mod = await import(pathToFileURL(configPath).href)
        userConfig = mod.default ?? mod
        break
      } catch {
        // Config file exists but can't be loaded — continue with defaults
      }
    }
  }

  // Auto-detect tsconfig aliases
  let aliases: Record<string, string> = userConfig.aliases ?? {}
  if (!userConfig.aliases) {
    aliases = await readTsConfigAliases(cwd, userConfig.tsconfig)
  }

  return {
    include:  userConfig.include  ?? ["src/**/*.ts", "src/**/*.tsx"],
    exclude:  userConfig.exclude  ?? ["**/*.test.ts", "**/*.spec.ts", "**/*.d.ts", "node_modules/**"],
    registry: userConfig.registry ?? await detectRegistry(cwd),
    output:   userConfig.output   ?? join(cwd, "src/lib"),
    tsconfig: userConfig.tsconfig ?? join(cwd, "tsconfig.json"),
    aliases,
  }
}

// ── Auto-detect registry file ─────────────────────────────────────────────────

async function detectRegistry(cwd: string): Promise<string> {
  const candidates = [
    "src/lib/registry.ts",
    "src/registry.ts",
    "lib/registry.ts",
    "src/lib/registry/index.ts",
  ]
  for (const candidate of candidates) {
    if (existsSync(join(cwd, candidate))) {
      return join(cwd, candidate)
    }
  }
  return join(cwd, "src/lib/registry.ts")
}

// ── Read tsconfig path aliases ────────────────────────────────────────────────

async function readTsConfigAliases(
  cwd:         string,
  tsconfigPath?: string,
): Promise<Record<string, string>> {
  const path = tsconfigPath ?? join(cwd, "tsconfig.json")
  if (!existsSync(path)) return {}

  try {
    const { readFileSync } = await import("node:fs")
    const raw  = readFileSync(path, "utf-8")
    // Strip comments (tsconfig allows them)
    const json = raw.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
    const config = JSON.parse(json)
    const paths = config?.compilerOptions?.paths ?? {}
    const aliases: Record<string, string> = {}
    for (const [alias, targets] of Object.entries(paths)) {
      const clean = alias.replace(/\/\*$/, "")
      const target = (targets as string[])[0]?.replace(/\/\*$/, "") ?? ""
      aliases[clean] = join(cwd, target)
    }
    return aliases
  } catch {
    return {}
  }
}
