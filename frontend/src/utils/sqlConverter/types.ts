/**
 * AST and public-API type definitions for the SQL → MongoDB converter (F076).
 *
 * The AST is the intermediate representation shared by tokenizer → parser →
 * transformer → serializer. See tickets/F076_SQL_QUERY_CONVERTER.md.
 */

// =============================================================================
// AST
// =============================================================================

export type AggregateFn = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'

export type FieldExpr =
  | { type: 'field'; name: string; alias?: string }
  | { type: 'star' }
  | { type: 'aggregate'; fn: AggregateFn; field: string; alias?: string }

export type SQLValue =
  | string
  | number
  | boolean
  | null
  | { type: 'objectId'; hex: string } // ObjectId('...') or schema-coerced
  | { type: 'date'; iso: string } // ISODate('...') or schema-coerced

export type ComparisonOp = '=' | '!=' | '<>' | '<' | '>' | '<=' | '>='

export type WhereExpr =
  | { type: 'comparison'; field: string; op: ComparisonOp; value: SQLValue }
  | { type: 'in'; field: string; values: SQLValue[]; negated?: boolean }
  | { type: 'between'; field: string; low: SQLValue; high: SQLValue }
  | { type: 'like'; field: string; pattern: string }
  | { type: 'null_check'; field: string; isNull: boolean }
  | { type: 'and'; left: WhereExpr; right: WhereExpr }
  | { type: 'or'; left: WhereExpr; right: WhereExpr }
  | { type: 'not'; expr: WhereExpr }

export interface OrderByExpr {
  field: string
  direction: 'asc' | 'desc'
}

export interface SQLQuery {
  type: 'select'
  collection: string
  fields: FieldExpr[]
  where?: WhereExpr
  orderBy?: OrderByExpr[]
  limit?: number
  groupBy?: string[]
  having?: WhereExpr
  distinct?: boolean
}

// =============================================================================
// Public API result types
// =============================================================================

export interface ConversionFindResult {
  ok: true
  kind: 'find'
  filter: string // canonical EJSON, survives JSON.parse
  projection: string // canonical EJSON or ''
  sort: string // canonical EJSON or ''
  limit: number | null
  preview: string // mongosh-style display string
  collection: string
  warnings: string[]
}

export interface ConversionAggregateResult {
  ok: true
  kind: 'aggregate'
  pipeline: string // canonical EJSON array string
  preview: string
  collection: string
  warnings: string[]
}

export interface ConversionError {
  ok: false
  error: string
  position?: number
}

export type ConversionResult =
  | ConversionFindResult
  | ConversionAggregateResult
  | ConversionError

// =============================================================================
// Dependencies (schema-driven coercion)
// =============================================================================

import type { SchemaResult } from '../../components/contexts/SchemaContext'

export interface ConverterDeps {
  getSchema: () => SchemaResult | null
}
