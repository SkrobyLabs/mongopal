import { describe, it, expect } from 'vitest'
import { parse, ParseError, syntheticAggName } from './parser'

describe('parser', () => {
  it('parses SELECT * FROM collection', () => {
    const q = parse('SELECT * FROM users')
    expect(q.collection).toBe('users')
    expect(q.fields).toEqual([{ type: 'star' }])
  })

  it('parses field list with aliases', () => {
    const q = parse('SELECT name, email AS mail FROM users')
    expect(q.fields).toEqual([
      { type: 'field', name: 'name' },
      { type: 'field', name: 'email', alias: 'mail' },
    ])
  })

  it('parses quoted collection names', () => {
    const q = parse('SELECT * FROM "system.views"')
    expect(q.collection).toBe('system.views')
  })

  it('parses each comparison operator', () => {
    for (const op of ['=', '!=', '<>', '<', '>', '<=', '>=']) {
      const q = parse(`SELECT * FROM c WHERE a ${op} 1`)
      expect(q.where).toEqual({ type: 'comparison', field: 'a', op, value: 1 })
    }
  })

  it('groups OR of ANDs correctly (a = 1 OR b = 2 AND c = 3)', () => {
    const q = parse('SELECT * FROM c WHERE a = 1 OR b = 2 AND c = 3')
    expect(q.where?.type).toBe('or')
    if (q.where?.type === 'or') {
      expect(q.where.left).toEqual({ type: 'comparison', field: 'a', op: '=', value: 1 })
      expect(q.where.right.type).toBe('and')
    }
  })

  it('parses nested parentheses', () => {
    const q = parse('SELECT * FROM c WHERE (a = 1 OR b = 2) AND c = 3')
    expect(q.where?.type).toBe('and')
  })

  it('parses IN and NOT IN', () => {
    const inQ = parse("SELECT * FROM c WHERE s IN ('a', 'b')")
    expect(inQ.where).toEqual({ type: 'in', field: 's', values: ['a', 'b'] })
    const ninQ = parse("SELECT * FROM c WHERE s NOT IN ('a')")
    expect(ninQ.where).toEqual({ type: 'in', field: 's', values: ['a'], negated: true })
  })

  it('parses LIKE, BETWEEN, IS NULL, IS NOT NULL', () => {
    expect(parse("SELECT * FROM c WHERE n LIKE 'A%'").where).toEqual({ type: 'like', field: 'n', pattern: 'A%' })
    expect(parse('SELECT * FROM c WHERE a BETWEEN 1 AND 10').where).toEqual({ type: 'between', field: 'a', low: 1, high: 10 })
    expect(parse('SELECT * FROM c WHERE a IS NULL').where).toEqual({ type: 'null_check', field: 'a', isNull: true })
    expect(parse('SELECT * FROM c WHERE a IS NOT NULL').where).toEqual({ type: 'null_check', field: 'a', isNull: false })
  })

  it('parses NOT expressions', () => {
    const q = parse('SELECT * FROM c WHERE NOT (a = 1)')
    expect(q.where?.type).toBe('not')
  })

  it('parses ORDER BY single and multiple', () => {
    expect(parse('SELECT * FROM c ORDER BY a DESC').orderBy).toEqual([{ field: 'a', direction: 'desc' }])
    expect(parse('SELECT * FROM c ORDER BY a, b DESC').orderBy).toEqual([
      { field: 'a', direction: 'asc' },
      { field: 'b', direction: 'desc' },
    ])
  })

  it('parses LIMIT', () => {
    expect(parse('SELECT * FROM c LIMIT 10').limit).toBe(10)
  })

  it('parses GROUP BY with aggregates', () => {
    const q = parse('SELECT status, COUNT(*) FROM c GROUP BY status')
    expect(q.groupBy).toEqual(['status'])
    expect(q.fields).toContainEqual({ type: 'aggregate', fn: 'COUNT', field: '*' })
  })

  it('parses HAVING with aliased and unaliased aggregates', () => {
    const q = parse('SELECT status, COUNT(*) AS cnt FROM c GROUP BY status HAVING cnt > 5')
    expect(q.having).toEqual({ type: 'comparison', field: 'cnt', op: '>', value: 5 })
    const q2 = parse('SELECT status, COUNT(*) FROM c GROUP BY status HAVING COUNT(*) > 5')
    expect(q2.having).toEqual({ type: 'comparison', field: 'count_star', op: '>', value: 5 })
  })

  it('parses DISTINCT', () => {
    const q = parse('SELECT DISTINCT city FROM c')
    expect(q.distinct).toBe(true)
  })

  it('parses ObjectId and ISODate value functions', () => {
    const oid = parse("SELECT * FROM c WHERE _id = ObjectId('507f1f77bcf86cd799439011')")
    expect(oid.where).toMatchObject({ value: { type: 'objectId', hex: '507f1f77bcf86cd799439011' } })
    const dt = parse("SELECT * FROM c WHERE d > ISODate('2024-01-01T00:00:00Z')")
    expect(dt.where).toMatchObject({ value: { type: 'date', iso: '2024-01-01T00:00:00Z' } })
  })

  it('rejects invalid ObjectId hex', () => {
    expect(() => parse("SELECT * FROM c WHERE _id = ObjectId('xyz')")).toThrow(/24 hex/)
  })

  it('rejects invalid ISODate', () => {
    expect(() => parse("SELECT * FROM c WHERE d = ISODate('not-a-date')")).toThrow(/valid ISO date/)
  })

  it('rejects field names starting with $ (operator injection)', () => {
    expect(() => parse("SELECT * FROM c WHERE $where = 'x'")).toThrow(/cannot start with '\$'/)
    expect(() => parse('SELECT * FROM c WHERE "$where" = 1')).toThrow(/cannot start with '\$'/)
    expect(() => parse('SELECT $where FROM c')).toThrow(/cannot start with '\$'/)
    expect(() => parse('SELECT a AS $expr FROM c')).toThrow(/cannot start with '\$'/)
    expect(() => parse('SELECT * FROM c GROUP BY $where')).toThrow(/cannot start with '\$'/)
    expect(() => parse('SELECT * FROM c ORDER BY $where')).toThrow(/cannot start with '\$'/)
    expect(() => parse('SELECT * FROM c WHERE "a.$where" = 1')).toThrow(/cannot start with '\$'/)
  })

  it('rejects __proto__/constructor/prototype as field names', () => {
    expect(() => parse("SELECT * FROM c WHERE __proto__ = 1")).toThrow(/not allowed as a field name/)
    expect(() => parse('SELECT * FROM c WHERE "a.constructor" = 1')).toThrow(/not allowed as a field name/)
  })

  it('emits friendly hints for rejected keywords', () => {
    expect(() => parse('SELECT * FROM a JOIN b')).toThrow(/\$lookup/)
    expect(() => parse('SELECT * FROM c LIMIT 5 OFFSET 10')).toThrow(/pagination controls/)
    expect(() => parse('DELETE FROM c')).toThrow(/document editing UI/)
    expect(() => parse('UPDATE c SET a = 1')).toThrow(/document editing UI/)
    expect(() => parse("INSERT INTO c VALUES (1)")).toThrow(/document editing UI/)
  })

  it('HAVING without GROUP BY errors', () => {
    expect(() => parse('SELECT * FROM c HAVING a > 1')).toThrow(/HAVING requires a GROUP BY/)
  })

  it('reports position on parse errors', () => {
    try {
      parse('SELECT FROM c')
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError)
      expect((e as ParseError).position).toBeGreaterThanOrEqual(0)
    }
  })

  it('syntheticAggName sanitizes', () => {
    expect(syntheticAggName('COUNT', '*')).toBe('count_star')
    expect(syntheticAggName('SUM', 'amount')).toBe('sum_amount')
    expect(syntheticAggName('AVG', 'a.b')).toBe('avg_a_b')
  })
})
