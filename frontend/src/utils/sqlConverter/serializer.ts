/**
 * Serializer for F076: renders the transformer's single query object twice —
 * canonical EJSON strings for execution, and a mongosh-style display string for
 * the preview panel. Both derive from the same object, guaranteeing preview ≡
 * executed query. mongosh rendering reuses stringifyExtendedJsonShell (house
 * style: quoted object keys).
 */

import { stringifyExtendedJsonShell } from '../ejsonShell'
import type { TransformFindResult, TransformAggregateResult } from './transformer'

export interface SerializedFind {
  filter: string
  projection: string
  sort: string
  limit: number | null
  preview: string
}

export interface SerializedAggregate {
  pipeline: string
  preview: string
}

function collectionCall(collection: string): string {
  return `db.getCollection(${JSON.stringify(collection)})`
}

export function serializeFind(r: TransformFindResult): SerializedFind {
  const filter = JSON.stringify(r.filter)
  const projection = r.projection ? JSON.stringify(r.projection) : ''
  const sort = r.sort ? JSON.stringify(r.sort) : ''

  const filterShell = stringifyExtendedJsonShell(r.filter)
  let preview: string
  if (r.projection) {
    preview = `${collectionCall(r.collection)}.find(${filterShell}, ${stringifyExtendedJsonShell(r.projection)})`
  } else {
    preview = `${collectionCall(r.collection)}.find(${filterShell})`
  }
  if (r.sort) {
    preview += `.sort(${stringifyExtendedJsonShell(r.sort)})`
  }
  if (r.limit != null) {
    preview += `.limit(${r.limit})`
  }

  return { filter, projection, sort, limit: r.limit, preview }
}

export function serializeAggregate(r: TransformAggregateResult): SerializedAggregate {
  const pipeline = JSON.stringify(r.pipeline)
  const preview = `${collectionCall(r.collection)}.aggregate(${stringifyExtendedJsonShell(r.pipeline)})`
  return { pipeline, preview }
}
