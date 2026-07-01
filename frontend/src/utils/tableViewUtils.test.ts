import { describe, it, expect, beforeEach } from 'vitest'
import {
  getDocId,
  formatValue,
  getRawValue,
  getNestedValue,
  isExpandableObject,
  extractColumns,
  getNestedKeys,
  columnHasExpandableObjects,
  getDefaultColumnWidth,
  loadHiddenColumns,
  saveHiddenColumns,
  buildExclusionProjection,
  MongoDocument,
  ExtendedJsonObjectId,
  ExtendedJsonBinary,
  ExtendedJsonUuid,
  ExtendedJsonDate,
  ExtendedJsonNumberLong,
  ExtendedJsonNumberInt,
  ExtendedJsonNumberDouble,
  FormattedValueBoolean,
  FormattedValueString,
  FormattedValueArray,
  FormattedValueDate,
  FormattedValueObjectId,
  FormattedValueBinary,
  FormattedValueUuid,
} from './tableViewUtils'

describe('getDocId', () => {
  it('returns null for null document', () => {
    expect(getDocId(null)).toBe(null)
  })

  it('returns null for undefined document', () => {
    expect(getDocId(undefined)).toBe(null)
  })

  it('returns null for document without _id', () => {
    expect(getDocId({ name: 'test' })).toBe(null)
  })

  it('returns null for document with null _id', () => {
    expect(getDocId({ _id: null })).toBe(null)
  })

  it('returns string ID directly', () => {
    expect(getDocId({ _id: 'my-string-id' })).toBe('my-string-id')
  })

  it('returns hex string for ObjectId', () => {
    const doc: MongoDocument = { _id: { $oid: '507f1f77bcf86cd799439011' } as ExtendedJsonObjectId }
    expect(getDocId(doc)).toBe('507f1f77bcf86cd799439011')
  })

  it('returns Extended JSON for Binary/UUID', () => {
    const binaryId: ExtendedJsonBinary = { $binary: { base64: 'YWJjZA==', subType: '03' } }
    const doc: MongoDocument = { _id: binaryId }
    expect(getDocId(doc)).toBe(JSON.stringify(doc._id))
  })

  it('returns Extended JSON for $uuid type', () => {
    const uuidId: ExtendedJsonUuid = { $uuid: '550e8400-e29b-41d4-a716-446655440000' }
    const doc: MongoDocument = { _id: uuidId }
    expect(getDocId(doc)).toBe(JSON.stringify(doc._id))
  })

  it('handles nested $oid in document', () => {
    const doc: MongoDocument = { _id: { $oid: 'abc123def456789012345678' } as ExtendedJsonObjectId }
    expect(getDocId(doc)).toBe('abc123def456789012345678')
  })

  it('handles numeric _id', () => {
    const doc: MongoDocument = { _id: 12345 }
    expect(getDocId(doc)).toBe(JSON.stringify(12345))
  })
})

