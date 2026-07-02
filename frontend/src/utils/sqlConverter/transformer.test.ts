import { describe, it, expect } from 'vitest'
import { transform, likeToRegex, TransformFindResult, TransformAggregateResult } from './transformer'
import { parse } from './parser'
import type { ConverterDeps } from './types'
import type { SchemaResult } from '../../components/contexts/SchemaContext'

const noSchema: ConverterDeps = { getSchema: () => null }

function schemaDeps(fields: Record<string, string>): ConverterDeps {
  const schema: SchemaResult = {
    collection: 'c',
    sampleSize: 10,
    totalDocs: 10,
    fields: Object.fromEntries(
      Object.entries(fields).map(([k, type]) => [k, { type, occurrence: 10 }]),
    ),
  }
  return { getSchema: () => schema }
}

function find(sql: string, deps: ConverterDeps = noSchema): TransformFindResult {
  const r = transform(parse(sql), deps)
  if (r.kind !== 'find') throw new Error('expected find')
  return r
}

function agg(sql: string, deps: ConverterDeps = noSchema): TransformAggregateResult {
  const r = transform(parse(sql), deps)
  if (r.kind !== 'aggregate') throw new Error('expected aggregate')
  return r
}

describe('transformer — WHERE', () => {
  it('equality and comparisons', () => {
    expect(find('SELECT * FROM c WHERE a = 1').filter).toEqual({ a: 1 })
    expect(find('SELECT * FROM c WHERE a > 1').filter).toEqual({ a: { $gt: 1 } })
    expect(find('SELECT * FROM c WHERE a != 1').filter).toEqual({ a: { $ne: 1 } })
  })

  it('AND merges non-colliding keys', () => {
    expect(find('SELECT * FROM c WHERE a = 1 AND b = 2').filter).toEqual({ a: 1, b: 2 })
  })

  it('AND with colliding keys uses $and', () => {
    expect(find('SELECT * FROM c WHERE a > 1 AND a < 10').filter).toEqual({
      $and: [{ a: { $gt: 1 } }, { a: { $lt: 10 } }],
    })
  })

  it('a = 1 AND (a = 2 OR b = 3) uses explicit $and', () => {
    const f = find('SELECT * FROM c WHERE a = 1 AND (a = 2 OR b = 3)').filter
    expect(f).toHaveProperty('$and')
    expect(f).toEqual({ $and: [{ a: 1 }, { $or: [{ a: 2 }, { b: 3 }] }] })
  })

  it('OR', () => {
    expect(find('SELECT * FROM c WHERE a = 1 OR b = 2').filter).toEqual({ $or: [{ a: 1 }, { b: 2 }] })
  })

  it('IN / NOT IN', () => {
    expect(find("SELECT * FROM c WHERE s IN ('a','b')").filter).toEqual({ s: { $in: ['a', 'b'] } })
    expect(find("SELECT * FROM c WHERE s NOT IN ('a')").filter).toEqual({ s: { $nin: ['a'] } })
  })

  it('BETWEEN', () => {
    expect(find('SELECT * FROM c WHERE a BETWEEN 1 AND 10').filter).toEqual({ a: { $gte: 1, $lte: 10 } })
  })

  it('IS NULL / IS NOT NULL', () => {
    expect(find('SELECT * FROM c WHERE a IS NULL').filter).toEqual({ a: null })
    expect(find('SELECT * FROM c WHERE a IS NOT NULL').filter).toEqual({ a: { $ne: null } })
  })

  it('NOT (a = 1) simplifies to $ne', () => {
    expect(find('SELECT * FROM c WHERE NOT (a = 1)').filter).toEqual({ a: { $ne: 1 } })
  })
})

describe('transformer — LIKE regex', () => {
  it('maps % and _ with anchors', () => {
    expect(likeToRegex('John%')).toBe('^John.*$')
    expect(likeToRegex('a_c')).toBe('^a.c$')
  })

  it('escapes regex metacharacters', () => {
    expect(likeToRegex('50%(x).')).toBe('^50.*\\(x\\)\\.$')
  })

  it('collapses runs of consecutive % to avoid ReDoS-shaped adjacent .* groups', () => {
    expect(likeToRegex('a%%%%%%%%%%b')).toBe('^a.*b$')
    expect(likeToRegex('%'.repeat(200))).toBe('^.*$')
  })

  it('produces $regex filter', () => {
    expect(find("SELECT * FROM c WHERE n LIKE 'A%'").filter).toEqual({ n: { $regex: '^A.*$', $options: '' } })
  })
})

