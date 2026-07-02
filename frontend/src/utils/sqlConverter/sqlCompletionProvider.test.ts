import { describe, it, expect } from 'vitest'
import { detectSqlContext, createSqlCompletionProvider, SqlCompletionProviderDeps } from './sqlCompletionProvider'
import type { SchemaResult } from '../../components/contexts/SchemaContext'
import type { TextModel } from '../queryCompletionProvider'

const schema: SchemaResult = {
  collection: 'users',
  sampleSize: 10,
  totalDocs: 10,
  fields: {
    name: { type: 'String', occurrence: 10 },
    age: { type: 'Int32', occurrence: 10 },
    _id: { type: 'ObjectId', occurrence: 10 },
  },
}

const deps: SqlCompletionProviderDeps = {
  getSchema: () => schema,
  getFieldNames: () => new Set(['name', 'age', '_id']),
  getCurrentCollection: () => 'users',
}

function model(text: string): TextModel {
  return {
    getValue: () => text,
    getOffsetAt: () => text.length,
  }
}

describe('detectSqlContext', () => {
  const at = (sql: string) => detectSqlContext(sql, sql.length)

  it('start of query → keyword', () => {
    expect(at('SEL').type).toBe('keyword')
  })

  it('after SELECT → select list', () => {
    expect(at('SELECT ').type).toBe('select')
    expect(at('SELECT na').type).toBe('select')
  })

  it('after FROM → collection', () => {
    expect(at('SELECT * FROM ').type).toBe('from')
  })

  it('after WHERE → field', () => {
    expect(at('SELECT * FROM c WHERE ').type).toBe('field')
  })

  it('after a field in WHERE → operator', () => {
    expect(at('SELECT * FROM c WHERE age ').type).toBe('operator')
  })

  it('after operator → value', () => {
    const ctx = at('SELECT * FROM c WHERE age = ')
    expect(ctx.type).toBe('value')
    if (ctx.type === 'value') expect(ctx.field).toBe('age')
  })

  it('after GROUP BY → field', () => {
    expect(at('SELECT * FROM c GROUP BY ').type).toBe('field')
  })

  it('after ORDER BY → field', () => {
    expect(at('SELECT * FROM c ORDER BY ').type).toBe('field')
  })
})

describe('createSqlCompletionProvider', () => {
  const provider = createSqlCompletionProvider(deps)

  it('suggests fields after WHERE', () => {
    const { suggestions } = provider.provideCompletionItems(model('SELECT * FROM c WHERE '), { lineNumber: 1, column: 1 })
    expect(suggestions.map((s) => s.label)).toEqual(expect.arrayContaining(['name', 'age']))
  })

  it('suggests the current collection after FROM', () => {
    const { suggestions } = provider.provideCompletionItems(model('SELECT * FROM '), { lineNumber: 1, column: 1 })
    expect(suggestions.map((s) => s.label)).toContain('users')
  })

  it('suggests operators after a WHERE field', () => {
    const { suggestions } = provider.provideCompletionItems(model('SELECT * FROM c WHERE age '), { lineNumber: 1, column: 1 })
    expect(suggestions.map((s) => s.label)).toEqual(expect.arrayContaining(['=', 'IN', 'LIKE']))
  })

  it('suggests aggregates in the select list', () => {
    const { suggestions } = provider.provideCompletionItems(model('SELECT '), { lineNumber: 1, column: 1 })
    expect(suggestions.map((s) => s.label)).toEqual(expect.arrayContaining(['COUNT(*)', 'name']))
  })

  it('offers ObjectId() as a value for an ObjectId field', () => {
    const { suggestions } = provider.provideCompletionItems(model('SELECT * FROM c WHERE _id = '), { lineNumber: 1, column: 1 })
    expect(suggestions.some((s) => s.label.startsWith('ObjectId'))).toBe(true)
  })
})
