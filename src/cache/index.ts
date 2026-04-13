// ─── Cache — v0.5.0 ───────────────────────────────────────────────────────────
//
// Pluggable read cache for views.
// Cache store interface: get / set / invalidate (async throughout).
//
// Built-in stores:
//   memoryCacheStore()   — in-process, development/testing
//   redisCacheStore()    — Redis, production
//
// Cache key = modelName + serialised input + selection hash
// Tags = per-view function receiving input → string[]

import type { SelectionTree } from "../types/index.js"

// ── Store interface ───────────────────────────────────────────────────────────

export type CacheStore = {
  get(key: string): Promise<unknown | null>
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>
  /** Purge all entries tagged with any of the given tags */
  invalidate(tags: string[]): Promise<void>
}

// ── Per-view cache config ─────────────────────────────────────────────────────

export type ViewCacheConfig = {
  ttl:   number                                    // seconds
  tags?: (input: Record<string, unknown>) => string[]
}

// ── Global cache config on createBinder ──────────────────────────────────────

export type CacheConfig = {
  store:       CacheStore
  defaultTtl:  number   // seconds — used when view cache config has no TTL override
}

// ── Cache result type ─────────────────────────────────────────────────────────

export type CacheResult =
  | { hit: true;  value: unknown }
  | { hit: false }

// ── Cache key builder ─────────────────────────────────────────────────────────

export function buildCacheKey(
  modelName:  string,
  input:      Record<string, unknown>,
  tree:       SelectionTree,
): string {
  const sortedInput = Object.fromEntries(
    Object.entries(input).sort(([a], [b]) => a.localeCompare(b))
  )
  const selectionHash = hashSelectionTree(tree)
  return `td:${modelName}:${JSON.stringify(sortedInput)}:${selectionHash}`
}

function hashSelectionTree(tree: SelectionTree): string {
  const scalars   = [...tree.scalars].sort().join(",")
  const relations = [...tree.relations.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}(${hashSelectionTree(v)})`)
    .join(",")
  return `{${scalars}|${relations}}`
}

// ── memoryCacheStore — in-process, dev/testing ────────────────────────────────

type MemoryEntry = {
  value:     unknown
  expiresAt: number
  tags:      string[]
}

/**
 * In-process memory cache. Suitable for development and testing.
 * Not suitable for production multi-process deployments.
 *
 * @example
 * cache: { store: memoryCacheStore(), defaultTtl: 60 }
 */
export function memoryCacheStore(): CacheStore {
  const store  = new Map<string, MemoryEntry>()
  const tagMap = new Map<string, Set<string>>()  // tag → Set<cacheKey>

  function isExpired(entry: MemoryEntry): boolean {
    return Date.now() > entry.expiresAt
  }

  function cleanup() {
    for (const [key, entry] of store) {
      if (isExpired(entry)) store.delete(key)
    }
  }

  return {
    async get(key) {
      const entry = store.get(key)
      if (!entry || isExpired(entry)) {
        store.delete(key)
        return null
      }
      return entry.value
    },

    async set(key, value, ttlSeconds) {
      cleanup()
      const entry: MemoryEntry = {
        value,
        expiresAt: Date.now() + ttlSeconds * 1000,
        tags:      [],
      }
      store.set(key, entry)
    },

    async invalidate(tags) {
      const keysToDelete = new Set<string>()
      for (const tag of tags) {
        const keys = tagMap.get(tag)
        if (keys) {
          for (const key of keys) keysToDelete.add(key)
        }
      }
      for (const key of keysToDelete) store.delete(key)
    },
  }
}

// ── Tag-aware set helper ──────────────────────────────────────────────────────
// Used by the executor to register tags when writing to cache

export async function cacheSetWithTags(
  store:      CacheStore,
  key:        string,
  value:      unknown,
  ttl:        number,
  tags:       string[],
): Promise<void> {
  await store.set(key, value, ttl)
  // For memory store: store tag→key mapping internally
  // For Redis store: use SADD tag-set key
  // We expose this as a separate helper so stores can optimise it
  if ("_setTags" in store && typeof (store as any)._setTags === "function") {
    await (store as any)._setTags(key, tags)
  }
}

// ── redisCacheStore ────────────────────────────────────────────────────────────

export type RedisLike = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, options?: { ex?: number }): Promise<unknown>
  del(...keys: string[]): Promise<unknown>
  smembers(key: string): Promise<string[]>
  sadd(key: string, ...members: string[]): Promise<unknown>
  expire(key: string, seconds: number): Promise<unknown>
}

/**
 * Redis-backed cache store with tag-based invalidation.
 * Compatible with ioredis, @upstash/redis, redis (node-redis).
 *
 * Tag invalidation uses Redis sets:
 *   tag:{tagName} → Set of cache keys with that tag
 *
 * @example
 * import { Redis } from "@upstash/redis"
 * const redis = new Redis({ url: "...", token: "..." })
 * cache: { store: redisCacheStore(redis), defaultTtl: 60 }
 */
export function redisCacheStore(redis: RedisLike): CacheStore & { _setTags: (key: string, tags: string[]) => Promise<void> } {
  return {
    async get(key) {
      const raw = await redis.get(key)
      if (raw === null) return null
      try {
        return JSON.parse(raw)
      } catch {
        return null
      }
    },

    async set(key, value, ttlSeconds) {
      await redis.set(key, JSON.stringify(value), { ex: ttlSeconds })
    },

    async invalidate(tags) {
      const keysToDelete: string[] = []
      for (const tag of tags) {
        const keys = await redis.smembers(`td:tag:${tag}`)
        keysToDelete.push(...keys)
        // Clean up the tag set itself
        if (keys.length > 0) await redis.del(`td:tag:${tag}`)
      }
      if (keysToDelete.length > 0) {
        await redis.del(...keysToDelete)
      }
    },

    async _setTags(key, tags) {
      for (const tag of tags) {
        await redis.sadd(`td:tag:${tag}`, key)
        // Tag sets expire after 24h to prevent unbounded growth
        await redis.expire(`td:tag:${tag}`, 86400)
      }
    },
  }
}
