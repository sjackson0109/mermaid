/**
 * Interaction Preprocessor for Interactive Mermaid
 *
 * Strips `interaction <nodeId> { ... }` blocks from the Mermaid source text
 * and returns them as structured configuration objects that the Interaction
 * Binder can apply to the rendered SVG.
 *
 * Extended syntax example:
 *
 * ```
 * graph TD
 *   A[Client] --> B[API Gateway]
 *   B --> C[Service A]
 *
 *   interaction B {
 *     collapsible: true
 *     defaultState: expanded
 *   }
 *
 *   interaction C {
 *     tooltip: "Handles authentication logic"
 *   }
 * ```
 */

/** Supported state values for a collapsible node. */
export type NodeState = 'expanded' | 'collapsed';

/** Runtime behaviour configuration for a single diagram node. */
export interface InteractionConfig {
  /** The node identifier as used in the Mermaid source (e.g. `B`). */
  nodeId: string;
  /** When true, clicking the node toggles the visibility of its outgoing edges. */
  collapsible?: boolean;
  /** Initial visibility state for a collapsible node. Defaults to `'expanded'`. */
  defaultState?: NodeState;
  /** Text to show in a floating tooltip on hover. */
  tooltip?: string;
  /**
   * CSS `cursor` value to apply to the node element.
   * Defaults to `'pointer'` when `collapsible` or `tooltip` is set.
   */
  cursor?: string;
}

/** Result returned by {@link parseInteractions}. */
export interface ParseInteractionsResult {
  /** Standard Mermaid diagram text with all `interaction` blocks removed. */
  diagramText: string;
  /** Extracted interaction configurations, one per `interaction` block. */
  interactions: InteractionConfig[];
}

/**
 * Extract all `interaction <id> { ... }` blocks from `source`.
 *
 * @param source - Extended Mermaid source that may contain interaction blocks.
 * @returns The cleaned diagram text and an array of interaction configurations.
 */
export function parseInteractions(source: string): ParseInteractionsResult {
  const interactions: InteractionConfig[] = [];

  // Matches:  interaction <nodeId> {
  //             <properties (multi-line)>
  //           }
  // The closing brace must appear at the start of a line (possibly indented).
  const interactionRegex = /^[ \t]*interaction\s+(\w+)\s*\{([\s\S]*?)\n[ \t]*\}/gm;

  // Collect matches first so we can iterate without regex state issues.
  const matches: Array<{ full: string; nodeId: string; body: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = interactionRegex.exec(source)) !== null) {
    matches.push({ full: match[0], nodeId: match[1], body: match[2] });
  }

  let diagramText = source;
  for (const m of matches) {
    diagramText = diagramText.replace(m.full, '');
    interactions.push(parseInteractionBlock(m.nodeId, m.body));
  }

  return { diagramText: diagramText.trim(), interactions };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse the key-value lines inside a single `interaction` block body.
 *
 * Supported keys:
 * - `collapsible: true|false`
 * - `defaultState: expanded|collapsed`
 * - `tooltip: "some text"`
 * - `cursor: <css-value>`
 */
function parseInteractionBlock(nodeId: string, body: string): InteractionConfig {
  const config: InteractionConfig = { nodeId };

  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      continue;
    }
    const key = line.slice(0, colonIdx).trim();
    const value = line
      .slice(colonIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');

    switch (key) {
      case 'collapsible':
        config.collapsible = value === 'true';
        break;
      case 'defaultState':
        config.defaultState = value as NodeState;
        break;
      case 'tooltip':
        config.tooltip = value;
        break;
      case 'cursor':
        config.cursor = value;
        break;
      default:
        // Unknown keys are silently ignored for forward compatibility.
        break;
    }
  }

  return config;
}
