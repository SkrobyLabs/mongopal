import { describe, it, expect } from 'vitest'
import {
  detectCompletionContext,
  buildFieldItems,
  buildOperatorItems,
  buildValueItems,
  getFieldType,
  createQueryCompletionProvider,
  type CompletionItemOption,
  type TextModel,
} from './queryCompletionProvider'
import type { SchemaResult, SchemaField } from '../components/contexts/SchemaContext'

// =============================================================================
// Helpers
// =============================================================================

/** Create a mock TextModel for provider tests */
function createMockModel(text: string): TextModel {
  return {
    getValue: () => text,
    getOffsetAt: ({ lineNumber, column }: { lineNumber: number; column: number }) => {
      const lines = text.split('\n')
      let offset = 0
      for (let i = 0; i < lineNumber - 1 && i < lines.length; i++) {
        offset += lines[i].length + 1 // +1 for \n
      }
      return offset + column - 1
    },
  }
}

/** Create a position from a text and cursor marker | */
function posFromMarker(text: string): { cleanText: string; offset: number } {
  const idx = text.indexOf('|')
  if (idx === -1) throw new Error('No cursor marker | found in text')
  const cleanText = text.slice(0, idx) + text.slice(idx + 1)
  return { cleanText, offset: idx }
}

/** Build a basic schema for tests */
function makeSchema(fields: Record<string, { type: string; occurrence: number; fields?: Record<string, SchemaField> }>): SchemaResult {
  const schemaFields: Record<string, SchemaField> = {}
  for (const [name, info] of Object.entries(fields)) {
    schemaFields[name] = { type: info.type, occurrence: info.occurrence, fields: info.fields }
  }
  return {
    collection: 'test',
    sampleSize: 100,
    totalDocs: 1000,
    fields: schemaFields,
  }
}

// =============================================================================
// Context Detection
// =============================================================================

