/**
 * AST → MongoDB query object transformer for F076.
 *
 * Produces ONE plain JS query object (with EJSON-shaped values such as
 * {"$oid": ...} / {"$date": ...}) which the serializer renders twice — as
 * canonical EJSON for execution and as a mongosh display string for the
 * preview. Both derive from this single object so preview ≡ executed query.
 */

import type {
  SQLQuery, WhereExpr, SQLValue, ConverterDeps, AggregateFn,
} from './types'
import { syntheticAggName } from './parser'
import { getFieldType } from '../schemaFieldLookup'

export type EJSONValue =
  | string | number | boolean | null
  | { [key: string]: EJSONValue }
  | EJSONValue[]

export interface TransformFindResult {
  kind: 'find'
  collection: string
  filter: Record<string, EJSONValue>
  projection: Record<string, EJSONValue> | null
  sort: Record<string, EJSONValue> | null
  limit: number | null
  warnings: string[]
}

export interface TransformAggregateResult {
  kind: 'aggregate'
  collection: string
  pipeline: Record<string, EJSONValue>[]
  warnings: string[]
}

export type TransformResult = TransformFindResult | TransformAggregateResult

const OP_MAP: Record<string, string> = {
  '!=': '$ne',
  '<>': '$ne',
  '>': '$gt',
  '>=': '$gte',
  '<': '$lt',
  '<=': '$lte',
}

/** Whether a SELECT/GROUP shape requires the aggregation pipeline path. */
function isAggregateQuery(q: SQLQuery): boolean {
  if (q.groupBy && q.groupBy.length > 0) return true
  if (q.distinct) return true
  return q.fields.some((f) => f.type === 'aggregate')
}

export function transform(q: SQLQuery, deps: ConverterDeps): TransformResult {
  const warnings: string[] = []
  if (isAggregateQuery(q)) {
    return transformAggregate(q, deps, warnings)
  }
  return transformFind(q, deps, warnings)
}

// =============================================================================
// Find path
// =============================================================================

function transformFind(q: SQLQuery, deps: ConverterDeps, warnings: string[]): TransformFindResult {
  const filter = q.where ? whereToFilter(q.where, deps, warnings) : {}

  // Projection: explicit field list keeps _id (table view keys rows by _id).
  let projection: Record<string, EJSONValue> | null = null
  const hasStar = q.fields.some((f) => f.type === 'star')
  if (!hasStar) {
    projection = {}
    for (const f of q.fields) {
      if (f.type === 'field') {
        projection[f.name] = 1
      }
    }
    if (Object.keys(projection).length === 0) projection = null
  }

  let sort: Record<string, EJSONValue> | null = null
  if (q.orderBy && q.orderBy.length > 0) {
    sort = {}
    for (const item of q.orderBy) {
      sort[item.field] = item.direction === 'desc' ? -1 : 1
    }
  }

  return {
    kind: 'find',
    collection: q.collection,
    filter,
    projection,
    sort,
    limit: q.limit ?? null,
    warnings,
  }
}

// =============================================================================
// Aggregate path
// =============================================================================

function transformAggregate(q: SQLQuery, deps: ConverterDeps, warnings: string[]): TransformAggregateResult {
  const pipeline: Record<string, EJSONValue>[] = []

  if (q.where) {
    pipeline.push({ $match: whereToFilter(q.where, deps, warnings) })
  }

  if (q.distinct) {
    // SELECT DISTINCT field → group by that field.
    const field = firstPlainField(q)
    if (!field) {
      warnings.push('DISTINCT requires a single field; falling back to whole-document grouping')
    }
    pipeline.push({ $group: { _id: field ? `$${field}` : null } })
    if (q.orderBy && q.orderBy.length > 0) {
      pipeline.push({ $sort: buildAggregateSort(q) })
    }
    if (q.limit != null) pipeline.push({ $limit: q.limit })
    return { kind: 'aggregate', collection: q.collection, pipeline, warnings }
  }

  // $group
  const group: Record<string, EJSONValue> = { _id: buildGroupId(q) }
  for (const f of q.fields) {
    if (f.type !== 'aggregate') continue
    const name = f.alias ?? syntheticAggName(f.fn, f.field)
    group[name] = buildAccumulator(f.fn, f.field)
  }
  pipeline.push({ $group: group })

  // HAVING → $match on group output (aliases / synthetic names).
  if (q.having) {
    pipeline.push({ $match: whereToFilter(q.having, deps, warnings) })
  }

  if (q.orderBy && q.orderBy.length > 0) {
    pipeline.push({ $sort: buildAggregateSort(q) })
  }

  if (q.limit != null) pipeline.push({ $limit: q.limit })

  return { kind: 'aggregate', collection: q.collection, pipeline, warnings }
}

