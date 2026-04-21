# Typedrift CLI

Use this file when the task involves project inspection, registry validation, or scaffolding.

## Config

Create `typedrift.config.ts` at the project root:

```ts
import { defineConfig } from "typedrift/cli"

export default defineConfig({
  include: ["src/**/*.ts", "src/**/*.tsx"],
  registry: "src/lib/registry.ts",
  output: "src/lib",
  aliases: { "@": "src", "~": "src" },
})
```

## Commands

Validate the registry:

```bash
npx typedrift check
```

Watch mode:

```bash
npx typedrift check --watch
```

Inspect the registry state:

```bash
npx typedrift inspect
```

Show what can be generated:

```bash
npx typedrift generate
```

Generate missing resolver stubs:

```bash
npx typedrift generate --missing
```

Generate a model stub:

```bash
npx typedrift generate --model Invoice
```

## What the CLI is for

- `check` validates registry completeness
- `inspect` shows the analyzed registry state
- `generate` previews scaffolding opportunities
- `generate --missing` scaffolds missing resolver stubs
- `generate --model <Name>` scaffolds a new model file

## Typical usage

- Run `typedrift check` in CI or `prebuild`
- Use `inspect` to understand what the analyzer sees
- Use `generate --missing` when a registry exists but relation or model wiring is incomplete

## Do not invent

- Do not assume commands like `typedrift dev`, `typedrift sync`, or `typedrift codegen`
- Do not assume the CLI generates query hooks or client SDKs