describe('detectCompletionContext', () => {
  describe('field context', () => {
    it('detects field after opening brace', () => {
      const { cleanText, offset } = posFromMarker('{ |')
      const ctx = detectCompletionContext(cleanText, offset)
      expect(ctx.type).toBe('field')
    })

    it('detects field after opening brace with quote', () => {
      const { cleanText, offset } = posFromMarker('{ "|')
      const ctx = detectCompletionContext(cleanText, offset)
      expect(ctx.type).toBe('field')
      if (ctx.type === 'field') expect(ctx.prefix).toBe('')
    })

    it('detects field with prefix after quote', () => {
      const { cleanText, offset } = posFromMarker('{ "na|')
      const ctx = detectCompletionContext(cleanText, offset)
      expect(ctx.type).toBe('field')
      if (ctx.type === 'field') expect(ctx.prefix).toBe('na')
    })

    it('detects field after comma', () => {
      const { cleanText, offset } = posFromMarker('{ "name": "test", |')
      const ctx = detectCompletionContext(cleanText, offset)
      expect(ctx.type).toBe('field')
    })

    it('detects field after comma with quote', () => {
      const { cleanText, offset } = posFromMarker('{ "name": "test", "|')
      const ctx = detectCompletionContext(cleanText, offset)
      expect(ctx.type).toBe('field')
    })

    it('detects field with prefix after comma', () => {
      const { cleanText, offset } = posFromMarker('{ "name": "test", "ag|')
      const ctx = detectCompletionContext(cleanText, offset)
      expect(ctx.type).toBe('field')
      if (ctx.type === 'field') expect(ctx.prefix).toBe('ag')
    })

    it('reports depth 1 at root level', () => {
      const { cleanText, offset } = posFromMarker('{ "|')
      const ctx = detectCompletionContext(cleanText, offset)
      expect(ctx.type).toBe('field')
      if (ctx.type === 'field') expect(ctx.depth).toBe(1)
    })

    it('reports depth 2 in nested object', () => {
      const { cleanText, offset } = posFromMarker('{ "a": { "|')
      const ctx = detectCompletionContext(cleanText, offset)
      expect(ctx.type).toBe('field')
      if (ctx.type === 'field') expect(ctx.depth).toBe(2)
    })
  })

  describe('operator context', () => {
    it('detects operator after $ in value object', () => {
      const { cleanText, offset } = posFromMarker('{ "age": { "$|')
      const ctx = detectCompletionContext(cleanText, offset)
      expect(ctx.type).toBe('operator')
    })

    it('detects operator with prefix', () => {
      const { cleanText, offset } = posFromMarker('{ "age": { "$gt|')
      const ctx = detectCompletionContext(cleanText, offset)
      expect(ctx.type).toBe('operator')
      if (ctx.type === 'operator') expect(ctx.prefix).toContain('gt')
    })

    it('detects operator in deeply nested context', () => {
      const { cleanText, offset } = posFromMarker('{ "a": { "b": { "$|')
      const ctx = detectCompletionContext(cleanText, offset)
      expect(ctx.type).toBe('operator')
    })
  })

  describe('logical operator context', () => {
    it('detects logical operator at root level', () => {
      const { cleanText, offset } = posFromMarker('{ "$|')
      const ctx = detectCompletionContext(cleanText, offset)
      expect(ctx.type).toBe('logical-operator')
    })

    it('detects logical operator with prefix', () => {
      const { cleanText, offset } = posFromMarker('{ "$an|')
      const ctx = detectCompletionContext(cleanText, offset)
      expect(ctx.type).toBe('logical-operator')
    })
  })

  describe('value context', () => {
    it('detects value after colon', () => {
      const { cleanText, offset } = posFromMarker('{ "age": |')
      const ctx = detectCompletionContext(cleanText, offset)
      expect(ctx.type).toBe('value')
      if (ctx.type === 'value') expect(ctx.fieldName).toBe('age')
    })

    it('detects value with field name containing dots style', () => {
      const { cleanText, offset } = posFromMarker('{ "name": |')
      const ctx = detectCompletionContext(cleanText, offset)
      expect(ctx.type).toBe('value')
      if (ctx.type === 'value') expect(ctx.fieldName).toBe('name')
    })

    it('detects value after colon with space', () => {
      const { cleanText, offset } = posFromMarker('{ "active":  |')
      const ctx = detectCompletionContext(cleanText, offset)
      expect(ctx.type).toBe('value')
      if (ctx.type === 'value') expect(ctx.fieldName).toBe('active')
    })
  })

  describe('none context', () => {
    it('returns none for empty text', () => {
      expect(detectCompletionContext('', 0).type).toBe('none')
    })

    it('returns none at offset 0', () => {
      expect(detectCompletionContext('{ }', 0).type).toBe('none')
    })

    it('returns none inside a string value', () => {
      const { cleanText, offset } = posFromMarker('{ "name": "test|" }')
      const ctx = detectCompletionContext(cleanText, offset)
      expect(ctx.type).toBe('none')
    })

    it('returns none inside a string value with spaces', () => {
      const { cleanText, offset } = posFromMarker('{ "name": "hello wor|ld" }')
      const ctx = detectCompletionContext(cleanText, offset)
      expect(ctx.type).toBe('none')
    })
  })

  describe('edge cases', () => {
    it('handles multiline queries', () => {
      const text = '{\n  "name": "test",\n  "'
      const ctx = detectCompletionContext(text, text.length)
      expect(ctx.type).toBe('field')
    })

    it('handles query with multiple fields', () => {
      const { cleanText, offset } = posFromMarker('{ "name": "test", "age": { "$gt|')
      const ctx = detectCompletionContext(cleanText, offset)
      expect(ctx.type).toBe('operator')
    })

    it('handles empty query start', () => {
      const ctx = detectCompletionContext('{', 1)
      expect(ctx.type).toBe('field')
    })

    it('handles offset beyond text length', () => {
      const ctx = detectCompletionContext('{ }', 100)
      expect(ctx.type).not.toThrow
    })
  })
})

// =============================================================================
// Operator Definitions
// =============================================================================