describe('formatValue', () => {
  it('handles null', () => {
    const result = formatValue(null)
    expect(result.type).toBe('null')
    expect(result.display).toBe('null')
  })

  it('handles undefined', () => {
    const result = formatValue(undefined)
    expect(result.type).toBe('undefined')
    expect(result.display).toBe('undefined')
  })

  it('handles boolean true', () => {
    const result = formatValue(true) as FormattedValueBoolean
    expect(result.type).toBe('boolean')
    expect(result.display).toBe('true')
    expect(result.boolValue).toBe(true)
  })

  it('handles boolean false', () => {
    const result = formatValue(false) as FormattedValueBoolean
    expect(result.type).toBe('boolean')
    expect(result.display).toBe('false')
    expect(result.boolValue).toBe(false)
  })

  it('handles integers', () => {
    const result = formatValue(42)
    expect(result.type).toBe('number')
    expect(result.display).toBe('42')
  })

  it('handles floats', () => {
    const result = formatValue(3.14159)
    expect(result.type).toBe('number')
    expect(result.display).toBe('3.14159')
  })

  it('handles short strings', () => {
    const result = formatValue('hello') as FormattedValueString
    expect(result.type).toBe('string')
    expect(result.display).toBe('hello')
    expect(result.truncated).toBeFalsy()
  })

  it('truncates long strings', () => {
    const longString = 'a'.repeat(100)
    const result = formatValue(longString) as FormattedValueString
    expect(result.type).toBe('string')
    expect(result.display).toBe('a'.repeat(50) + '...')
    expect(result.truncated).toBe(true)
  })

  it('handles exactly 50 character strings without truncation', () => {
    const exactString = 'a'.repeat(50)
    const result = formatValue(exactString) as FormattedValueString
    expect(result.display).toBe(exactString)
    expect(result.truncated).toBeFalsy()
  })

  it('handles empty arrays', () => {
    const result = formatValue([]) as FormattedValueArray
    expect(result.type).toBe('array')
    expect(result.display).toBe('[0 items]')
    expect(result.length).toBe(0)
  })

  it('handles arrays with items', () => {
    const result = formatValue([1, 2, 3]) as FormattedValueArray
    expect(result.type).toBe('array')
    expect(result.display).toBe('[3 items]')
    expect(result.length).toBe(3)
  })

  it('handles $date with ISO string', () => {
    const dateValue: ExtendedJsonDate = { $date: '2023-01-15T10:30:00Z' }
    const result = formatValue(dateValue)
    expect(result.type).toBe('date')
    expect(result.display).toBe('2023-01-15T10:30:00.000Z')
  })

  it('handles $date with $numberLong', () => {
    const dateValue: ExtendedJsonDate = { $date: { $numberLong: '1673778600000' } }
    const result = formatValue(dateValue)
    expect(result.type).toBe('date')
    expect(result.display).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/)
  })

  it('handles invalid $date', () => {
    const dateValue = { $date: 'not-a-date' }
    const result = formatValue(dateValue) as FormattedValueDate
    expect(result.type).toBe('date')
    expect(result.display).toBe('Invalid Date')
    expect(result.invalid).toBe(true)
  })

  it('handles $oid', () => {
    const oidValue: ExtendedJsonObjectId = { $oid: '507f1f77bcf86cd799439011' }
    const result = formatValue(oidValue) as FormattedValueObjectId
    expect(result.type).toBe('objectId')
    expect(result.display).toBe('ObjectId("507f1f77...")')
    expect(result.fullId).toBe('507f1f77bcf86cd799439011')
  })

  it('handles $numberLong', () => {
    const numValue: ExtendedJsonNumberLong = { $numberLong: '9223372036854775807' }
    const result = formatValue(numValue)
    expect(result.type).toBe('numberLong')
    expect(result.display).toBe('NumberLong("9223372036854775807")')
  })

  it('handles $numberInt', () => {
    const numValue: ExtendedJsonNumberInt = { $numberInt: '42' }
    const result = formatValue(numValue)
    expect(result.type).toBe('numberInt')
    expect(result.display).toBe('NumberInt(42)')
  })

  it('handles $numberDouble', () => {
    const numValue: ExtendedJsonNumberDouble = { $numberDouble: '3.14' }
    const result = formatValue(numValue)
    expect(result.type).toBe('numberDouble')
    expect(result.display).toBe('NumberDouble("3.14")')
  })

  it('handles $binary', () => {
    const binaryValue: ExtendedJsonBinary = { $binary: { base64: 'SGVsbG8gV29ybGQh', subType: '00' } }
    const result = formatValue(binaryValue) as FormattedValueBinary
    expect(result.type).toBe('binary')
    expect(result.display).toBe('Binary("SGVsbG8gV29y...")')
    expect(result.base64).toBe('SGVsbG8gV29ybGQh')
  })

  it('handles $binary with empty base64', () => {
    const binaryValue = { $binary: { subType: '00' } }
    const result = formatValue(binaryValue) as FormattedValueBinary
    expect(result.type).toBe('binary')
    expect(result.display).toBe('Binary("...")')
  })

  it('handles $uuid', () => {
    const uuidValue: ExtendedJsonUuid = { $uuid: '550e8400-e29b-41d4-a716-446655440000' }
    const result = formatValue(uuidValue) as FormattedValueUuid
    expect(result.type).toBe('uuid')
    expect(result.display).toBe('UUID("550e8400...")')
    expect(result.uuid).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('handles plain objects', () => {
    const result = formatValue({ name: 'John', age: 30 })
    expect(result.type).toBe('object')
    expect(result.display).toBe('{...}')
  })

  it('handles empty objects', () => {
    const result = formatValue({})
    expect(result.type).toBe('object')
    expect(result.display).toBe('{...}')
  })
})

describe('getRawValue', () => {
  it('returns "null" for null', () => {
    expect(getRawValue(null)).toBe('null')
  })

  it('returns "undefined" for undefined', () => {
    expect(getRawValue(undefined)).toBe('undefined')
  })

  it('returns string representation of numbers', () => {
    expect(getRawValue(42)).toBe('42')
    expect(getRawValue(3.14)).toBe('3.14')
  })

  it('returns string representation of booleans', () => {
    expect(getRawValue(true)).toBe('true')
    expect(getRawValue(false)).toBe('false')
  })

  it('returns strings as-is', () => {
    expect(getRawValue('hello')).toBe('hello')
  })

  it('returns formatted JSON for objects', () => {
    const obj = { name: 'John', age: 30 }
    expect(getRawValue(obj)).toBe(JSON.stringify(obj, null, 2))
  })

  it('returns formatted JSON for arrays', () => {
    const arr = [1, 2, 3]
    expect(getRawValue(arr)).toBe(JSON.stringify(arr, null, 2))
  })

  it('handles nested objects', () => {
    const obj = { user: { name: 'John', address: { city: 'NYC' } } }
    expect(getRawValue(obj)).toBe(JSON.stringify(obj, null, 2))
  })

  it('handles BSON types in shell-style Extended JSON', () => {
    const bson: ExtendedJsonObjectId = { $oid: '507f1f77bcf86cd799439011' }
    expect(getRawValue(bson)).toBe('ObjectId("507f1f77bcf86cd799439011")')
  })

  it('handles $numberInt raw values in shell-style Extended JSON', () => {
    const bson: ExtendedJsonNumberInt = { $numberInt: '3' }
    expect(getRawValue({ ClusterSize: bson })).toBe('{\n  "ClusterSize": NumberInt(3)\n}')
  })
})

describe('getNestedValue', () => {
  it('gets simple property', () => {
    expect(getNestedValue({ name: 'John' }, 'name')).toBe('John')
  })

  it('gets nested property', () => {
    const obj = { address: { city: 'NYC' } }
    expect(getNestedValue(obj, 'address.city')).toBe('NYC')
  })

  it('gets deeply nested property', () => {
    const obj = { level1: { level2: { level3: { value: 42 } } } }
    expect(getNestedValue(obj, 'level1.level2.level3.value')).toBe(42)
  })

  it('returns undefined for missing simple path', () => {
    expect(getNestedValue({ name: 'John' }, 'age')).toBe(undefined)
  })

  it('returns undefined for missing nested path', () => {
    const obj = { address: { city: 'NYC' } }
    expect(getNestedValue(obj, 'address.country')).toBe(undefined)
  })

  it('returns undefined when intermediate is null', () => {
    const obj = { address: null }
    expect(getNestedValue(obj, 'address.city')).toBe(undefined)
  })

  it('returns undefined when intermediate is undefined', () => {
    const obj = { address: undefined }
    expect(getNestedValue(obj, 'address.city')).toBe(undefined)
  })

  it('handles null object', () => {
    expect(getNestedValue(null, 'name')).toBe(undefined)
  })

  it('handles undefined object', () => {
    expect(getNestedValue(undefined, 'name')).toBe(undefined)
  })

  it('returns undefined for empty path', () => {
    expect(getNestedValue({ name: 'John' }, '')).toBe(undefined)
  })

  it('handles array access with numeric keys', () => {
    const obj = { items: ['a', 'b', 'c'] }
    expect(getNestedValue(obj, 'items.1')).toBe('b')
  })
})

describe('isExpandableObject', () => {
  it('returns true for plain objects', () => {
    expect(isExpandableObject({ name: 'John', age: 30 })).toBe(true)
  })

  it('returns true for empty objects', () => {
    expect(isExpandableObject({})).toBe(true)
  })

  it('returns true for nested plain objects', () => {
    expect(isExpandableObject({ address: { city: 'NYC' } })).toBe(true)
  })

  it('returns false for arrays', () => {
    expect(isExpandableObject([1, 2, 3])).toBe(false)
  })

  it('returns false for empty arrays', () => {
    expect(isExpandableObject([])).toBe(false)
  })

  it('returns false for null', () => {
    expect(isExpandableObject(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isExpandableObject(undefined)).toBe(false)
  })

  it('returns false for primitives', () => {
    expect(isExpandableObject('string')).toBe(false)
    expect(isExpandableObject(42)).toBe(false)
    expect(isExpandableObject(true)).toBe(false)
  })

  it('returns false for $oid', () => {
    const oid: ExtendedJsonObjectId = { $oid: '507f1f77bcf86cd799439011' }
    expect(isExpandableObject(oid)).toBe(false)
  })

  it('returns false for $date', () => {
    const date: ExtendedJsonDate = { $date: '2023-01-15T10:30:00Z' }
    expect(isExpandableObject(date)).toBe(false)
  })

  it('returns false for $date with $numberLong', () => {
    const date: ExtendedJsonDate = { $date: { $numberLong: '1673778600000' } }
    expect(isExpandableObject(date)).toBe(false)
  })

  it('returns false for $numberLong', () => {
    const num: ExtendedJsonNumberLong = { $numberLong: '123' }
    expect(isExpandableObject(num)).toBe(false)
  })

  it('returns false for $numberInt', () => {
    const num: ExtendedJsonNumberInt = { $numberInt: '42' }
    expect(isExpandableObject(num)).toBe(false)
  })

  it('returns false for $numberDouble', () => {
    const num: ExtendedJsonNumberDouble = { $numberDouble: '3.14' }
    expect(isExpandableObject(num)).toBe(false)
  })

  it('returns false for $binary', () => {
    const binary: ExtendedJsonBinary = { $binary: { base64: 'YWJj', subType: '00' } }
    expect(isExpandableObject(binary)).toBe(false)
  })

  it('returns false for $uuid', () => {
    const uuid: ExtendedJsonUuid = { $uuid: '550e8400-e29b-41d4-a716-446655440000' }
    expect(isExpandableObject(uuid)).toBe(false)
  })

  it('returns false for $timestamp', () => {
    expect(isExpandableObject({ $timestamp: { t: 1234567890, i: 1 } })).toBe(false)
  })

  it('returns false for $regularExpression', () => {
    expect(isExpandableObject({ $regularExpression: { pattern: '^test', options: 'i' } })).toBe(false)
  })

  it('returns false for $minKey', () => {
    expect(isExpandableObject({ $minKey: 1 })).toBe(false)
  })

  it('returns false for $maxKey', () => {
    expect(isExpandableObject({ $maxKey: 1 })).toBe(false)
  })
})

describe('extractColumns', () => {
  it('extracts columns from single document', () => {
    const docs: MongoDocument[] = [{ _id: '1', name: 'John', age: 30 }]
    const result = extractColumns(docs)
    expect(result).toEqual(['_id', 'age', 'name'])
  })

  it('extracts columns from multiple documents', () => {
    const docs: MongoDocument[] = [
      { _id: '1', name: 'John' },
      { _id: '2', age: 25 },
    ]
    const result = extractColumns(docs)
    expect(result).toEqual(['_id', 'age', 'name'])
  })

  it('places _id first', () => {
    const docs: MongoDocument[] = [{ name: 'John', _id: '1', zebra: true, apple: 1 }]
    const result = extractColumns(docs)
    expect(result[0]).toBe('_id')
    expect(result).toEqual(['_id', 'apple', 'name', 'zebra'])
  })

  it('sorts columns alphabetically after _id', () => {
    const docs: MongoDocument[] = [{ _id: '1', z: 1, a: 2, m: 3 }]
    const result = extractColumns(docs)
    expect(result).toEqual(['_id', 'a', 'm', 'z'])
  })

  it('handles empty document array', () => {
    const result = extractColumns([])
    expect(result).toEqual([])
  })

  it('handles documents without _id', () => {
    const docs: MongoDocument[] = [{ name: 'John', age: 30 }]
    const result = extractColumns(docs)
    expect(result).toEqual(['age', 'name'])
  })

  it('expands columns when expandedColumns is provided', () => {
    const docs: MongoDocument[] = [{ _id: '1', address: { city: 'NYC', zip: '10001' } }]
    const expanded = new Set(['address'])
    const result = extractColumns(docs, expanded)
    expect(result).toEqual(['_id', 'address.city', 'address.zip'])
  })

  it('handles deeply nested expansion', () => {
    const docs: MongoDocument[] = [{ _id: '1', user: { profile: { name: 'John', age: 30 } } }]
    const expanded = new Set(['user', 'user.profile'])
    const result = extractColumns(docs, expanded)
    expect(result).toEqual(['_id', 'user.profile.age', 'user.profile.name'])
  })

  it('keeps unexpanded columns as single entry', () => {
    const docs: MongoDocument[] = [
      { _id: '1', address: { city: 'NYC' }, name: 'John' }
    ]
    const result = extractColumns(docs)
    expect(result).toEqual(['_id', 'address', 'name'])
  })

  it('handles mixed expanded and unexpanded columns', () => {
    const docs: MongoDocument[] = [
      { _id: '1', address: { city: 'NYC' }, profile: { age: 30 } }
    ]
    const expanded = new Set(['address'])
    const result = extractColumns(docs, expanded)
    expect(result).toContain('address.city')
    expect(result).toContain('profile')
  })

  it('handles expansion of column with no sub-keys', () => {
    const docs: MongoDocument[] = [{ _id: '1', value: 'simple' }]
    const expanded = new Set(['value'])
    const result = extractColumns(docs, expanded)
    expect(result).toEqual(['_id', 'value'])
  })

  it('does not expand BSON type columns', () => {
    const docs: MongoDocument[] = [{ _id: '1', createdAt: { $date: '2023-01-01' } }]
    const expanded = new Set(['createdAt'])
    const result = extractColumns(docs, expanded)
    expect(result).toEqual(['_id', 'createdAt'])
  })
})

describe('getNestedKeys', () => {
  it('extracts keys from nested objects', () => {
    const docs: MongoDocument[] = [{ address: { city: 'NYC', zip: '10001' } }]
    const result = getNestedKeys(docs, 'address')
    expect(result).toEqual(['city', 'zip'])
  })

  it('combines keys from multiple documents', () => {
    const docs: MongoDocument[] = [
      { profile: { name: 'John' } },
      { profile: { age: 30 } },
      { profile: { name: 'Jane', email: 'jane@example.com' } },
    ]
    const result = getNestedKeys(docs, 'profile')
    expect(result).toEqual(['age', 'email', 'name'])
  })

  it('returns sorted keys', () => {
    const docs: MongoDocument[] = [{ data: { z: 1, a: 2, m: 3 } }]
    const result = getNestedKeys(docs, 'data')
    expect(result).toEqual(['a', 'm', 'z'])
  })

  it('returns empty array for primitive column', () => {
    const docs: MongoDocument[] = [{ name: 'John' }]
    const result = getNestedKeys(docs, 'name')
    expect(result).toEqual([])
  })

  it('returns empty array for missing column', () => {
    const docs: MongoDocument[] = [{ name: 'John' }]
    const result = getNestedKeys(docs, 'address')
    expect(result).toEqual([])
  })

  it('returns empty array for BSON type column', () => {
    const docs: MongoDocument[] = [{ _id: { $oid: '507f1f77bcf86cd799439011' } as ExtendedJsonObjectId }]
    const result = getNestedKeys(docs, '_id')
    expect(result).toEqual([])
  })

  it('returns empty array for array column', () => {
    const docs: MongoDocument[] = [{ items: [1, 2, 3] }]
    const result = getNestedKeys(docs, 'items')
    expect(result).toEqual([])
  })

  it('handles nested paths', () => {
    const docs: MongoDocument[] = [{ level1: { level2: { a: 1, b: 2 } } }]
    const result = getNestedKeys(docs, 'level1.level2')
    expect(result).toEqual(['a', 'b'])
  })

  it('skips documents without the column', () => {
    const docs: MongoDocument[] = [
      { profile: { name: 'John' } },
      { other: 'data' },
      { profile: { age: 30 } },
    ]
    const result = getNestedKeys(docs, 'profile')
    expect(result).toEqual(['age', 'name'])
  })
})

describe('columnHasExpandableObjects', () => {
  it('returns true when column has plain objects', () => {
    const docs: MongoDocument[] = [{ address: { city: 'NYC' } }]
    expect(columnHasExpandableObjects(docs, 'address')).toBe(true)
  })

  it('returns true when any document has expandable object', () => {
    const docs: MongoDocument[] = [
      { address: 'simple string' },
      { address: { city: 'NYC' } },
      { address: null },
    ]
    expect(columnHasExpandableObjects(docs, 'address')).toBe(true)
  })

  it('returns false when column has primitives', () => {
    const docs: MongoDocument[] = [
      { name: 'John' },
      { name: 'Jane' },
    ]
    expect(columnHasExpandableObjects(docs, 'name')).toBe(false)
  })

  it('returns false when column has arrays', () => {
    const docs: MongoDocument[] = [{ items: [1, 2, 3] }]
    expect(columnHasExpandableObjects(docs, 'items')).toBe(false)
  })

  it('returns false when column has BSON types', () => {
    const docs: MongoDocument[] = [{ _id: { $oid: '507f1f77bcf86cd799439011' } as ExtendedJsonObjectId }]
    expect(columnHasExpandableObjects(docs, '_id')).toBe(false)
  })

  it('returns false for $date BSON type', () => {
    const docs: MongoDocument[] = [{ createdAt: { $date: '2023-01-01' } }]
    expect(columnHasExpandableObjects(docs, 'createdAt')).toBe(false)
  })

  it('returns false when column is missing in all documents', () => {
    const docs: MongoDocument[] = [{ name: 'John' }, { name: 'Jane' }]
    expect(columnHasExpandableObjects(docs, 'address')).toBe(false)
  })

  it('returns false for empty documents array', () => {
    expect(columnHasExpandableObjects([], 'address')).toBe(false)
  })

  it('returns true for empty objects', () => {
    const docs: MongoDocument[] = [{ metadata: {} }]
    expect(columnHasExpandableObjects(docs, 'metadata')).toBe(true)
  })

  it('handles nested column paths', () => {
    const docs: MongoDocument[] = [{ user: { profile: { settings: { theme: 'dark' } } } }]
    expect(columnHasExpandableObjects(docs, 'user.profile.settings')).toBe(true)
  })

  it('returns false for nested BSON types', () => {
    const docs: MongoDocument[] = [{ user: { createdAt: { $date: '2023-01-01' } } }]
    expect(columnHasExpandableObjects(docs, 'user.createdAt')).toBe(false)
  })
})

describe('getDefaultColumnWidth', () => {
  // Constants from implementation - referenced in comments for documentation
  // CHAR_WIDTH = 8, HEADER_PADDING = 40

  it('uses name width for short-named boolean column', () => {
    // "ok" = 2 chars * 8 + 40 = 56, but min is 60
    // boolean type = 50, so max(60, 50) = 60
    const docs: MongoDocument[] = [{ ok: true }]
    expect(getDefaultColumnWidth('ok', docs)).toBe(60)
  })

  it('uses name width for long-named boolean column', () => {
    // "Successful" = 10 chars * 8 + 40 = 120
    // boolean type = 50, so max(120, 50) = 120
    const docs: MongoDocument[] = [{ Successful: true }]
    expect(getDefaultColumnWidth('Successful', docs)).toBe(120)
  })

  it('uses type width for date column with short name', () => {
    // "ts" = 2 chars * 8 + 40 = 56
    // date type = 230, so max(56, 230) = 230
    const docs: MongoDocument[] = [{ ts: { $date: '2023-01-01' } }]
    expect(getDefaultColumnWidth('ts', docs)).toBe(230)
  })

  it('uses type width for date column with medium name', () => {
    // "FinishedAt" = 10 chars * 8 + 40 = 120
    // date type = 230, so max(120, 230) = 230
    const docs: MongoDocument[] = [{ FinishedAt: { $date: '2023-01-01' } }]
    expect(getDefaultColumnWidth('FinishedAt', docs)).toBe(230)
  })

  it('uses type width for uuid', () => {
    // "id" = 2 chars * 8 + 40 = 56
    // uuid type = 290, so max(56, 290) = 290
    const docs: MongoDocument[] = [{ id: { $uuid: '550e8400-e29b-41d4-a716-446655440000' } }]
    expect(getDefaultColumnWidth('id', docs)).toBe(290)
  })

  it('uses type width for objectId', () => {
    // "_id" = 3 chars * 8 + 40 = 64
    // objectId type = 200, so max(64, 200) = 200
    const docs: MongoDocument[] = [{ _id: { $oid: '507f1f77bcf86cd799439011' } as ExtendedJsonObjectId }]
    expect(getDefaultColumnWidth('_id', docs)).toBe(200)
  })

  it('uses name width for long column name with small type', () => {
    // "isUserAuthenticated" = 19 chars * 8 + 40 = 192
    // boolean type = 50, so max(192, 50) = 192
    const docs: MongoDocument[] = [{ isUserAuthenticated: true }]
    expect(getDefaultColumnWidth('isUserAuthenticated', docs)).toBe(192)
  })

  it('caps at maximum width', () => {
    // "thisIsAnExtremelyLongColumnNameThatShouldBeTruncated" = 52 chars * 8 + 40 = 456
    // Should cap at 350
    const docs: MongoDocument[] = [{ thisIsAnExtremelyLongColumnNameThatShouldBeTruncated: 'value' }]
    expect(getDefaultColumnWidth('thisIsAnExtremelyLongColumnNameThatShouldBeTruncated', docs)).toBe(350)
  })

  it('respects minimum width', () => {
    // "x" = 1 char * 8 + 40 = 48, but min is 60
    // null type = 45, so max(48, 45) = 48, then max(48, 60) = 60
    const docs: MongoDocument[] = [{ x: null }]
    expect(getDefaultColumnWidth('x', docs)).toBe(60)
  })

  it('uses default string width when no documents', () => {
    // "name" = 4 chars * 8 + 40 = 72
    // no docs, so default string type = 120, max(72, 120) = 120
    expect(getDefaultColumnWidth('name', [])).toBe(120)
  })

  it('handles nested column paths using leaf name', () => {
    // "active" (leaf) = 6 chars * 8 + 40 = 88
    // boolean type = 50, so max(88, 50) = 88
    const docs: MongoDocument[] = [{ user: { profile: { active: true } } }]
    expect(getDefaultColumnWidth('user.profile.active', docs)).toBe(88)
  })

  it('handles missing values in documents', () => {
    // Falls back to string type width
    const docs: MongoDocument[] = [{ a: 1 }, { b: 2 }]
    const result = getDefaultColumnWidth('c', docs)
    // "c" = 1 char * 8 + 40 = 48, string = 120, max = 120
    expect(result).toBe(120)
  })

  it('detects predominant type from multiple values', () => {
    // 3 booleans, 1 string - should use boolean width
    const docs: MongoDocument[] = [
      { status: true },
      { status: false },
      { status: true },
      { status: 'unknown' }
    ]
    // "status" = 6 chars * 8 + 40 = 88
    // boolean type = 50, max(88, 50) = 88
    expect(getDefaultColumnWidth('status', docs)).toBe(88)
  })
})

describe('loadHiddenColumns', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns empty set when no data stored', () => {
    const result = loadHiddenColumns('conn1', 'db1', 'coll1')
    expect(result).toEqual(new Set())
  })

  it('returns stored hidden columns for specific collection', () => {
    const data = {
      'conn1:db1:coll1': ['field1', 'field2'],
      'conn1:db1:coll2': ['other']
    }
    localStorage.setItem('mongopal-hidden-columns', JSON.stringify(data))

    const result = loadHiddenColumns('conn1', 'db1', 'coll1')
    expect(result).toEqual(new Set(['field1', 'field2']))
  })

  it('returns empty set for collection with no hidden columns', () => {
    const data = {
      'conn1:db1:coll1': ['field1']
    }
    localStorage.setItem('mongopal-hidden-columns', JSON.stringify(data))

    const result = loadHiddenColumns('conn1', 'db1', 'coll2')
    expect(result).toEqual(new Set())
  })

  it('handles invalid JSON gracefully', () => {
    localStorage.setItem('mongopal-hidden-columns', 'invalid json')

    const result = loadHiddenColumns('conn1', 'db1', 'coll1')
    expect(result).toEqual(new Set())
  })
})

