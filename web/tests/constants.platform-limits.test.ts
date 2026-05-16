import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PLATFORM_DAILY_LIMITS } from '@/lib/constants/platforms'

// Guards against the TS constants and the SQL seed drifting apart.
// If either side moves, this fails until the other catches up.

const MIGRATION_PATH = resolve(
  __dirname,
  '../../supabase/migrations/0016_platform_limits_table.sql'
)

function parseSeedRows(sql: string): Record<string, number> {
  const insert = sql.match(
    /INSERT INTO public\.platform_limits[\s\S]*?VALUES([\s\S]*?);/i
  )
  if (!insert) throw new Error('Could not find platform_limits seed INSERT')
  const rows: Record<string, number> = {}
  const rowRegex = /\(\s*'([^']+)'\s*,\s*(\d+)\s*\)/g
  let match: RegExpExecArray | null
  while ((match = rowRegex.exec(insert[1])) !== null) {
    rows[match[1]] = Number(match[2])
  }
  return rows
}

describe('platform_limits seed vs PLATFORM_DAILY_LIMITS', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8')
  const seed = parseSeedRows(sql)

  it('has the same keys on both sides', () => {
    expect(Object.keys(seed).sort()).toEqual(
      Object.keys(PLATFORM_DAILY_LIMITS).sort()
    )
  })

  it('has the same value for every key', () => {
    for (const [platform, limit] of Object.entries(PLATFORM_DAILY_LIMITS)) {
      expect(seed[platform]).toBe(limit)
    }
  })
})