describe('buildOperatorItems', () => {
  describe('query operators', () => {
    it('returns comparison operators', () => {
      const items = buildOperatorItems('query', '')
      const labels = items.map((i) => i.label)
      expect(labels).toContain('$eq')
      expect(labels).toContain('$ne')
      expect(labels).toContain('$gt')
      expect(labels).toContain('$gte')
      expect(labels).toContain('$lt')
      expect(labels).toContain('$lte')
      expect(labels).toContain('$in')
      expect(labels).toContain('$nin')
    })

    it('returns element operators', () => {
      const items = buildOperatorItems('query', '')
      const labels = items.map((i) => i.label)
      expect(labels).toContain('$exists')
      expect(labels).toContain('$type')
    })

    it('returns evaluation operators', () => {
      const items = buildOperatorItems('query', '')
      const labels = items.map((i) => i.label)
      expect(labels).toContain('$regex')
      expect(labels).toContain('$expr')
    })

    it('returns array operators', () => {
      const items = buildOperatorItems('query', '')
      const labels = items.map((i) => i.label)
      expect(labels).toContain('$all')
      expect(labels).toContain('$elemMatch')
      expect(labels).toContain('$size')
    })

    it('all operators have documentation', () => {
      const items = buildOperatorItems('query', '')
      for (const item of items) {
        expect(item.documentation, `${item.label} missing documentation`).toBeTruthy()
      }
    })

    it('all operators have insertText', () => {
      const items = buildOperatorItems('query', '')
      for (const item of items) {
        expect(item.insertText, `${item.label} missing insertText`).toBeTruthy()
      }
    })

    it('all operators have detail', () => {
      const items = buildOperatorItems('query', '')
      for (const item of items) {
        expect(item.detail, `${item.label} missing detail`).toBeTruthy()
      }
    })

    it('filters by prefix', () => {
      const items = buildOperatorItems('query', '$gt')
      const labels = items.map((i) => i.label)
      expect(labels).toContain('$gt')
      expect(labels).toContain('$gte')
      expect(labels).not.toContain('$lt')
      expect(labels).not.toContain('$eq')
    })

    it('filters prefix case-insensitively', () => {
      const items = buildOperatorItems('query', '$GT')
      expect(items.length).toBeGreaterThan(0)
      expect(items[0].label).toBe('$gt')
    })
  })

  describe('logical operators', () => {
    it('returns all logical operators', () => {
      const items = buildOperatorItems('logical', '')
      const labels = items.map((i) => i.label)
      expect(labels).toContain('$and')
      expect(labels).toContain('$or')
      expect(labels).toContain('$not')
      expect(labels).toContain('$nor')
    })

    it('logical operators have snippet insertText', () => {
      const items = buildOperatorItems('logical', '')
      for (const item of items) {
        expect(item.insertTextRules).toBe(4) // InsertAsSnippet
      }
    })

    it('$and snippet has array of objects', () => {
      const items = buildOperatorItems('logical', '$and')
      const andItem = items.find((i) => i.label === '$and')
      expect(andItem).toBeDefined()
      expect(andItem!.insertText).toContain('[')
      expect(andItem!.insertText).toContain('{')
    })

    it('filters logical operators by prefix', () => {
      const items = buildOperatorItems('logical', '$or')
      expect(items.length).toBe(1)
      expect(items[0].label).toBe('$or')
    })
  })

  describe('extended JSON operators', () => {
    it('returns extended JSON type wrappers', () => {
      const items = buildOperatorItems('extended-json', '')
      const labels = items.map((i) => i.label)
      expect(labels).toContain('$oid')
      expect(labels).toContain('$date')
      expect(labels).toContain('$numberInt')
      expect(labels).toContain('$numberLong')
      expect(labels).toContain('$numberDouble')
      expect(labels).toContain('$numberDecimal')
    })

    it('all extended JSON operators have documentation', () => {
      const items = buildOperatorItems('extended-json', '')
      for (const item of items) {
        expect(item.documentation, `${item.label} missing documentation`).toBeTruthy()
      }
    })

    it('filters by prefix', () => {
      const items = buildOperatorItems('extended-json', '$num')
      const labels = items.map((i) => i.label)
      expect(labels).toContain('$numberInt')
      expect(labels).toContain('$numberLong')
      expect(labels).not.toContain('$oid')
    })
  })
})

// =============================================================================
// Field Completions
// =============================================================================

