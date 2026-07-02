/**
 * Recursive-descent parser for the F076 SQL subset.
 *
 * Produces the SQLQuery AST from tokens. Emits friendly, position-carrying
 * errors — rejected keywords (JOIN/DELETE/OFFSET/…) get actionable hints
 * rather than "unexpected token". See tickets/F076_SQL_QUERY_CONVERTER.md.
 */

import { tokenize, Token, TokenType, TokenizeError } from './tokenizer'
import type {
  SQLQuery, WhereExpr, SQLValue, FieldExpr, OrderByExpr, AggregateFn, ComparisonOp,
} from './types'

export class ParseError extends Error {
  position?: number
  constructor(message: string, position?: number) {
    super(message)
    this.name = 'ParseError'
    this.position = position
  }
}

const AGGREGATE_FNS = new Set<AggregateFn>(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'])
const COMPARISON_OPS = new Set<ComparisonOp>(['=', '!=', '<>', '<', '>', '<=', '>='])

/**
 * Canonical synthetic name for an unaliased aggregate in the $group output.
 * Shared with the transformer so HAVING references resolve. `COUNT(*)` →
 * `count_star`; dots in field names are sanitized (invalid in $group keys).
 */
export function syntheticAggName(fn: AggregateFn, field: string): string {
  const suffix = field === '*' ? 'star' : field.replace(/[.$]/g, '_')
  return `${fn.toLowerCase()}_${suffix}`
}

const UNSAFE_FIELD_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Reject field/alias names that would be interpreted as MongoDB operators or
 * JS prototype-pollution keys once embedded as object keys in the generated
 * filter/sort/group ($where, $expr, __proto__, ...). Applied to every
 * identifier that ends up as a query object key, regardless of quoting.
 */
function assertSafeFieldName(name: string, position: number): void {
  const parts = name.split('.')
  for (const part of parts) {
    if (part.startsWith('$')) {
      throw new ParseError(
        `Field names cannot start with '$' (found '${name}') — this would be interpreted as a MongoDB operator.`,
        position
      )
    }
    if (UNSAFE_FIELD_SEGMENTS.has(part)) {
      throw new ParseError(`'${part}' is not allowed as a field name.`, position)
    }
  }
}

function rejectionHint(value: string): string {
  switch (value) {
    case 'JOIN':
      return "JOIN is not supported — MongoDB uses $lookup in an aggregation pipeline for cross-collection queries."
    case 'OFFSET':
      return "OFFSET is not supported — use the pagination controls below the results instead."
    case 'DELETE':
    case 'UPDATE':
    case 'SET':
      return "DELETE/UPDATE are not supported in SQL mode — use the document editing UI."
    case 'INSERT':
    case 'INTO':
    case 'VALUES':
      return "INSERT is not supported in SQL mode — use the document editing UI."
    default:
      return `${value} is not supported in SQL mode.`
  }
}

class Parser {
  private tokens: Token[]
  private pos = 0

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(): Token {
    return this.tokens[this.pos]
  }

  private next(): Token {
    return this.tokens[this.pos++]
  }

  private atEnd(): boolean {
    return this.peek().type === 'eof'
  }

  private isKeyword(value: string): boolean {
    const t = this.peek()
    return t.type === 'keyword' && t.value === value
  }

  private guardRejected(): void {
    const t = this.peek()
    if (t.type === 'rejected') {
      throw new ParseError(rejectionHint(t.value), t.start)
    }
  }

  private expectKeyword(value: string): Token {
    this.guardRejected()
    const t = this.peek()
    if (t.type !== 'keyword' || t.value !== value) {
      throw new ParseError(`Expected ${value}${describeGot(t)}`, t.start)
    }
    return this.next()
  }

  private expectPunct(value: string): Token {
    this.guardRejected()
    const t = this.peek()
    if (t.type !== 'punct' || t.value !== value) {
      throw new ParseError(`Expected '${value}'${describeGot(t)}`, t.start)
    }
    return this.next()
  }

  parse(): SQLQuery {
    this.expectKeyword('SELECT')

    let distinct = false
    if (this.isKeyword('DISTINCT')) {
      this.next()
      distinct = true
    }

    const fields = this.parseFields()

    this.expectKeyword('FROM')
    const collection = this.parseCollectionName()

    const query: SQLQuery = { type: 'select', collection, fields }
    if (distinct) query.distinct = true

    if (this.isKeyword('WHERE')) {
      this.next()
      query.where = this.parseExpr()
    }

    if (this.isKeyword('GROUP')) {
      this.next()
      this.expectKeyword('BY')
      query.groupBy = this.parseIdentList()
    }

    if (this.isKeyword('HAVING')) {
      const havingTok = this.next()
      if (!query.groupBy || query.groupBy.length === 0) {
        throw new ParseError('HAVING requires a GROUP BY clause', havingTok.start)
      }
      query.having = this.parseExpr()
    }

    if (this.isKeyword('ORDER')) {
      this.next()
      this.expectKeyword('BY')
      query.orderBy = this.parseOrderBy()
    }

    if (this.isKeyword('LIMIT')) {
      this.next()
      query.limit = this.parseLimitValue()
    }

    // Anything left over is an error (with a friendly hint for rejected keywords).
    this.guardRejected()
    if (!this.atEnd()) {
      const t = this.peek()
      throw new ParseError(`Unexpected ${describeToken(t)}`, t.start)
    }

    return query
  }

  private parseCollectionName(): string {
    this.guardRejected()
    const t = this.peek()
    if (t.type !== 'identifier') {
      throw new ParseError(`Expected collection name after FROM${describeGot(t)}`, t.start)
    }
    return this.next().value
  }

  private parseFields(): FieldExpr[] {
    // SELECT * FROM ...
    const t = this.peek()
    if (t.type === 'punct' && t.value === '*') {
      this.next()
      return [{ type: 'star' }]
    }
    const fields: FieldExpr[] = [this.parseFieldExpr()]
    while (this.peek().type === 'punct' && this.peek().value === ',') {
      this.next()
      fields.push(this.parseFieldExpr())
    }
    return fields
  }

  private parseFieldExpr(): FieldExpr {
    this.guardRejected()
    const t = this.peek()

    // Aggregate function: COUNT(*) / SUM(field) [AS alias]
    if (t.type === 'keyword' && AGGREGATE_FNS.has(t.value as AggregateFn)) {
      const fn = this.next().value as AggregateFn
      this.expectPunct('(')
      let field: string
      const inner = this.peek()
      if (inner.type === 'punct' && inner.value === '*') {
        this.next()
        field = '*'
      } else if (inner.type === 'identifier') {
        field = this.next().value
        assertSafeFieldName(field, inner.start)
      } else {
        throw new ParseError(`Expected field name or * inside ${fn}()${describeGot(inner)}`, inner.start)
      }
      this.expectPunct(')')
      const alias = this.parseOptionalAlias()
      return alias
        ? { type: 'aggregate', fn, field, alias }
        : { type: 'aggregate', fn, field }
    }

    // Plain field [AS alias]
    if (t.type === 'identifier') {
      const name = this.next().value
      assertSafeFieldName(name, t.start)
      const alias = this.parseOptionalAlias()
      return alias ? { type: 'field', name, alias } : { type: 'field', name }
    }

    throw new ParseError(`Expected field name or * after SELECT${describeGot(t)}`, t.start)
  }

  private parseOptionalAlias(): string | undefined {
    if (this.isKeyword('AS')) {
      this.next()
      const t = this.peek()
      if (t.type !== 'identifier') {
        throw new ParseError(`Expected alias name after AS${describeGot(t)}`, t.start)
      }
      const alias = this.next().value
      assertSafeFieldName(alias, t.start)
      return alias
    }
    // Bare identifier alias (no AS)
    const t = this.peek()
    if (t.type === 'identifier') {
      const alias = this.next().value
      assertSafeFieldName(alias, t.start)
      return alias
    }
    return undefined
  }

  // expr → andExpr (OR andExpr)*
  private parseExpr(): WhereExpr {
    let left = this.parseAndExpr()
    while (this.isKeyword('OR')) {
      this.next()
      const right = this.parseAndExpr()
      left = { type: 'or', left, right }
    }
    return left
  }

  // andExpr → unaryExpr (AND unaryExpr)*
  private parseAndExpr(): WhereExpr {
    let left = this.parseUnaryExpr()
    while (this.isKeyword('AND')) {
      this.next()
      const right = this.parseUnaryExpr()
      left = { type: 'and', left, right }
    }
    return left
  }

  // unaryExpr → NOT unaryExpr | '(' expr ')' | comparison
  private parseUnaryExpr(): WhereExpr {
    this.guardRejected()
    if (this.isKeyword('NOT')) {
      this.next()
      return { type: 'not', expr: this.parseUnaryExpr() }
    }
    const t = this.peek()
    if (t.type === 'punct' && t.value === '(') {
      this.next()
      const inner = this.parseExpr()
      this.expectPunct(')')
      return inner
    }
    return this.parseComparison()
  }

  private parseComparison(): WhereExpr {
    const field = this.parseComparisonField()
    this.guardRejected()
    const t = this.peek()

    if (t.type === 'operator' && COMPARISON_OPS.has(t.value as ComparisonOp)) {
      const op = this.next().value as ComparisonOp
      const value = this.parseValue()
      return { type: 'comparison', field, op, value }
    }

    if (t.type === 'keyword' && t.value === 'IN') {
      this.next()
      const values = this.parseValueList()
      return { type: 'in', field, values }
    }

    if (t.type === 'keyword' && t.value === 'NOT') {
      this.next()
      // NOT IN (...) / NOT LIKE '...'
      if (this.isKeyword('IN')) {
        this.next()
        const values = this.parseValueList()
        return { type: 'in', field, values, negated: true }
      }
      if (this.isKeyword('LIKE')) {
        this.next()
        const pattern = this.parseStringLiteral('LIKE pattern')
        return { type: 'not', expr: { type: 'like', field, pattern } }
      }
      const bad = this.peek()
      throw new ParseError(`Expected IN or LIKE after NOT${describeGot(bad)}`, bad.start)
    }

    if (t.type === 'keyword' && t.value === 'BETWEEN') {
      this.next()
      const low = this.parseValue()
      this.expectKeyword('AND')
      const high = this.parseValue()
      return { type: 'between', field, low, high }
    }

    if (t.type === 'keyword' && t.value === 'LIKE') {
      this.next()
      const pattern = this.parseStringLiteral('LIKE pattern')
      return { type: 'like', field, pattern }
    }

    if (t.type === 'keyword' && t.value === 'IS') {
      this.next()
      let isNull = true
      if (this.isKeyword('NOT')) {
        this.next()
        isNull = false
      }
      const nullTok = this.peek()
      if (nullTok.type !== 'null') {
        throw new ParseError(`Expected NULL after IS${describeGot(nullTok)}`, nullTok.start)
      }
      this.next()
      return { type: 'null_check', field, isNull }
    }

    throw new ParseError(`Expected a comparison operator after '${field}'${describeGot(t)}`, t.start)
  }

  /** Field in a comparison: plain identifier, or an aggregate (HAVING) → synthetic name. */
  private parseComparisonField(): string {
    this.guardRejected()
    const t = this.peek()
    if (t.type === 'keyword' && AGGREGATE_FNS.has(t.value as AggregateFn)) {
      const fn = this.next().value as AggregateFn
      this.expectPunct('(')
      let field: string
      const inner = this.peek()
      if (inner.type === 'punct' && inner.value === '*') {
        this.next()
        field = '*'
      } else if (inner.type === 'identifier') {
        field = this.next().value
      } else {
        throw new ParseError(`Expected field name or * inside ${fn}()${describeGot(inner)}`, inner.start)
      }
      this.expectPunct(')')
      return syntheticAggName(fn, field)
    }
    if (t.type === 'identifier') {
      const name = this.next().value
      assertSafeFieldName(name, t.start)
      return name
    }
    throw new ParseError(`Expected field name${describeGot(t)}`, t.start)
  }

  private parseValueList(): SQLValue[] {
    this.expectPunct('(')
    const values: SQLValue[] = [this.parseValue()]
    while (this.peek().type === 'punct' && this.peek().value === ',') {
      this.next()
      values.push(this.parseValue())
    }
    this.expectPunct(')')
    return values
  }

  private parseValue(): SQLValue {
    this.guardRejected()
    const t = this.peek()

    // ObjectId('...') / ISODate('...')
    if (t.type === 'typefn') {
      const fn = this.next().value
      this.expectPunct('(')
      const raw = this.parseStringLiteral(`${fn} argument`)
      this.expectPunct(')')
      if (fn === 'ObjectId') {
        if (!/^[0-9a-fA-F]{24}$/.test(raw)) {
          throw new ParseError(`'${raw}' doesn't look like a valid ObjectId (must be 24 hex characters)`, t.start)
        }
        return { type: 'objectId', hex: raw }
      }
      // ISODate
      const ms = Date.parse(raw)
      if (Number.isNaN(ms)) {
        throw new ParseError(`'${raw}' is not a valid ISO date`, t.start)
      }
      return { type: 'date', iso: raw }
    }

    if (t.type === 'string') {
      this.next()
      return t.value
    }
    if (t.type === 'number') {
      this.next()
      const num = Number(t.value)
      if (Number.isNaN(num)) {
        throw new ParseError(`Invalid number '${t.value}'`, t.start)
      }
      return num
    }
    if (t.type === 'boolean') {
      this.next()
      return t.value === 'true'
    }
    if (t.type === 'null') {
      this.next()
      return null
    }

    throw new ParseError(`Expected a value${describeGot(t)}`, t.start)
  }

  private parseStringLiteral(context: string): string {
    this.guardRejected()
    const t = this.peek()
    if (t.type !== 'string') {
      throw new ParseError(`Expected a quoted string for ${context}${describeGot(t)}`, t.start)
    }
    return this.next().value
  }

  private parseIdentList(): string[] {
    const list: string[] = [this.parseIdentifier('field name')]
    while (this.peek().type === 'punct' && this.peek().value === ',') {
      this.next()
      list.push(this.parseIdentifier('field name'))
    }
    return list
  }

  private parseIdentifier(context: string): string {
    this.guardRejected()
    const t = this.peek()
    if (t.type !== 'identifier') {
      throw new ParseError(`Expected ${context}${describeGot(t)}`, t.start)
    }
    const name = this.next().value
    assertSafeFieldName(name, t.start)
    return name
  }

  private parseOrderBy(): OrderByExpr[] {
    const items: OrderByExpr[] = [this.parseOrderItem()]
    while (this.peek().type === 'punct' && this.peek().value === ',') {
      this.next()
      items.push(this.parseOrderItem())
    }
    return items
  }

  private parseOrderItem(): OrderByExpr {
    const field = this.parseOrderField()
    let direction: 'asc' | 'desc' = 'asc'
    if (this.isKeyword('ASC')) {
      this.next()
    } else if (this.isKeyword('DESC')) {
      this.next()
      direction = 'desc'
    }
    return { field, direction }
  }

  /** ORDER BY item: a field, or an aggregate (references the $group output name). */
  private parseOrderField(): string {
    this.guardRejected()
    const t = this.peek()
    if (t.type === 'keyword' && AGGREGATE_FNS.has(t.value as AggregateFn)) {
      const fn = this.next().value as AggregateFn
      this.expectPunct('(')
      let field: string
      const inner = this.peek()
      if (inner.type === 'punct' && inner.value === '*') {
        this.next()
        field = '*'
      } else if (inner.type === 'identifier') {
        field = this.next().value
      } else {
        throw new ParseError(`Expected field name or * inside ${fn}()${describeGot(inner)}`, inner.start)
      }
      this.expectPunct(')')
      return syntheticAggName(fn, field)
    }
    return this.parseIdentifier('field name in ORDER BY')
  }

  private parseLimitValue(): number {
    this.guardRejected()
    const t = this.peek()
    if (t.type !== 'number' || !/^\d+$/.test(t.value)) {
      throw new ParseError(`Expected a non-negative integer after LIMIT${describeGot(t)}`, t.start)
    }
    this.next()
    return Number.parseInt(t.value, 10)
  }
}

function describeToken(t: Token): string {
  if (t.type === 'eof') return 'end of query'
  return `token '${t.raw}'`
}

function describeGot(t: Token): string {
  if (t.type === 'eof') return ' but reached end of query'
  return `, got '${t.raw}'`
}

/** Parse SQL into an AST. Throws ParseError/TokenizeError (both carry a position). */
export function parse(sql: string): SQLQuery {
  let tokens: Token[]
  try {
    tokens = tokenize(sql)
  } catch (err) {
    if (err instanceof TokenizeError) {
      throw new ParseError(err.message, err.position)
    }
    throw err
  }
  return new Parser(tokens).parse()
}

// Re-export for consumers that only need token type names.
export type { TokenType }
