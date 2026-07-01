/**
 * Pure utility functions for TableView component.
 * These functions are extracted for testability and reusability.
 */

import { formatExtendedJsonValue, stringifyExtendedJsonShell } from './ejsonShell'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * MongoDB Extended JSON ObjectId
 */
export interface ExtendedJsonObjectId {
  $oid: string
}

/**
 * MongoDB Extended JSON Binary
 */
export interface ExtendedJsonBinary {
  $binary: {
    base64?: string
    subType: string
  }
}

/**
 * MongoDB Extended JSON UUID
 */
export interface ExtendedJsonUuid {
  $uuid: string
}

/**
 * MongoDB Extended JSON Date with $numberLong format
 */
export interface ExtendedJsonDateNumberLong {
  $date: {
    $numberLong: string
  }
}

/**
 * MongoDB Extended JSON Date
 */
export interface ExtendedJsonDate {
  $date: string | { $numberLong: string }
}

/**
 * MongoDB Extended JSON NumberLong
 */
export interface ExtendedJsonNumberLong {
  $numberLong: string
}

/**
 * MongoDB Extended JSON NumberInt
 */
export interface ExtendedJsonNumberInt {
  $numberInt: string
}

/**
 * MongoDB Extended JSON NumberDouble
 */
export interface ExtendedJsonNumberDouble {
  $numberDouble: string
}

/**
 * MongoDB Extended JSON Timestamp
 */
export interface ExtendedJsonTimestamp {
  $timestamp: {
    t: number
    i: number
  }
}

/**
 * MongoDB Extended JSON Regular Expression
 */
export interface ExtendedJsonRegularExpression {
  $regularExpression: {
    pattern: string
    options?: string
  }
}

/**
 * MongoDB Extended JSON MinKey
 */
export interface ExtendedJsonMinKey {
  $minKey: number
}

/**
 * MongoDB Extended JSON MaxKey
 */
export interface ExtendedJsonMaxKey {
  $maxKey: number
}

/**
 * Union type for all MongoDB Extended JSON special types
 */
export type ExtendedJsonType =
  | ExtendedJsonObjectId
  | ExtendedJsonBinary
  | ExtendedJsonUuid
  | ExtendedJsonDate
  | ExtendedJsonNumberLong
  | ExtendedJsonNumberInt
  | ExtendedJsonNumberDouble
  | ExtendedJsonTimestamp
  | ExtendedJsonRegularExpression
  | ExtendedJsonMinKey
  | ExtendedJsonMaxKey

/**
 * MongoDB document ID - can be string, ObjectId, or other Extended JSON types
 */
export type DocumentId = string | ExtendedJsonObjectId | ExtendedJsonBinary | ExtendedJsonUuid | number | unknown

/**
 * MongoDB document with flexible _id and any other fields
 */
export interface MongoDocument {
  _id?: DocumentId
  [key: string]: unknown
}

/**
 * Value types returned by formatValue
 */
export type FormattedValueType =
  | 'null'
  | 'undefined'
  | 'boolean'
  | 'number'
  | 'string'
  | 'array'
  | 'date'
  | 'objectId'
  | 'numberLong'
  | 'numberInt'
  | 'numberDouble'
  | 'binary'
  | 'uuid'
  | 'object'
  | 'unknown'

/**
 * Base formatted value result
 */
export interface FormattedValueBase {
  type: FormattedValueType
  display: string
}

/**
 * Formatted value for null type
 */
export interface FormattedValueNull extends FormattedValueBase {
  type: 'null'
}

/**
 * Formatted value for undefined type
 */
export interface FormattedValueUndefined extends FormattedValueBase {
  type: 'undefined'
}

/**
 * Formatted value for boolean type
 */
export interface FormattedValueBoolean extends FormattedValueBase {
  type: 'boolean'
  boolValue: boolean
}

/**
 * Formatted value for number type
 */
