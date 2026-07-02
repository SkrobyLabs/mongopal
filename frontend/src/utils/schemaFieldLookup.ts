/**
 * Shared schema field lookup, used by both the mongo and SQL completion
 * providers and the SQL transformer's coercion logic. Kept independent of
 * Monaco/editor code so non-UI consumers (like the transformer) don't pull
 * in editor-specific modules.
 */

import type { SchemaResult, SchemaField } from '../components/contexts/SchemaContext'

/**
 * Look up the type of a field path in the schema.
 * Navigates dot-separated paths through nested fields.
 */
export function getFieldType(schema: SchemaResult | null, fieldPath: string): string | undefined {
  if (!schema?.fields) return undefined

  const parts = fieldPath.split('.')
  let current: Record<string, SchemaField> | undefined = schema.fields

  for (let i = 0; i < parts.length; i++) {
    if (!current) return undefined
    const field: SchemaField | undefined = current[parts[i]]
    if (!field) return undefined

    if (i === parts.length - 1) {
      return field.type
    }

    // Navigate into nested fields or array element fields
    current = field.fields || field.arrayType?.fields
  }

  return undefined
}
