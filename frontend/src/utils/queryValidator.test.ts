import { describe, it, expect } from 'vitest'
import { validateQuery, toMonacoMarkers, VALID_QUERY_OPERATORS, QueryDiagnostic, MonacoInstance } from './queryValidator'

describe('validateQuery', () => {
  describe('valid queries', () => {
    it('returns empty array for empty query', () => {
      expect(validateQuery('')).toEqual([])
      expect(validateQuery(null)).toEqual([])
      expect(validateQuery(undefined)).toEqual([])
    })

    it('returns empty array for valid JSON filter', () => {
      expect(validateQuery('{}')).toEqual([])
      expect(validateQuery('{ "name": "test" }')).toEqual([])
    })

    it('returns empty array for valid find query', () => {
      expect(validateQuery('db.users.find({})')).toEqual([])
      expect(validateQuery('db.users.find({ "name": "test" })')).toEqual([])
    })

    it('returns empty array for valid query with operators', () => {
      expect(validateQuery('{ "$eq": 1 }')).toEqual([])
      expect(validateQuery('{ "age": { "$gt": 21 } }')).toEqual([])
      expect(validateQuery('{ "$and": [{ "a": 1 }, { "b": 2 }] }')).toEqual([])
    })

    it('returns empty array for valid nested query', () => {
      const query = '{ "user": { "name": { "$regex": "^test" } } }'
      expect(validateQuery(query)).toEqual([])
    })
  })

  describe('JSON syntax errors', () => {
    it('detects missing closing brace', () => {
      const result = validateQuery('{ "name": "test"')
      expect(result.some((d: QueryDiagnostic) => d.severity === 8 && d.message.includes('Unclosed'))).toBe(true)
    })

    it('detects missing closing bracket', () => {
      const result = validateQuery('{ "items": [1, 2, 3 }')
      expect(result.some((d: QueryDiagnostic) => d.severity === 8)).toBe(true)
    })

    it('detects extra closing brace', () => {
      const result = validateQuery('{ "name": "test" }}')
      expect(result.some((d: QueryDiagnostic) => d.severity === 8 && d.message.includes('Extra closing'))).toBe(true)
    })

    it('detects JSON parse errors', () => {
      const result = validateQuery('{ name: }')
      expect(result.some((d: QueryDiagnostic) => d.severity === 8 && d.message.includes('JSON syntax error'))).toBe(true)
    })
  })

  describe('unknown operators', () => {
    it('warns about unknown operators', () => {
      const result = validateQuery('{ "$unknownOp": 1 }')
      expect(result.some((d: QueryDiagnostic) =>
        d.severity === 4 && d.message.includes('Unknown operator')
      )).toBe(true)
    })

    it('suggests correct operator for typos', () => {
      const result = validateQuery('{ "$eqq": 1 }')
      expect(result.some((d: QueryDiagnostic) =>
        d.message.includes('$eqq') && d.message.includes('$eq')
      )).toBe(true)
    })

    it('suggests correct operator for $exsits typo', () => {
      const result = validateQuery('{ "field": { "$exsits": true } }')
      expect(result.some((d: QueryDiagnostic) =>
        d.message.includes('$exsits') && d.message.includes('$exists')
      )).toBe(true)
    })

    it('suggests correct operator for $exist typo', () => {
      const result = validateQuery('{ "field": { "$exist": true } }')
      expect(result.some((d: QueryDiagnostic) =>
        d.message.includes('$exist') && d.message.includes('$exists')
      )).toBe(true)
    })

    it('does not warn about valid operators', () => {
      const result = validateQuery('{ "$eq": 1, "$gt": 2, "$in": [1,2,3] }')
      expect(result.filter((d: QueryDiagnostic) => d.message.includes('Unknown operator'))).toEqual([])
    })
  })

  describe('common mistakes', () => {
    it('warns about trailing commas', () => {
      const result = validateQuery('{ "a": 1, "b": 2, }')
      expect(result.some((d: QueryDiagnostic) =>
        d.severity === 4 && d.message.includes('Trailing comma')
      )).toBe(true)
    })

    it('warns about string "true" instead of boolean', () => {
      const result = validateQuery('{ "active": "true" }')
      expect(result.some((d: QueryDiagnostic) =>
        d.severity === 4 && d.message.includes('boolean true')
      )).toBe(true)
    })

    it('warns about string "false" instead of boolean', () => {
      const result = validateQuery('{ "disabled": "false" }')
      expect(result.some((d: QueryDiagnostic) =>
        d.severity === 4 && d.message.includes('boolean false')
      )).toBe(true)
    })

    it('warns about string "null" instead of null', () => {
      const result = validateQuery('{ "value": "null" }')
      expect(result.some((d: QueryDiagnostic) =>
        d.severity === 4 && d.message.includes('null (without quotes)')
      )).toBe(true)
    })

    it('warns about single quotes', () => {
      const result = validateQuery("{ 'name': 'test' }")
      expect(result.some((d: QueryDiagnostic) =>
        d.severity === 4 && d.message.includes('Single quotes')
      )).toBe(true)
    })

    it('does not flag ObjectId() as error (auto-converted)', () => {
      const result = validateQuery('{ "_id": ObjectId("507f1f77bcf86cd799439011") }')
      expect(result.filter((d: QueryDiagnostic) => d.severity === 8)).toEqual([])
      expect(result.filter((d: QueryDiagnostic) => d.severity === 2 && d.message.includes('ObjectId'))).toEqual([])
    })

    it('does not flag ISODate() as error (auto-converted)', () => {
      const result = validateQuery('{ "date": ISODate("2023-01-01") }')
      expect(result.filter((d: QueryDiagnostic) => d.severity === 8)).toEqual([])
      expect(result.filter((d: QueryDiagnostic) => d.severity === 2 && d.message.includes('ISODate'))).toEqual([])
    })

    it('does not flag regex literals as error (auto-converted)', () => {
      const result = validateQuery('{ "name": /test/i }')
      expect(result.filter((d: QueryDiagnostic) => d.severity === 8)).toEqual([])
    })

    it('does not flag NumberInt() as error (auto-converted)', () => {
      const result = validateQuery('{ "count": NumberInt(42) }')
      expect(result.filter((d: QueryDiagnostic) => d.severity === 8)).toEqual([])
    })

    it('does not flag NumberLong() as error (auto-converted)', () => {
      const result = validateQuery('{ "big": NumberLong(9999999999) }')
      expect(result.filter((d: QueryDiagnostic) => d.severity === 8)).toEqual([])
    })

    it('does not flag new Date() as error (auto-converted)', () => {
      const result = validateQuery('{ "created": new Date("2023-06-15") }')
      expect(result.filter((d: QueryDiagnostic) => d.severity === 8)).toEqual([])
    })
  })

  describe('position tracking', () => {
    it('reports correct line for single-line query', () => {
      const result = validateQuery('{ "$unknownOp": 1 }')
      const diagnostic = result.find((d: QueryDiagnostic) => d.message.includes('Unknown operator'))
      expect(diagnostic).toBeDefined()
      expect(diagnostic!.startLine).toBe(1)
    })

    it('reports correct line for multiline query', () => {
      const query = `{
  "name": "test",
  "$badOp": 1
}`
      const result = validateQuery(query)
      const diagnostic = result.find((d: QueryDiagnostic) => d.message.includes('Unknown operator'))
      expect(diagnostic).toBeDefined()
      expect(diagnostic!.startLine).toBe(3)
    })

    it('reports correct position in find query', () => {
      const result = validateQuery('db.users.find({ "$badOp": 1 })')
      const diagnostic = result.find((d: QueryDiagnostic) => d.message.includes('Unknown operator'))
      expect(diagnostic).toBeDefined()
      expect(diagnostic!.startLine).toBe(1)
    })
  })

  describe('complex queries', () => {
    it('validates aggregation pipeline', () => {
      const query = 'db.users.aggregate([{ "$match": { "active": true } }])'
      const result = validateQuery(query)
      // Should not have errors for valid operators
      expect(result.filter((d: QueryDiagnostic) => d.severity === 8)).toEqual([])
    })

    it('validates nested operators', () => {
      const query = '{ "$and": [{ "age": { "$gte": 18 } }, { "status": { "$in": ["A", "B"] } }] }'
      const result = validateQuery(query)
      expect(result.filter((d: QueryDiagnostic) => d.severity === 8)).toEqual([])
    })

    it('handles multiple issues in one query', () => {
      const query = '{ "$badOp": 1, "active": "true", }'
      const result = validateQuery(query)
      // Should have: unknown operator, string boolean, trailing comma
      expect(result.length).toBeGreaterThanOrEqual(2)
    })
  })
})