export interface FormattedValueNumber extends FormattedValueBase {
  type: 'number'
}

/**
 * Formatted value for string type
 */
export interface FormattedValueString extends FormattedValueBase {
  type: 'string'
  truncated?: boolean
}

/**
 * Formatted value for array type
 */
export interface FormattedValueArray extends FormattedValueBase {
  type: 'array'
  length: number
}

/**
 * Formatted value for date type
 */
export interface FormattedValueDate extends FormattedValueBase {
  type: 'date'
  invalid?: boolean
}

/**
 * Formatted value for objectId type
 */
export interface FormattedValueObjectId extends FormattedValueBase {
  type: 'objectId'
  fullId: string
}

/**
 * Formatted value for numberLong type
 */
export interface FormattedValueNumberLong extends FormattedValueBase {
  type: 'numberLong'
}

/**
 * Formatted value for numberInt type
 */
export interface FormattedValueNumberInt extends FormattedValueBase {
  type: 'numberInt'
}

/**
 * Formatted value for numberDouble type
 */
export interface FormattedValueNumberDouble extends FormattedValueBase {
  type: 'numberDouble'
}

/**
 * Formatted value for binary type
 */
export interface FormattedValueBinary extends FormattedValueBase {
  type: 'binary'
  base64: string
}

/**
 * Formatted value for uuid type
 */
export interface FormattedValueUuid extends FormattedValueBase {
  type: 'uuid'
  uuid: string
}

/**
 * Formatted value for object type
 */
export interface FormattedValueObject extends FormattedValueBase {
  type: 'object'
}

/**
 * Formatted value for unknown type
 */
export interface FormattedValueUnknown extends FormattedValueBase {
  type: 'unknown'
}

/**
 * Union type for all formatted value results
 */
export type FormattedValue =
  | FormattedValueNull
  | FormattedValueUndefined
  | FormattedValueBoolean
  | FormattedValueNumber
  | FormattedValueString
  | FormattedValueArray
  | FormattedValueDate
  | FormattedValueObjectId
  | FormattedValueNumberLong
  | FormattedValueNumberInt
  | FormattedValueNumberDouble
  | FormattedValueBinary
  | FormattedValueUuid
  | FormattedValueObject
  | FormattedValueUnknown

/**
 * Type content widths mapping
 */
