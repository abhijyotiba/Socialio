import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SUPPORTED_PLATFORMS } from '@/lib/constants/platforms'

// Guards against the TS SUPPORTED_PLATFORMS constant and the `platforms`
// registry seed (migration 0023) drifting apart. If either side moves, this
// fails until the other catches up.

const MIGRATION_PATH = resolve(
  __dirname,
  '../../supabase/migrations/0023_platforms_registry.sql'
)

function parseSeedSlugs(sql: string): string[] {
  const insert = sql.match(
    /INSERT INTO public\.platforms[\s\S]*?VALUES([\s\S]*?);/i
  )
  if (!insert) throw new Error('Could not find platforms seed INSERT')
  const slugs: string[] = []
  const rowRegex = /\(\s*'([^']+)'\s*,\s*'[^']+'\s*\)/g
  let match: RegExpExecArray | null
  while ((match = rowRegex.exec(insert[1])) !== null) {
    slugs.push(match[1])
  }
  return slugs
}

describe('platforms seed vs SUPPORTED_PLATFORMS', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8')
  const seed = parseSeedSlugs(sql)

  it('SUPPORTED_PLATFORMS matches ("linkedin","x")', () => {
    expect([...SUPPORTED_PLATFORMS]).toEqual(['linkedin', 'x'])
  })

  it('has the same slugs on both sides', () => {
    expect(seed.sort()).toEqual([...SUPPORTED_PLATFORMS].sort())
  })
})