describe('toMonacoMarkers', () => {
  it('returns empty array for no diagnostics', () => {
    const mockMonaco: MonacoInstance = {
      MarkerSeverity: { Error: 8, Warning: 4, Info: 2 }
    }
    expect(toMonacoMarkers(mockMonaco, [])).toEqual([])
    expect(toMonacoMarkers(mockMonaco, null)).toEqual([])
    expect(toMonacoMarkers(null, [])).toEqual([])
  })

  it('converts error severity correctly', () => {
    const mockMonaco: MonacoInstance = {
      MarkerSeverity: { Error: 8, Warning: 4, Info: 2 }
    }
    const diagnostics: QueryDiagnostic[] = [{
      message: 'Test error',
      severity: 8,
      startLine: 1,
      startCol: 1,
      endLine: 1,
      endCol: 10,
    }]
    const markers = toMonacoMarkers(mockMonaco, diagnostics)
    expect(markers[0].severity).toBe(8)
  })

  it('converts warning severity correctly', () => {
    const mockMonaco: MonacoInstance = {
      MarkerSeverity: { Error: 8, Warning: 4, Info: 2 }
    }
    const diagnostics: QueryDiagnostic[] = [{
      message: 'Test warning',
      severity: 4,
      startLine: 2,
      startCol: 5,
      endLine: 2,
      endCol: 15,
    }]
    const markers = toMonacoMarkers(mockMonaco, diagnostics)
    expect(markers[0].severity).toBe(4)
    expect(markers[0].startLineNumber).toBe(2)
    expect(markers[0].startColumn).toBe(5)
  })

  it('converts info severity correctly', () => {
    const mockMonaco: MonacoInstance = {
      MarkerSeverity: { Error: 8, Warning: 4, Info: 2 }
    }
    const diagnostics: QueryDiagnostic[] = [{
      message: 'Test info',
      severity: 2,
      startLine: 1,
      startCol: 1,
      endLine: 1,
      endCol: 5,
    }]
    const markers = toMonacoMarkers(mockMonaco, diagnostics)
    expect(markers[0].severity).toBe(2)
  })
})

