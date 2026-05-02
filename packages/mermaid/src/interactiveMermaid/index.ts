/**
 * Interactive Mermaid – public entry point
 *
 * This module implements a preprocessor / post-render binder layer on top of
 * standard Mermaid.  It introduces two optional declarative extensions to the
 * Mermaid authoring syntax:
 *
 * ## 1 – Parameterised templates
 *
 * Define reusable diagram structures with named placeholders, then instantiate
 * them with concrete values.
 *
 * ```text
 * template service_flow(serviceName, endpoints[]) {
 *   graph TD
 *     A[Client] --> B[{{serviceName}}]
 *     B --> C[{{endpoints[0]}}]
 *     B --> D[{{endpoints[1]}}]
 * }
 *
 * use service_flow(
 *   serviceName="Auth API",
 *   endpoints=["Login", "Token Refresh"]
 * )
 * ```
 *
 * ## 2 – Interaction blocks
 *
 * Attach runtime behaviours to individual nodes without writing JavaScript.
 *
 * ```text
 * graph TD
 *   A[Client] --> B[API Gateway]
 *   B --> C[Service A]
 *   B --> D[Service B]
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
 *
 * ## Architecture
 *
 * ```
 * Extended Mermaid Syntax
 *         │
 *         ▼
 * Template & Interaction Preprocessor  ← this module
 *         │
 *         ▼
 * Standard Mermaid Definition
 *         │
 *         ▼
 * Mermaid Renderer  (unchanged)
 *         │
 *         ▼
 * Post-render Interaction Binder  ← this module
 *         │
 *         ▼
 * Interactive SVG / HTML Output
 * ```
 */

export { parseTemplates, processUseStatements } from './templatePreprocessor.js';
export type { TemplateDefinition } from './templatePreprocessor.js';

export { parseInteractions } from './interactionPreprocessor.js';
export type { InteractionConfig, NodeState, ParseInteractionsResult } from './interactionPreprocessor.js';

export { bindInteractions } from './interactionBinder.js';

import { parseTemplates, processUseStatements } from './templatePreprocessor.js';
import { parseInteractions } from './interactionPreprocessor.js';
import { bindInteractions } from './interactionBinder.js';
import type { InteractionConfig } from './interactionPreprocessor.js';

// ---------------------------------------------------------------------------
// Preprocess
// ---------------------------------------------------------------------------

/** Combined result from preprocessing extended Mermaid source. */
export interface PreprocessResult {
  /** Standard Mermaid diagram text ready to pass to `mermaid.render()`. */
  diagramText: string;
  /** Extracted interaction configurations for post-render binding. */
  interactions: InteractionConfig[];
}

/**
 * Preprocess extended Mermaid source by:
 *
 * 1. Parsing `template` declarations and expanding `use` statements.
 * 2. Stripping `interaction` blocks and returning them as structured config.
 *
 * The returned `diagramText` is valid standard Mermaid that can be fed
 * directly into `mermaid.render()`.
 *
 * @param source - Extended Mermaid source (may be plain Mermaid too).
 * @returns Cleaned diagram text and interaction configurations.
 */
export function preprocessExtended(source: string): PreprocessResult {
  // Phase 1 – template expansion.
  const { templates, remaining } = parseTemplates(source);
  const withTemplatesExpanded = templates.size > 0
    ? processUseStatements(remaining, templates)
    : remaining;

  // Phase 2 – interaction block extraction.
  const { diagramText, interactions } = parseInteractions(withTemplatesExpanded);

  return { diagramText, interactions };
}

// Monotonically increasing counter for unique render IDs.
// Using a counter instead of Date.now() avoids collisions when multiple
// diagrams are rendered within the same millisecond.
let _renderCounter = 0;



/** Minimal interface for the Mermaid render function used by {@link renderInteractive}. */
export interface MermaidRenderFn {
  render(id: string, text: string): Promise<{ svg: string }>;
}

/**
 * Full pipeline helper: preprocess extended syntax → render with Mermaid →
 * bind post-render interactions.
 *
 * Usage example (browser):
 * ```ts
 * import mermaid from 'mermaid';
 * import { renderInteractive } from './interactiveMermaid/index.js';
 *
 * const source = `
 * graph TD
 *   A[Client] --> B[API]
 *   interaction B {
 *     tooltip: "The API Gateway"
 *     collapsible: true
 *   }
 * `;
 * await renderInteractive(document.getElementById('diagram'), source, mermaid);
 * ```
 *
 * @param container  - The host HTML element; its `innerHTML` will be replaced with the SVG.
 * @param source     - Extended (or plain) Mermaid source text.
 * @param mermaidApi - Mermaid instance exposing a `.render()` method.
 */
export async function renderInteractive(
  container: HTMLElement,
  source: string,
  mermaidApi: MermaidRenderFn
): Promise<void> {
  const { diagramText, interactions } = preprocessExtended(source);

  const id = `mermaid-interactive-${++_renderCounter}`;
  const { svg } = await mermaidApi.render(id, diagramText);

  container.innerHTML = svg;

  if (interactions.length > 0) {
    const svgEl = container.querySelector('svg');
    if (svgEl) {
      bindInteractions(svgEl, interactions);
    }
  }
}