describe('buildFieldItems', () => {
  it('returns items for all matching fields', () => {
    const fields = new Set(['name', 'age', 'email'])
    const items = buildFieldItems(fields, null, '')
    expect(items).toHaveLength(3)
  })

  it('filters fields by prefix', () => {
    const fields = new Set(['name', 'age', 'address'])
    const items = buildFieldItems(fields, null, 'a')
    const labels = items.map((i) => i.label)
    expect(labels).toContain('age')
    expect(labels).toContain('address')
    expect(labels).not.toContain('name')
  })

  it('filters case-insensitively', () => {
    const fields = new Set(['Name', 'age'])
    const items = buildFieldItems(fields, null, 'n')
    expect(items).toHaveLength(1)
    expect(items[0].label).toBe('Name')
  })

  it('wraps field names in quotes', () => {
    const fields = new Set(['name'])
    const items = buildFieldItems(fields, null, '')
    expect(items[0].insertText).toBe('"name"')
  })

  it('includes dot-paths', () => {
    const fields = new Set(['name', 'address.city', 'address.zip'])
    const items = buildFieldItems(fields, null, 'address')
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.label)).toContain('address.city')
    expect(items.map((i) => i.label)).toContain('address.zip')
  })

  it('includes type info from schema', () => {
    const schema = makeSchema({
      name: { type: 'string', occurrence: 100 },
      age: { type: 'number', occurrence: 95 },
    })
    const fields = new Set(['name', 'age'])
    const items = buildFieldItems(fields, schema, '')
    const nameItem = items.find((i) => i.label === 'name')
    expect(nameItem?.detail).toContain('string')
    expect(nameItem?.detail).toContain('100%')
    const ageItem = items.find((i) => i.label === 'age')
    expect(ageItem?.detail).toContain('number')
    expect(ageItem?.detail).toContain('95%')
  })

  it('sorts by occurrence (most common first)', () => {
    const schema = makeSchema({
      rare: { type: 'string', occurrence: 10 },
      common: { type: 'string', occurrence: 100 },
      medium: { type: 'string', occurrence: 50 },
    })
    const fields = new Set(['rare', 'common', 'medium'])
    const items = buildFieldItems(fields, schema, '')
    expect(items[0].label).toBe('common')
    expect(items[1].label).toBe('medium')
    expect(items[2].label).toBe('rare')
  })

  it('caps at 50 suggestions', () => {
    const fields = new Set<string>()
    for (let i = 0; i < 100; i++) {
      fields.add(`field_${String(i).padStart(3, '0')}`)
    }
    const items = buildFieldItems(fields, null, '')
    expect(items).toHaveLength(50)
  })

  it('returns empty for null fieldNames', () => {
    const items = buildFieldItems(null, null, '')
    expect(items).toHaveLength(0)
  })

  it('returns empty for empty fieldNames', () => {
    const items = buildFieldItems(new Set(), null, '')
    expect(items).toHaveLength(0)
  })

  it('returns empty when no fields match prefix', () => {
    const fields = new Set(['name', 'age'])
    const items = buildFieldItems(fields, null, 'xyz')
    expect(items).toHaveLength(0)
  })

  it('handles fields without schema gracefully', () => {
    const fields = new Set(['name', 'age'])
    const items = buildFieldItems(fields, null, '')
    expect(items).toHaveLength(2)
    // No detail when no schema
    expect(items[0].detail).toBeUndefined()
  })
})

// =============================================================================
// Value Completions
// =============================================================================

describe('buildValueItems', () => {
  it('suggests true/false for boolean', () => {
    const items = buildValueItems('bool')
    const labels = items.map((i) => i.label)
    expect(labels).toContain('true')
    expect(labels).toContain('false')
  })

  it('suggests true/false for boolean (alternate casing)', () => {
    const items = buildValueItems('boolean')
    expect(items.map((i) => i.label)).toContain('true')
  })

  it('suggests ObjectId wrapper for objectId type', () => {
    const items = buildValueItems('objectId')
    expect(items.length).toBeGreaterThanOrEqual(2)
    // First item: mongosh-style ObjectId()
    expect(items[0].label).toBe('ObjectId()')
    expect(items[0].insertText).toContain('ObjectId')
    // Second item: Extended JSON
    expect(items[1].label).toBe('ObjectId (Extended JSON)')
    expect(items[1].insertText).toContain('$oid')
  })

  it('suggests Date wrapper for date type', () => {
    const items = buildValueItems('date')
    expect(items.length).toBeGreaterThanOrEqual(2)
    // First item: mongosh-style ISODate()
    expect(items[0].label).toBe('ISODate()')
    expect(items[0].insertText).toContain('ISODate')
    // Second item: Extended JSON
    expect(items[1].label).toBe('Date (Extended JSON)')
    expect(items[1].insertText).toContain('$date')
  })

  it('suggests null for null type', () => {
    const items = buildValueItems('null')
    expect(items).toHaveLength(1)
    expect(items[0].label).toBe('null')
  })

  it('suggests number placeholder for number types', () => {
    for (const t of ['number', 'int', 'long', 'double', 'decimal']) {
      const items = buildValueItems(t)
      expect(items.length, `no items for ${t}`).toBeGreaterThan(0)
    }
  })

  it('returns empty for string type', () => {
    const items = buildValueItems('string')
    expect(items).toHaveLength(0)
  })

  it('returns empty for undefined type', () => {
    const items = buildValueItems(undefined)
    expect(items).toHaveLength(0)
  })

  it('returns empty for unknown type', () => {
    const items = buildValueItems('foobar')
    expect(items).toHaveLength(0)
  })
})

