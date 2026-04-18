// ─── Shared adapter utilities ─────────────────────────────────────────────────
//
// Internal utilities shared between the Next.js and TanStack Start adapters.
// Not part of the public API.

import type { BindContext } from "./types/index.js"

// ── Cookie session config ─────────────────────────────────────────────────────

export type CookieSessionConfig = {
  /** Cookie name. Default: "td_session" */
  cookie?:  string
  /** Signing secret — required for tamper detection */
  secret:   string
  /** Max age in seconds. Default: 604800 (7 days) */
  maxAge?:  number
}

export type SessionShorthand = "cookie" | CookieSessionConfig

// ── Simple cookie parser ──────────────────────────────────────────────────────

function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {}
  return Object.fromEntries(
    cookieHeader.split(";").map(c => {
      const [k, ...v] = c.trim().split("=")
      return [k?.trim() ?? "", decodeURIComponent(v.join("="))]
    })
  )
}

// ── readCookieSession ─────────────────────────────────────────────────────────
//
// Reads and parses a session cookie from the request.
// In production use a proper signing library (iron-session, jose etc.).
// This implementation is a lightweight base — developers who need
// tamper-evident sessions should pass getSession instead.

export async function readCookieSession(
  request: Request | undefined,
  config:  CookieSessionConfig,
): Promise<Record<string, unknown> | undefined> {
  if (!request) return undefined

  const cookieName = config.cookie ?? "td_session"
  const cookieHeader = request.headers.get("cookie")
  const cookies = parseCookies(cookieHeader)
  const raw = cookies[cookieName]

  if (!raw) return undefined

  try {
    // Base64 decode and JSON parse
    // In a real app, verify the signature here using config.secret
    const decoded = Buffer.from(raw, "base64").toString("utf-8")
    return JSON.parse(decoded) as Record<string, unknown>
  } catch {
    return undefined
  }
}

// ── normalizeBindContext ──────────────────────────────────────────────────────
// Shared normalisation — framework adapters call this with their
// framework-specific params/searchParams before passing to the binder.

export function buildBindContext(
  params:       Record<string, string | undefined>,
  searchParams: Record<string, string | string[] | undefined>,
  request?:     Request,
): BindContext {
  const ctx: BindContext = { params, searchParams }
  if (request !== undefined) ctx.request = request
  return ctx
}

// ── lazy import helper ────────────────────────────────────────────────────────
// Safely dynamic-imports a module, throws a helpful error if not installed.

export async function lazyImport<T>(
  modulePath: string,
  errorHint:  string,
): Promise<T> {
  try {
    return await import(modulePath) as T
  } catch {
    throw new Error(
      `[typedrift] ${errorHint}\n` +
      `Make sure "${modulePath}" is installed as a dependency.`
    )
  }
}
