// ─── typedrift CLI — bin entry point ─────────────────────────────────────────
//
// Usage:
//   npx typedrift check
//   npx typedrift check --watch
//   npx typedrift inspect
//   npx typedrift generate
//   npx typedrift generate --missing
//   npx typedrift generate --model <Name>

import pc from "picocolors"
import { loadConfig } from "./config.js"
import { runCheck, runWatch } from "./commands/check.js"
import { runInspect }         from "./commands/inspect.js"
import { runGenerate }        from "./commands/generate.js"

// ── Arg parsing ───────────────────────────────────────────────────────────────

type ParsedArgs = {
  command:  string
  watch:    boolean
  missing:  boolean
  model:    string | undefined
  help:     boolean
  cwd:      string
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2)   // strip "node" + script path

  return {
    command: args[0] ?? "help",
    watch:   args.includes("--watch")   || args.includes("-w"),
    missing: args.includes("--missing") || args.includes("-m"),
    model:   args.includes("--model")
               ? args[args.indexOf("--model") + 1]
               : undefined,
    help:    args.includes("--help") || args.includes("-h"),
    cwd:     process.cwd(),
  }
}

// ── Help ──────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
${pc.bold("typedrift")} — Registry validation and scaffolding

${pc.bold("Usage:")}
  npx typedrift <command> [options]

${pc.bold("Commands:")}
  ${pc.cyan("check")}                   Validate registry completeness
  ${pc.cyan("check --watch")}           Watch mode — re-check on file change
  ${pc.cyan("inspect")}                 Show full registry state
  ${pc.cyan("generate")}                Show what can be generated
  ${pc.cyan("generate --missing")}      Scaffold missing resolver stubs
  ${pc.cyan("generate --model")} <Name> Scaffold a new model file

${pc.bold("Options:")}
  ${pc.cyan("--watch,   -w")}           Watch mode (check command only)
  ${pc.cyan("--missing, -m")}           Generate missing resolvers
  ${pc.cyan("--model")}   <Name>        Generate a model stub
  ${pc.cyan("--help,    -h")}           Show this help message

${pc.bold("Config:")}
  Create ${pc.cyan("typedrift.config.ts")} at your project root:

  import { defineConfig } from "typedrift/cli"

  export default defineConfig({
    include:  ["src/**/*.ts", "src/**/*.tsx"],
    registry: "src/lib/registry.ts",
    output:   "src/lib",
    aliases:  { "@": "src", "~": "src" },
  })

${pc.bold("CI integration:")}
  Add to package.json scripts:
    "prebuild": "typedrift check"

  Add to GitHub Actions:
    - run: npx typedrift check
`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv)

  if (args.help || args.command === "help") {
    printHelp()
    process.exit(0)
  }

  // Load config
  let config
  try {
    config = await loadConfig(args.cwd)
  } catch (err: any) {
    console.error(pc.red("Error loading config:"), err.message)
    process.exit(1)
  }

  // Route to command
  try {
    switch (args.command) {
      case "check": {
        if (args.watch) {
          await runWatch({ cwd: args.cwd, config })
          // watch runs indefinitely — don't exit
        } else {
          const ok = await runCheck({ cwd: args.cwd, config })
          process.exit(ok ? 0 : 1)
        }
        break
      }

      case "inspect": {
        await runInspect({ cwd: args.cwd, config })
        process.exit(0)
        break
      }

      case "generate": {
        await runGenerate({
          cwd:     args.cwd,
          config,
          missing: args.missing,
          model:   args.model,
        })
        process.exit(0)
        break
      }

      default: {
        console.error(pc.red(`Unknown command: ${args.command}`))
        console.log(pc.dim(`Run ${pc.cyan("npx typedrift --help")} for usage`))
        process.exit(1)
      }
    }
  } catch (err: any) {
    console.error(pc.red("\nError:"), err.message)
    if (process.env["DEBUG"]) console.error(err.stack)
    process.exit(1)
  }
}

main()