describe('VALID_QUERY_OPERATORS', () => {
  it('contains common comparison operators', () => {
    expect(VALID_QUERY_OPERATORS.has('$eq')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$ne')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$gt')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$gte')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$lt')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$lte')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$in')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$nin')).toBe(true)
  })

  it('contains logical operators', () => {
    expect(VALID_QUERY_OPERATORS.has('$and')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$or')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$not')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$nor')).toBe(true)
  })

  it('contains element operators', () => {
    expect(VALID_QUERY_OPERATORS.has('$exists')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$type')).toBe(true)
  })

  it('contains array operators', () => {
    expect(VALID_QUERY_OPERATORS.has('$all')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$elemMatch')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$size')).toBe(true)
  })

  it('contains update operators', () => {
    expect(VALID_QUERY_OPERATORS.has('$set')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$unset')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$push')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$pull')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$inc')).toBe(true)
  })

  it('contains aggregation operators', () => {
    expect(VALID_QUERY_OPERATORS.has('$match')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$group')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$project')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$lookup')).toBe(true)
  })

  it('contains extended JSON type wrappers', () => {
    expect(VALID_QUERY_OPERATORS.has('$oid')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$date')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$binary')).toBe(true)
    expect(VALID_QUERY_OPERATORS.has('$numberLong')).toBe(true)
  })
})