type TypeContentWidths = {
  [K in FormattedValueType]: number
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Get document ID as string for selection tracking and API calls.
 * For ObjectId: returns hex string; For complex types: returns Extended JSON.
 * @param doc - MongoDB document
 * @returns Document ID as string or null
 */
export function getDocId(doc: MongoDocument | null | undefined): string | null {
  if (!doc || !doc._id) return null
  if (typeof doc._id === 'string') return doc._id
  if (typeof doc._id === 'object' && doc._id !== null && '$oid' in doc._id) {
    return (doc._id as ExtendedJsonObjectId).$oid
  }
  // For Binary, UUID, and other complex types, return Extended JSON
  return JSON.stringify(doc._id)
}

/**
 * Format a value for display (returns object with type and display string).
 * @param value - The value to format
 * @returns Formatted value info
 */
export function formatValue(value: unknown): FormattedValue {
  if (value === null) {
    return { type: 'null', display: 'null' }
  }
  if (value === undefined) {
    return { type: 'undefined', display: 'undefined' }
  }
  if (typeof value === 'boolean') {
    return { type: 'boolean', display: String(value), boolValue: value }
  }
  if (typeof value === 'number') {
    return { type: 'number', display: String(value) }
  }
  if (typeof value === 'string') {
    // Truncate long strings
    if (value.length > 50) {
      return { type: 'string', display: value.slice(0, 50) + '...', truncated: true }
    }
    return { type: 'string', display: value }
  }
  if (Array.isArray(value)) {
    return { type: 'array', display: `[${value.length} items]`, length: value.length }
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    // Check for special BSON types
    if (obj.$date !== undefined) {
      try {
        // Handle both string and { $numberLong: "..." } formats
        const dateField = obj.$date
        const dateValue = typeof dateField === 'object' && dateField !== null && '$numberLong' in dateField
          ? parseInt((dateField as { $numberLong: string }).$numberLong, 10)
          : dateField
        const date = new Date(dateValue as string | number)
        if (isNaN(date.getTime())) {
          return { type: 'date', display: 'Invalid Date', invalid: true }
        }
        return { type: 'date', display: date.toISOString() }
      } catch {
        return { type: 'date', display: 'Invalid Date', invalid: true }
      }
    }
    if (obj.$oid) {
      const oid = obj.$oid as string
      return { type: 'objectId', display: `ObjectId("${oid.slice(0, 8)}...")`, fullId: oid }
    }
    if (obj.$numberLong) {
      return { type: 'numberLong', display: formatExtendedJsonValue(obj) || (obj.$numberLong as string) }
    }
    if (obj.$numberInt) {
      return { type: 'numberInt', display: formatExtendedJsonValue(obj) || (obj.$numberInt as string) }
    }
    if (obj.$numberDouble) {
      return { type: 'numberDouble', display: formatExtendedJsonValue(obj) || (obj.$numberDouble as string) }
    }
    if (obj.$binary) {
      const binary = obj.$binary as { base64?: string }
      const base64 = binary.base64 || ''
      return { type: 'binary', display: `Binary("${base64.slice(0, 12)}...")`, base64 }
    }
    if (obj.$uuid) {
      const uuid = obj.$uuid as string
      return { type: 'uuid', display: `UUID("${uuid.slice(0, 8)}...")`, uuid }
    }
    return { type: 'object', display: '{...}' }
  }
  return { type: 'unknown', display: String(value) }
}

/**
 * Get raw value for copying to clipboard.
 * Large values are truncated to prevent browser freezing (LDH-06).
 * @param value - The value to convert
 * @param maxSize - Maximum string size in characters (default 1 MB)
 * @returns String representation of the value
 */
export function getRawValue(value: unknown, maxSize: number = 1024 * 1024): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'object') {
    const json = stringifyExtendedJsonShell(value, 2)
    if (json.length > maxSize) {
      return json.slice(0, maxSize) + '\n\n// ... Truncated (' + (json.length / 1024).toFixed(0) + ' KB total)'
    }
    return json
  }
  return String(value)
}

/**
 * Truncate an array for display, returning a limited subset with metadata.
 * Used to prevent rendering thousands of array elements (LDH-06).
 * @param arr - The array to truncate
 * @param limit - Maximum number of elements to show (default 20)
 * @returns Object with truncated items, total count, and whether it was truncated
 */
export function truncateArrayForDisplay<T>(arr: T[], limit: number = 20): { items: T[]; total: number; truncated: boolean } {
  if (arr.length <= limit) {
    return { items: arr, total: arr.length, truncated: false }
  }
  return { items: arr.slice(0, limit), total: arr.length, truncated: true }
}

/**
 * Get value at a dot-notation path (e.g., "address.city").
 * @param obj - Object to traverse
 * @param path - Dot-notation path
 * @returns Value at path or undefined
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  if (!path) return undefined
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Check if a value is a plain nested object (not a BSON type).
 * @param value - Value to check
 * @returns True if value is an expandable object
 */
export function isExpandableObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const obj = value as Record<string, unknown>
  // Check for special BSON types - these should NOT be expanded
  if (obj.$date !== undefined) return false
  if (obj.$oid) return false
  if (obj.$numberLong) return false
  if (obj.$numberInt) return false
  if (obj.$numberDouble) return false
  if (obj.$binary) return false
  if (obj.$uuid) return false
  if (obj.$timestamp) return false
  if (obj.$regularExpression) return false
  if (obj.$minKey) return false
  if (obj.$maxKey) return false
  return true
}