// =============================================================================
// Schema Helpers
// =============================================================================

describe('getFieldType', () => {
  it('returns type for top-level field', () => {
    const schema = makeSchema({ name: { type: 'string', occurrence: 100 } })
    expect(getFieldType(schema, 'name')).toBe('string')
  })

  it('returns type for nested field', () => {
    const schema = makeSchema({
      address: {
        type: 'object',
        occurrence: 80,
        fields: {
          city: { type: 'string', occurrence: 80 },
          zip: { type: 'string', occurrence: 75 },
        },
      },
    })
    expect(getFieldType(schema, 'address.city')).toBe('string')
    expect(getFieldType(schema, 'address.zip')).toBe('string')
  })

  it('returns undefined for non-existent field', () => {
    const schema = makeSchema({ name: { type: 'string', occurrence: 100 } })
    expect(getFieldType(schema, 'missing')).toBeUndefined()
  })

  it('returns undefined for non-existent nested field', () => {
    const schema = makeSchema({ name: { type: 'string', occurrence: 100 } })
    expect(getFieldType(schema, 'name.sub')).toBeUndefined()
  })

  it('returns undefined for null schema', () => {
    expect(getFieldType(null, 'name')).toBeUndefined()
  })

  it('returns undefined for schema with no fields', () => {
    const schema: SchemaResult = { collection: 'test', sampleSize: 0, totalDocs: 0, fields: {} }
    expect(getFieldType(schema, 'name')).toBeUndefined()
  })
})

// =============================================================================
// Provider Integration
// =============================================================================