function firstPlainField(q: SQLQuery): string | null {
  for (const f of q.fields) {
    if (f.type === 'field') return f.name
  }
  return null
}

function buildGroupId(q: SQLQuery): EJSONValue {
  const fields = q.groupBy ?? []
  if (fields.length === 0) return null
  if (fields.length === 1) return `$${fields[0]}`
  const id: Record<string, EJSONValue> = {}
  for (const field of fields) {
    id[field.replace(/[.$]/g, '_')] = `$${field}`
  }
  return id
}

function buildAccumulator(fn: AggregateFn, field: string): EJSONValue {
  switch (fn) {
    case 'COUNT':
      if (field === '*') return { $sum: 1 }
      // COUNT(field) counts non-null values.
      return { $sum: { $cond: [{ $ne: [`$${field}`, null] }, 1, 0] } }
    case 'SUM':
      return { $sum: `$${field}` }
    case 'AVG':
      return { $avg: `$${field}` }
    case 'MIN':
      return { $min: `$${field}` }
    case 'MAX':
      return { $max: `$${field}` }
  }
}

/** Sort for the aggregate path; group-key fields map onto _id. */
function buildAggregateSort(q: SQLQuery): Record<string, EJSONValue> {
  const sort: Record<string, EJSONValue> = {}
  const groupBy = q.groupBy ?? []
  for (const item of q.orderBy ?? []) {
    const dir = item.direction === 'desc' ? -1 : 1
    if (groupBy.length === 1 && item.field === groupBy[0]) {
      sort['_id'] = dir
    } else if (groupBy.length > 1 && groupBy.includes(item.field)) {
      sort[`_id.${item.field.replace(/[.$]/g, '_')}`] = dir
    } else {
      sort[item.field] = dir
    }
  }
  return sort
}

// =============================================================================
// WHERE → filter
// =============================================================================

function whereToFilter(expr: WhereExpr, deps: ConverterDeps, warnings: string[]): Record<string, EJSONValue> {
  switch (expr.type) {
    case 'comparison': {
      const value = coerce(expr.field, expr.value, deps, warnings)
      if (expr.op === '=') return { [expr.field]: value }
      const mongoOp = OP_MAP[expr.op]
      return { [expr.field]: { [mongoOp]: value } }
    }
    case 'in': {
      const values = expr.values.map((v) => coerce(expr.field, v, deps, warnings))
      return { [expr.field]: { [expr.negated ? '$nin' : '$in']: values } }
    }
    case 'between': {
      const low = coerce(expr.field, expr.low, deps, warnings)
      const high = coerce(expr.field, expr.high, deps, warnings)
      return { [expr.field]: { $gte: low, $lte: high } }
    }
    case 'like': {
      return { [expr.field]: { $regex: likeToRegex(expr.pattern), $options: '' } }
    }
    case 'null_check': {
      // {f: null} matches null AND missing (Mongo semantics); $ne:null also excludes missing.
      return expr.isNull ? { [expr.field]: null } : { [expr.field]: { $ne: null } }
    }
    case 'or': {
      const branches = flattenOr(expr).map((e) => whereToFilter(e, deps, warnings))
      return { $or: branches }
    }
    case 'and': {
      const fragments = flattenAnd(expr).map((e) => whereToFilter(e, deps, warnings))
      return combineAnd(fragments)
    }
    case 'not': {
      return invert(expr.expr, deps, warnings)
    }
  }
}

function flattenAnd(expr: WhereExpr): WhereExpr[] {
  if (expr.type === 'and') return [...flattenAnd(expr.left), ...flattenAnd(expr.right)]
  return [expr]
}

function flattenOr(expr: WhereExpr): WhereExpr[] {
  if (expr.type === 'or') return [...flattenOr(expr.left), ...flattenOr(expr.right)]
  return [expr]
}

/**
 * Combine AND conjuncts. Uses explicit $and when a fragment carries a logical
 * operator or when keys collide (naive object-merge would silently drop a
 * clause). Otherwise merges into one object.
 */