/**
 * Get sub-keys from a nested object across all documents.
 * @param documents - Array of documents
 * @param columnPath - Dot-notation path to the column
 * @returns Sorted array of sub-key names
 */
export function getNestedKeys(documents: MongoDocument[], columnPath: string): string[] {
  const subKeys = new Set<string>()
  documents.forEach(doc => {
    const value = getNestedValue(doc, columnPath)
    if (isExpandableObject(value)) {
      Object.keys(value).forEach(key => subKeys.add(key))
    }
  })
  return Array.from(subKeys).sort()
}

/**
 * Check if a column contains expandable objects in any document.
 * @param documents - Array of documents
 * @param columnPath - Dot-notation path to the column
 * @returns True if column has expandable objects
 */
export function columnHasExpandableObjects(documents: MongoDocument[], columnPath: string): boolean {
  return documents.some(doc => {
    const value = getNestedValue(doc, columnPath)
    return isExpandableObject(value)
  })
}

/**
 * Extract columns from documents, handling expanded columns.
 * @param documents - Array of documents
 * @param expandedColumns - Set of expanded column paths
 * @param maxDepth - Maximum nesting depth for column expansion (default 3)
 * @returns Array of column names/paths
 */
export function extractColumns(documents: MongoDocument[], expandedColumns: Set<string> = new Set(), maxDepth: number = 3): string[] {
  const columnSet = new Set<string>()
  documents.forEach(doc => {
    Object.keys(doc).forEach(key => columnSet.add(key))
  })

  // Sort columns: _id first, then alphabetically
  const columns = Array.from(columnSet).sort((a, b) => {
    if (a === '_id') return -1
    if (b === '_id') return 1
    return a.localeCompare(b)
  })

  // Expand columns that are marked as expanded, respecting maxDepth
  const result: string[] = []

  function expandColumn(colPath: string, depth: number): void {
    if (!expandedColumns.has(colPath) || depth >= maxDepth) {
      result.push(colPath)
      return
    }

    const subKeys = getNestedKeys(documents, colPath)
    if (subKeys.length > 0) {
      subKeys.forEach(subKey => {
        const subPath = `${colPath}.${subKey}`
        expandColumn(subPath, depth + 1)
      })
    } else {
      result.push(colPath)
    }
  }

  for (const col of columns) {
    expandColumn(col, 0)
  }

  return result
}

/**
 * Typical content widths by value type (in pixels).
 * Based on actual rendered content width.
 */
const TYPE_CONTENT_WIDTHS: TypeContentWidths = {
  boolean: 50,       // "true" / "false"
  null: 45,          // "null"
  undefined: 45,     // "undefined"
  number: 80,        // typical numbers
  numberInt: 105,
  numberLong: 190,
  numberDouble: 145,
  objectId: 200,     // ObjectId("12345678...")
  uuid: 290,         // UUID("12345678-1234-1234-1234-123456789012")
  binary: 160,       // Binary("...")
  date: 230,         // 2026-01-08T16:00:00.000Z (24 chars)
  array: 90,         // [5 items]
  object: 60,        // {...}
  string: 120,       // variable, moderate default
  unknown: 100,
}

const CHAR_WIDTH = 8          // Approximate px per character for column header
const HEADER_PADDING = 40     // Extra padding for header (sort icon, etc.)
const MAX_COLUMN_WIDTH = 350
const MIN_COLUMN_WIDTH = 60

// localStorage key for hidden columns per collection
const HIDDEN_COLUMNS_KEY = 'mongopal-hidden-columns'

/**
 * Storage data structure for hidden columns
 */
interface HiddenColumnsStorage {
  [key: string]: string[]
}

/**
 * Load hidden columns from localStorage for a specific collection.
 * @param connectionId - Connection ID
 * @param database - Database name
 * @param collection - Collection name
 * @returns Set of hidden column names
 */