describe('saveHiddenColumns', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('saves hidden columns for a collection', () => {
    const hiddenSet = new Set(['field1', 'field2'])
    saveHiddenColumns('conn1', 'db1', 'coll1', hiddenSet)

    const stored = JSON.parse(localStorage.getItem('mongopal-hidden-columns')!)
    expect(stored['conn1:db1:coll1']).toEqual(['field1', 'field2'])
  })

  it('preserves existing data for other collections', () => {
    const existingData = {
      'conn1:db1:coll2': ['existingField']
    }
    localStorage.setItem('mongopal-hidden-columns', JSON.stringify(existingData))

    saveHiddenColumns('conn1', 'db1', 'coll1', new Set(['newField']))

    const stored = JSON.parse(localStorage.getItem('mongopal-hidden-columns')!)
    expect(stored['conn1:db1:coll1']).toEqual(['newField'])
    expect(stored['conn1:db1:coll2']).toEqual(['existingField'])
  })

  it('updates existing hidden columns for same collection', () => {
    const existingData = {
      'conn1:db1:coll1': ['oldField']
    }
    localStorage.setItem('mongopal-hidden-columns', JSON.stringify(existingData))

    saveHiddenColumns('conn1', 'db1', 'coll1', new Set(['newField1', 'newField2']))

    const stored = JSON.parse(localStorage.getItem('mongopal-hidden-columns')!)
    expect(stored['conn1:db1:coll1']).toEqual(['newField1', 'newField2'])
  })

  it('saves empty set as empty array', () => {
    saveHiddenColumns('conn1', 'db1', 'coll1', new Set())

    const stored = JSON.parse(localStorage.getItem('mongopal-hidden-columns')!)
    expect(stored['conn1:db1:coll1']).toEqual([])
  })
})