describe('createQueryCompletionProvider', () => {
  const schema = makeSchema({
    name: { type: 'string', occurrence: 100 },
    age: { type: 'number', occurrence: 95 },
    active: { type: 'bool', occurrence: 80 },
    _id: { type: 'objectId', occurrence: 100 },
  })
  const fieldNames = new Set(['name', 'age', 'active', '_id'])

  function callProvider(text: string, lineNumber: number, column: number, opts?: { schema?: SchemaResult | null; fields?: Set<string> | null }): CompletionItemOption[] {
    const provider = createQueryCompletionProvider({
      getSchema: () => opts?.schema !== undefined ? opts.schema : schema,
      getFieldNames: () => opts?.fields !== undefined ? opts.fields : fieldNames,
    })
    const model = createMockModel(text)
    const result = provider.provideCompletionItems(model, { lineNumber, column })
    return result.suggestions
  }

  it('returns field completions at field position', () => {
    // '{ "' — cursor after the opening quote
    const suggestions = callProvider('{ "', 1, 4)
    const labels = suggestions.map((s) => s.label)
    expect(labels).toContain('name')
    expect(labels).toContain('age')
  })

  it('returns field completions with prefix', () => {
    const suggestions = callProvider('{ "na', 1, 6)
    const labels = suggestions.map((s) => s.label)
    expect(labels).toContain('name')
    expect(labels).not.toContain('age')
  })

  it('returns operator completions inside value object', () => {
    const suggestions = callProvider('{ "age": { "$', 1, 14)
    const labels = suggestions.map((s) => s.label)
    expect(labels).toContain('$gt')
    expect(labels).toContain('$lt')
    expect(labels).toContain('$in')
  })

  it('returns logical operator completions at root level $', () => {
    const suggestions = callProvider('{ "$', 1, 5)
    const labels = suggestions.map((s) => s.label)
    expect(labels).toContain('$and')
    expect(labels).toContain('$or')
  })

  it('returns value completions for boolean field', () => {
    const suggestions = callProvider('{ "active": ', 1, 13)
    const labels = suggestions.map((s) => s.label)
    expect(labels).toContain('true')
    expect(labels).toContain('false')
  })

  it('returns value completions for objectId field', () => {
    const suggestions = callProvider('{ "_id": ', 1, 10)
    const labels = suggestions.map((s) => s.label)
    expect(labels).toContain('ObjectId()')
  })

  it('returns empty suggestions inside string value', () => {
    const suggestions = callProvider('{ "name": "test" }', 1, 15)
    expect(suggestions).toHaveLength(0)
  })

  it('returns suggestions with no schema', () => {
    // Without schema, field list should be empty but operators still work
    const suggestions = callProvider('{ "age": { "$', 1, 14, { schema: null, fields: null })
    const labels = suggestions.map((s) => s.label)
    expect(labels).toContain('$gt')
    expect(labels).toContain('$in')
  })

  it('returns empty field suggestions with no schema', () => {
    const suggestions = callProvider('{ "', 1, 4, { schema: null, fields: null })
    // No fields to suggest when there's no schema
    const fieldItems = suggestions.filter((s) => s.kind === 4) // Field kind
    expect(fieldItems).toHaveLength(0)
  })

  it('has trigger characters', () => {
    const provider = createQueryCompletionProvider({
      getSchema: () => null,
      getFieldNames: () => null,
    })
    expect(provider.triggerCharacters).toContain('"')
    expect(provider.triggerCharacters).toContain('$')
    expect(provider.triggerCharacters).toContain('{')
  })

  it('returns logical operators along with fields at root level', () => {
    // At root level with empty prefix, we should get both fields and logical operators
    const suggestions = callProvider('{ ', 1, 3)
    const labels = suggestions.map((s) => s.label)
    // Should have field names
    expect(labels).toContain('name')
    // Should also have logical operators
    expect(labels).toContain('$and')
    expect(labels).toContain('$or')
  })

  it('returns extended JSON operators alongside query operators', () => {
    const suggestions = callProvider('{ "age": { "$', 1, 14)
    const labels = suggestions.map((s) => s.label)
    expect(labels).toContain('$oid')
    expect(labels).toContain('$date')
  })

  it('handles empty editor', () => {
    const suggestions = callProvider('', 1, 1)
    expect(suggestions).toHaveLength(0)
  })

  it('handles multiline query', () => {
    const text = '{\n  "'
    const suggestions = callProvider(text, 2, 4)
    const labels = suggestions.map((s) => s.label)
    expect(labels).toContain('name')
  })

  it('returns number placeholder for number field value', () => {
    const suggestions = callProvider('{ "age": ', 1, 10)
    expect(suggestions.length).toBeGreaterThan(0)
  })

  it('returns mongosh constructors for string field value', () => {
    const suggestions = callProvider('{ "name": ', 1, 11)
    // String type → no type-specific value items, but mongosh constructors are offered
    const labels = suggestions.map((s) => s.label)
    expect(labels).toContain('ObjectId()')
    expect(labels).toContain('ISODate()')
  })

  it('sets range to include opening quote for field completions after "', () => {
    // User typed { " and cursor is right after the quote
    const suggestions = callProvider('{ "', 1, 4)
    const fieldItems = suggestions.filter((s) => s.kind === 4) // Field kind
    expect(fieldItems.length).toBeGreaterThan(0)
    // Range should start at column 3 (the opening quote) so inserting `"name"` replaces `"`
    for (const item of fieldItems) {
      expect(item.range).toBeDefined()
      expect(item.range!.startColumn).toBe(3)
      expect(item.range!.endColumn).toBe(4)
    }
  })

  it('sets range to include opening quote when prefix is typed after "', () => {
    // User typed { "na and cursor is after "na"
    const suggestions = callProvider('{ "na', 1, 6)
    const fieldItems = suggestions.filter((s) => s.kind === 4) // Field kind
    expect(fieldItems.length).toBeGreaterThan(0)
    // Range should start at column 3 (the opening quote) and end at column 6 (cursor)
    for (const item of fieldItems) {
      expect(item.range).toBeDefined()
      expect(item.range!.startColumn).toBe(3)
      expect(item.range!.endColumn).toBe(6)
    }
  })

  it('does not set range for field completions without opening quote', () => {
    // After { with no quote — unquoted field context
    const suggestions = callProvider('{ ', 1, 3)
    const fieldItems = suggestions.filter((s) => s.kind === 4) // Field kind
    for (const item of fieldItems) {
      expect(item.range).toBeUndefined()
    }
  })
})
