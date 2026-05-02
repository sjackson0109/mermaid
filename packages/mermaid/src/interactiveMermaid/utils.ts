/**
 * Shared utility helpers for the Interactive Mermaid module.
 */

/**
 * Escape a string for use inside a `RegExp` constructor.
 * Equivalent to the TC39 `RegExp.escape` proposal.
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Return true when `segment` appears as a complete dash/underscore-delimited
 * token inside `id`.  This prevents, for example, nodeId `B` from matching
 * the ID `flowchart-ABC-0`.
 */
export function idContainsSegment(id: string, segment: string): boolean {
  return id.split(/[-_]/).includes(segment);
}