describe('transformer — coercion', () => {
  it('coerces bare string to ObjectId when schema type is exactly ObjectId', () => {
    const f = find("SELECT * FROM c WHERE _id = '507f1f77bcf86cd799439011'", schemaDeps({ _id: 'ObjectId' }))
    expect(f.filter).toEqual({ _id: { $oid: '507f1f77bcf86cd799439011' } })
  })

  it('coerces bare string to Date when schema type is exactly Date', () => {
    const f = find("SELECT * FROM c WHERE created > '2024-01-01'", schemaDeps({ created: 'Date' }))
    expect(f.filter).toEqual({ created: { $gt: { $date: '2024-01-01' } } })
  })

  it('does NOT coerce union types and adds a warning', () => {
    const f = find("SELECT * FROM c WHERE _id = '507f1f77bcf86cd799439011'", schemaDeps({ _id: 'ObjectId | string' }))
    expect(f.filter).toEqual({ _id: '507f1f77bcf86cd799439011' })
    expect(f.warnings.join(' ')).toMatch(/mixed types/)
  })

  it('does NOT coerce unknown fields', () => {
    const f = find("SELECT * FROM c WHERE x = '507f1f77bcf86cd799439011'", noSchema)
    expect(f.filter).toEqual({ x: '507f1f77bcf86cd799439011' })
  })

  it('explicit ObjectId() always works without schema', () => {
    const f = find("SELECT * FROM c WHERE _id = ObjectId('507f1f77bcf86cd799439011')", noSchema)
    expect(f.filter).toEqual({ _id: { $oid: '507f1f77bcf86cd799439011' } })
  })

  it('warns but leaves string when ObjectId field gets a non-hex value', () => {
    const f = find("SELECT * FROM c WHERE _id = 'abc'", schemaDeps({ _id: 'ObjectId' }))
    expect(f.filter).toEqual({ _id: 'abc' })
    expect(f.warnings.length).toBeGreaterThan(0)
  })
})

describe('transformer — projection / sort / limit', () => {
  it('field list produces projection keeping _id', () => {
    const f = find('SELECT name, email FROM c')
    expect(f.projection).toEqual({ name: 1, email: 1 })
  })

  it('SELECT * has no projection', () => {
    expect(find('SELECT * FROM c').projection).toBeNull()
  })

  it('ORDER BY maps to sort', () => {
    expect(find('SELECT * FROM c ORDER BY a DESC, b').sort).toEqual({ a: -1, b: 1 })
  })

  it('LIMIT captured', () => {
    expect(find('SELECT * FROM c LIMIT 10').limit).toBe(10)
  })
})

describe('transformer — aggregate', () => {
  it('GROUP BY builds pipeline', () => {
    const p = agg('SELECT status, COUNT(*) FROM c GROUP BY status').pipeline
    expect(p).toContainEqual({ $group: { _id: '$status', count_star: { $sum: 1 } } })
  })

  it('GROUP BY with WHERE prepends $match', () => {
    const p = agg('SELECT status, COUNT(*) FROM c WHERE active = true GROUP BY status').pipeline
    expect(p[0]).toEqual({ $match: { active: true } })
  })

  it('HAVING appends a $match on the aggregate output', () => {
    const p = agg('SELECT status, COUNT(*) AS cnt FROM c GROUP BY status HAVING cnt > 5').pipeline
    expect(p).toContainEqual({ $match: { cnt: { $gt: 5 } } })
  })

  it('SUM/AVG accumulators', () => {
    const p = agg('SELECT dept, SUM(salary), AVG(salary) FROM c GROUP BY dept').pipeline
    const group = p.find((s) => '$group' in s)!.$group as Record<string, unknown>
    expect(group.sum_salary).toEqual({ $sum: '$salary' })
    expect(group.avg_salary).toEqual({ $avg: '$salary' })
  })

  it('ORDER BY aggregate maps to output field; group key maps to _id', () => {
    const p = agg('SELECT dept, SUM(salary) FROM c GROUP BY dept ORDER BY SUM(salary) DESC').pipeline
    expect(p).toContainEqual({ $sort: { sum_salary: -1 } })
    const p2 = agg('SELECT status, COUNT(*) FROM c GROUP BY status ORDER BY status ASC').pipeline
    expect(p2).toContainEqual({ $sort: { _id: 1 } })
  })

  it('bare COUNT(*) is an aggregate', () => {
    const p = agg('SELECT COUNT(*) FROM c').pipeline
    expect(p).toContainEqual({ $group: { _id: null, count_star: { $sum: 1 } } })
  })

  it('DISTINCT groups by field', () => {
    const p = agg('SELECT DISTINCT city FROM c').pipeline
    expect(p).toContainEqual({ $group: { _id: '$city' } })
  })
})
