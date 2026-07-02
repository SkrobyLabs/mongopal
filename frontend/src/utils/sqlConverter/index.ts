/**
 * Public API for the F076 SQL → MongoDB converter.
 *
 * convertSQL wires tokenizer → parser → transformer → serializer and never
 * throws — parse/tokenize errors are returned as `{ ok: false, error, position }`.
 */

import { parse, ParseError } from './parser'
import { transform } from './transformer'
import { serializeFind, serializeAggregate } from './serializer'
import type { ConversionResult, ConverterDeps } from './types'

export function convertSQL(sql: string, deps: ConverterDeps): ConversionResult {
  const trimmed = sql.trim()
  if (!trimmed) {
    return { ok: false, error: 'Enter a SQL SELECT query.' }
  }

  try {
    const ast = parse(trimmed)
    const result = transform(ast, deps)

    if (result.kind === 'aggregate') {
      const { pipeline, preview } = serializeAggregate(result)
      return {
        ok: true,
        kind: 'aggregate',
        pipeline,
        preview,
        collection: result.collection,
        warnings: result.warnings,
      }
    }

    const { filter, projection, sort, limit, preview } = serializeFind(result)
    return {
      ok: true,
      kind: 'find',
      filter,
      projection,
      sort,
      limit,
      preview,
      collection: result.collection,
      warnings: result.warnings,
    }
  } catch (err) {
    if (err instanceof ParseError) {
      return { ok: false, error: err.message, position: err.position }
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export type {
  ConversionResult,
  ConversionFindResult,
  ConversionAggregateResult,
  ConversionError,
  ConverterDeps,
} from './types'