export function loadHiddenColumns(connectionId: string, database: string, collection: string): Set<string> {
  try {
    const stored = localStorage.getItem(HIDDEN_COLUMNS_KEY)
    if (stored) {
      const data: HiddenColumnsStorage = JSON.parse(stored)
      const key = `${connectionId}:${database}:${collection}`
      return new Set(data[key] || [])
    }
  } catch (err) {
    console.error('Failed to load hidden columns:', err)
  }
  return new Set()
}

/**
 * Save hidden columns to localStorage for a specific collection.
 * @param connectionId - Connection ID
 * @param database - Database name
 * @param collection - Collection name
 * @param hiddenColumns - Set of hidden column names
 */
export function saveHiddenColumns(connectionId: string, database: string, collection: string, hiddenColumns: Set<string>): void {
  try {
    const stored = localStorage.getItem(HIDDEN_COLUMNS_KEY)
    const data: HiddenColumnsStorage = stored ? JSON.parse(stored) : {}
    const key = `${connectionId}:${database}:${collection}`
    data[key] = Array.from(hiddenColumns)
    localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify(data))
  } catch (err) {
    console.error('Failed to save hidden columns:', err)
  }
}

/**
 * Build a MongoDB exclusion projection from hidden columns.
 * @param hiddenColumns - Set or array of hidden column names
 * @returns MongoDB projection JSON string like '{"field1": 0, "field2": 0}'
 */
export function buildExclusionProjection(hiddenColumns: Set<string> | string[] | null | undefined): string {
  const cols = hiddenColumns instanceof Set ? Array.from(hiddenColumns) : hiddenColumns
  if (!cols || cols.length === 0) return ''

  // Filter out _id from exclusion - you can't mix _id: 0 with other field exclusions
  // unless it's the only field being excluded
  const fieldsToExclude = cols.filter(col => col !== '_id')
  if (fieldsToExclude.length === 0) return ''

  const projection: Record<string, 0> = {}
  fieldsToExclude.forEach(col => {
    projection[col] = 0
  })
  return JSON.stringify(projection)
}

/**
 * Get the default column width based on column name length and value type.
 * Returns the larger of: (name length * char width) or (type content width),
 * capped at maximum.
 *
 * @param columnName - The column name (may include dots for nested)
 * @param documents - Array of documents to sample
 * @param sampleSize - Number of documents to sample (default 5)
 * @returns Recommended column width in pixels
 */
export function getDefaultColumnWidth(columnName: string, documents: MongoDocument[], sampleSize: number = 5): number {
  // Get leaf name for nested columns (e.g., "user.profile.name" -> "name")
  const leafName = columnName.includes('.') ? columnName.split('.').pop()! : columnName

  // Width based on column name length
  const nameWidth = (leafName.length * CHAR_WIDTH) + HEADER_PADDING

  // Detect predominant type from sampled documents
  let typeWidth = TYPE_CONTENT_WIDTHS.string // default

  if (documents && documents.length > 0) {
    const typeCounts: Record<string, number> = {}
    const sampled = documents.slice(0, sampleSize)

    for (const doc of sampled) {
      const value = getNestedValue(doc, columnName)
      if (value === undefined) continue
      const formatted = formatValue(value)
      typeCounts[formatted.type] = (typeCounts[formatted.type] || 0) + 1
    }

    // Find most common type
    let maxCount = 0
    let predominantType: FormattedValueType = 'string'
    for (const [type, count] of Object.entries(typeCounts)) {
      if (count > maxCount) {
        maxCount = count
        predominantType = type as FormattedValueType
      }
    }

    typeWidth = TYPE_CONTENT_WIDTHS[predominantType] || TYPE_CONTENT_WIDTHS.string
  }

  // Take the larger of name width or type width, within bounds
  const width = Math.max(nameWidth, typeWidth)
  return Math.max(MIN_COLUMN_WIDTH, Math.min(width, MAX_COLUMN_WIDTH))
}