describe('buildExclusionProjection', () => {
  it('returns empty string for empty set', () => {
    expect(buildExclusionProjection(new Set())).toBe('')
  })

  it('returns empty string for empty array', () => {
    expect(buildExclusionProjection([])).toBe('')
  })

  it('returns empty string for null/undefined', () => {
    expect(buildExclusionProjection(null)).toBe('')
    expect(buildExclusionProjection(undefined)).toBe('')
  })

  it('builds exclusion projection from Set', () => {
    const hidden = new Set(['field1', 'field2'])
    const result = buildExclusionProjection(hidden)
    const parsed = JSON.parse(result)
    expect(parsed).toEqual({ field1: 0, field2: 0 })
  })

  it('builds exclusion projection from Array', () => {
    const hidden = ['field1', 'field2']
    const result = buildExclusionProjection(hidden)
    const parsed = JSON.parse(result)
    expect(parsed).toEqual({ field1: 0, field2: 0 })
  })

  it('excludes _id from exclusion projection', () => {
    const hidden = new Set(['_id', 'field1'])
    const result = buildExclusionProjection(hidden)
    const parsed = JSON.parse(result)
    expect(parsed).toEqual({ field1: 0 })
    expect(parsed._id).toBeUndefined()
  })

  it('returns empty string when only _id is hidden', () => {
    const hidden = new Set(['_id'])
    expect(buildExclusionProjection(hidden)).toBe('')
  })

  it('handles single field', () => {
    const hidden = new Set(['singleField'])
    const result = buildExclusionProjection(hidden)
    const parsed = JSON.parse(result)
    expect(parsed).toEqual({ singleField: 0 })
  })

  it('handles nested field paths', () => {
    const hidden = new Set(['user.profile', 'address.city'])
    const result = buildExclusionProjection(hidden)
    const parsed = JSON.parse(result)
    expect(parsed).toEqual({ 'user.profile': 0, 'address.city': 0 })
  })
})