function combineAnd(fragments: Record<string, EJSONValue>[]): Record<string, EJSONValue> {
  const keyCounts = new Map<string, number>()
  let hasLogical = false
  for (const frag of fragments) {
    for (const key of Object.keys(frag)) {
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1)
      if (key.startsWith('$')) hasLogical = true
    }
  }
  const hasDup = Array.from(keyCounts.values()).some((c) => c > 1)
  if (hasLogical || hasDup) {
    return { $and: fragments }
  }
  return Object.assign({}, ...fragments)
}

/** NOT expr → an inverted filter fragment. */
function invert(expr: WhereExpr, deps: ConverterDeps, warnings: string[]): Record<string, EJSONValue> {
  switch (expr.type) {
    case 'comparison': {
      const value = coerce(expr.field, expr.value, deps, warnings)
      switch (expr.op) {
        case '=': return { [expr.field]: { $ne: value } }
        case '!=':
        case '<>': return { [expr.field]: value }
        case '>': return { [expr.field]: { $lte: value } }
        case '>=': return { [expr.field]: { $lt: value } }
        case '<': return { [expr.field]: { $gte: value } }
        case '<=': return { [expr.field]: { $gt: value } }
      }
      break
    }
    case 'in': {
      const values = expr.values.map((v) => coerce(expr.field, v, deps, warnings))
      return { [expr.field]: { [expr.negated ? '$in' : '$nin']: values } }
    }
    case 'null_check':
      return expr.isNull ? { [expr.field]: { $ne: null } } : { [expr.field]: null }
    case 'like':
      return { [expr.field]: { $not: { $regex: likeToRegex(expr.pattern), $options: '' } } }
    case 'not':
      // Double negation.
      return whereToFilter(expr.expr, deps, warnings)
    default:
      // Compound (and/or/between): NOT(P) == NOR(P).
      return { $nor: [whereToFilter(expr, deps, warnings)] }
  }
  // Unreachable, satisfies the type checker.
  return { $nor: [whereToFilter(expr, deps, warnings)] }
}

// =============================================================================
// LIKE → regex
// =============================================================================

const REGEX_META = new Set(['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\'])

/**
 * Convert a SQL LIKE pattern to an anchored regex, escaping metacharacters first.
 * Collapses runs of consecutive '%' into one — `%%%` and `%` are equivalent for
 * LIKE matching, and collapsing avoids emitting adjacent `.*.*.*` groups, a
 * classic catastrophic-backtracking (ReDoS) shape run server-side via $regex.
 */
export function likeToRegex(pattern: string): string {
  const collapsed = pattern.replace(/%+/g, '%')
  let out = '^'
  for (const ch of collapsed) {
    if (ch === '%') out += '.*'
    else if (ch === '_') out += '.'
    else if (REGEX_META.has(ch)) out += '\\' + ch
    else out += ch
  }
  return out + '$'
}

// =============================================================================
// Coercion
// =============================================================================

function toEJSON(value: SQLValue): EJSONValue {
  if (value !== null && typeof value === 'object') {
    if (value.type === 'objectId') return { $oid: value.hex }
    if (value.type === 'date') return { $date: value.iso }
  }
  return value as EJSONValue
}

/**
 * Schema-driven coercion of bare strings. Coerces ONLY when the field's inferred
 * type is exactly a single coercible literal ("ObjectId" or "Date"). Union or
 * unknown types stay strings; unions containing a coercible type add a warning.
 * Explicit ObjectId()/ISODate() literals always pass through unchanged.
 */
function coerce(field: string, value: SQLValue, deps: ConverterDeps, warnings: string[]): EJSONValue {
  if (typeof value !== 'string') {
    return toEJSON(value)
  }

  const schema = deps.getSchema()
  const type = getFieldType(schema, field)
  if (!type) return value

  if (type === 'ObjectId') {
    if (/^[0-9a-fA-F]{24}$/.test(value)) {
      return { $oid: value }
    }
    warnings.push(`Field "${field}" is an ObjectId but "${value}" is not a 24-hex ObjectId; left as string.`)
    return value
  }

  if (type === 'Date') {
    if (!Number.isNaN(Date.parse(value))) {
      return { $date: value }
    }
    warnings.push(`Field "${field}" is a Date but "${value}" is not a valid date; left as string.`)
    return value
  }

  // Union type that includes a coercible literal — do not coerce, but warn.
  if (type.includes(' | ') && /(^|\s\|\s)(ObjectId|Date)(\s\||$)/.test(type)) {
    warnings.push(`Field "${field}" has mixed types (${type}); "${value}" left as string — use ObjectId()/ISODate() to force a type.`)
  }

  return value
}
