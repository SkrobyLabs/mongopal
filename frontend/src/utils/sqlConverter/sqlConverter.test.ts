import { describe, it, expect } from 'vitest'
import { convertSQL } from './index'
import type { ConverterDeps } from './types'

const deps: ConverterDeps = { getSchema: () => null }

describe('convertSQL — find', () => {
  it('produces EJSON strings that round-trip through JSON.parse', () => {
    const r = convertSQL("SELECT name FROM users WHERE _id = ObjectId('507f1f77bcf86cd799439011') ORDER BY name LIMIT 10", deps)
    expect(r.ok).toBe(true)
    if (!r.ok || r.kind !== 'find') throw new Error('expected find')
    expect(JSON.parse(r.filter)).toEqual({ _id: { $oid: '507f1f77bcf86cd799439011' } })
    expect(JSON.parse(r.projection)).toEqual({ name: 1 })
    expect(JSON.parse(r.sort)).toEqual({ name: 1 })
    expect(r.limit).toBe(10)
  })

  it('preview renders mongosh constructors from the same object', () => {
    const r = convertSQL("SELECT * FROM users WHERE age > 25", deps)
    if (!r.ok || r.kind !== 'find') throw new Error('expected find')
    expect(r.preview).toContain('db.getCollection("users").find(')
    expect(r.preview).toContain('$gt')
  })

  it('preview ≡ execution — ObjectId rendered as ObjectId() in preview, $oid in filter', () => {
    const r = convertSQL("SELECT * FROM c WHERE _id = ObjectId('507f1f77bcf86cd799439011')", deps)
    if (!r.ok || r.kind !== 'find') throw new Error('expected find')
    expect(r.filter).toContain('$oid')
    expect(r.preview).toContain('ObjectId("507f1f77bcf86cd799439011")')
  })

  it('empty query returns an error', () => {
    const r = convertSQL('   ', deps)
    expect(r.ok).toBe(false)
  })
})

describe('convertSQL — aggregate', () => {
  it('GROUP BY produces a pipeline string and aggregate preview', () => {
    const r = convertSQL('SELECT status, COUNT(*) FROM orders GROUP BY status', deps)
    expect(r.ok).toBe(true)
    if (!r.ok || r.kind !== 'aggregate') throw new Error('expected aggregate')
    const pipeline = JSON.parse(r.pipeline)
    expect(Array.isArray(pipeline)).toBe(true)
    expect(r.preview).toContain('.aggregate(')
  })
})

describe('convertSQL — errors', () => {
  it('rejects JOIN with a friendly hint', () => {
    const r = convertSQL('SELECT * FROM a JOIN b', deps)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected error')
    expect(r.error).toMatch(/\$lookup/)
  })

  it('rejects OFFSET with a pagination hint', () => {
    const r = convertSQL('SELECT * FROM c LIMIT 5 OFFSET 10', deps)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected error')
    expect(r.error).toMatch(/pagination/)
    expect(r.position).toBeGreaterThan(0)
  })

  it('never throws on malformed input', () => {
    expect(() => convertSQL('SELECT SELECT WHERE', deps)).not.toThrow()
    expect(() => convertSQL("WHERE a = '", deps)).not.toThrow()
  })
})
