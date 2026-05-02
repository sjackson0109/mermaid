/**
 * Interaction Binder for Interactive Mermaid
 *
 * Applies post-render behaviours (tooltips, collapsible toggle) to the SVG
 * element produced by Mermaid, driven by the {@link InteractionConfig} objects
 * extracted by the Interaction Preprocessor.
 *
 * The binder makes no assumptions about the internal structure of Mermaid's
 * SVG output beyond publicly observable class names (`node`, `nodeLabel`,
 * `edgePath`, `edge`) and ID patterns.  This keeps it resilient across
 * Mermaid versions.
 *
 * Static-export fallback: when `document` is not available (e.g. server-side
 * rendering or CLI export), `bindInteractions` is a no-op and the plain SVG
 * is returned as-is.
 */

import type { InteractionConfig } from './interactionPreprocessor.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Walk `interactions` and apply each behaviour to the matching node inside
 * `svgRoot`.
 *
 * @param svgRoot    - The `<svg>` element rendered by Mermaid.
 * @param interactions - Array produced by {@link parseInteractions}.
 */
export function bindInteractions(
  svgRoot: SVGSVGElement | Element,
  interactions: InteractionConfig[]
): void {
  if (typeof document === 'undefined') {
    // Server-side or CLI – degrade gracefully.
    return;
  }

  ensureTooltipElement();

  for (const interaction of interactions) {
    const nodeEl = findNodeElement(svgRoot, interaction.nodeId);
    if (!nodeEl) {
      continue;
    }

    if (interaction.tooltip) {
      applyTooltip(nodeEl, interaction.tooltip);
    }

    if (interaction.collapsible) {
      applyCollapsible(svgRoot, nodeEl, interaction.nodeId, interaction.defaultState ?? 'expanded');
    }

    if (interaction.cursor) {
      (nodeEl as SVGElement).style.cursor = interaction.cursor;
    } else if (interaction.tooltip || interaction.collapsible) {
      (nodeEl as SVGElement).style.cursor = 'pointer';
    }
  }
}

// ---------------------------------------------------------------------------
// Node lookup
// ---------------------------------------------------------------------------

/**
 * Locate the SVG element that represents a Mermaid node by its diagram ID.
 *
 * Mermaid prefixes node IDs in various ways depending on diagram type and
 * version (e.g. `flowchart-B-0`, `node-B`).  This function tries several
 * strategies so it works across common diagram types.
 */
function findNodeElement(svgRoot: SVGSVGElement | Element, nodeId: string): Element | null {
  // Strategy 1 – ID attribute contains the node identifier.
  // Mermaid commonly uses IDs like "flowchart-B-0" or "subGraph0".
  const byId = svgRoot.querySelector(`[id*="${nodeId}"]`);
  if (byId) {
    return byId;
  }

  // Strategy 2 – `<g class="node …">` whose inner label text equals nodeId.
  const nodeEls = svgRoot.querySelectorAll('.node');
  for (const el of nodeEls) {
    const label = el.querySelector('.nodeLabel, .label, text');
    if (label?.textContent?.trim() === nodeId) {
      return el;
    }
  }

  // Strategy 3 – data-id attribute (used by some diagram types).
  const byDataId = svgRoot.querySelector(`[data-id="${nodeId}"]`);
  if (byDataId) {
    return byDataId;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

let _tooltipEl: HTMLElement | null = null;

/** Create (once) and attach a floating tooltip `<div>` to the document body. */
function ensureTooltipElement(): void {
  if (_tooltipEl) {
    return;
  }
  _tooltipEl = document.createElement('div');
  _tooltipEl.className = 'mermaid-interactive-tooltip';
  Object.assign(_tooltipEl.style, {
    position: 'fixed',
    background: 'rgba(0,0,0,0.78)',
    color: '#fff',
    padding: '6px 10px',
    borderRadius: '4px',
    fontSize: '13px',
    lineHeight: '1.4',
    pointerEvents: 'none',
    zIndex: '9999',
    maxWidth: '280px',
    wordWrap: 'break-word',
    opacity: '0',
    transition: 'opacity 0.15s ease',
    whiteSpace: 'pre-wrap',
  });
  document.body.appendChild(_tooltipEl);
}

/**
 * Add native SVG `<title>` (accessible fallback) and a rich floating tooltip
 * to `nodeEl`.
 */
function applyTooltip(nodeEl: Element, tooltipText: string): void {
  // Native SVG title for accessibility and browser-default tooltip.
  const ns = 'http://www.w3.org/2000/svg';
  let titleEl = nodeEl.querySelector('title');
  if (!titleEl) {
    titleEl = document.createElementNS(ns, 'title');
    nodeEl.insertBefore(titleEl, nodeEl.firstChild);
  }
  titleEl.textContent = tooltipText;

  // Rich floating tooltip via mouse events.
  nodeEl.setAttribute('data-tooltip', tooltipText);

  nodeEl.addEventListener('mouseenter', (e) => {
    const me = e as MouseEvent;
    if (_tooltipEl) {
      _tooltipEl.textContent = tooltipText;
      _tooltipEl.style.opacity = '1';
      _tooltipEl.style.left = `${me.clientX + 14}px`;
      _tooltipEl.style.top = `${me.clientY - 6}px`;
    }
  });

  nodeEl.addEventListener('mousemove', (e) => {
    const me = e as MouseEvent;
    if (_tooltipEl) {
      _tooltipEl.style.left = `${me.clientX + 14}px`;
      _tooltipEl.style.top = `${me.clientY - 6}px`;
    }
  });

  nodeEl.addEventListener('mouseleave', () => {
    if (_tooltipEl) {
      _tooltipEl.style.opacity = '0';
    }
  });
}

// ---------------------------------------------------------------------------
// Collapsible nodes
// ---------------------------------------------------------------------------

/**
 * Make a node collapsible: clicking it hides or reveals its outgoing edges
 * and their target nodes.
 *
 * The implementation:
 * 1. Collects all edges whose SVG ID contains the source `nodeId`.
 * 2. Resolves the target node elements from those edges.
 * 3. Attaches a click handler that toggles visibility.
 * 4. Appends a small `▼`/`▶` indicator to the node shape.
 */
function applyCollapsible(
  svgRoot: SVGSVGElement | Element,
  nodeEl: Element,
  nodeId: string,
  defaultState: 'expanded' | 'collapsed'
): void {
  // Mermaid edge paths carry IDs such as "flowchart-B-C-1" where B is the source.
  // We match conservatively: the segment after "flowchart-" or at word boundary.
  const edgeSelector = '.edgePath, .edge, [class*="edgePath"]';
  const allEdges = Array.from(svgRoot.querySelectorAll(edgeSelector));

  const ownEdges = allEdges.filter((edge) => {
    const id = edge.getAttribute('id') ?? '';
    // Match  flowchart-<nodeId>-  or  edge-<nodeId>-  patterns.
    return new RegExp(`(?:^|[-_])${escapeId(nodeId)}(?:[-_]|$)`).test(id);
  });

  // Also capture the target nodes so they can be hidden too.
  const targetNodeIds = ownEdges
    .map((edge) => {
      const id = edge.getAttribute('id') ?? '';
      // Extract the destination part of IDs like "flowchart-B-C-0".
      const parts = id.split('-');
      const idx = parts.indexOf(nodeId);
      return idx !== -1 && idx + 1 < parts.length ? parts[idx + 1] : null;
    })
    .filter((id): id is string => id !== null);

  const targetNodes = targetNodeIds
    .map((id) => svgRoot.querySelector(`[id*="${id}"]`))
    .filter((el): el is Element => el !== null);

  // Build the toggle indicator (▼ / ▶).
  const indicator = createToggleIndicator(nodeEl);

  let expanded = defaultState === 'expanded';

  function applyVisibility(show: boolean): void {
    const displayValue = show ? '' : 'none';
    for (const edge of ownEdges) {
      (edge as SVGElement).style.display = displayValue;
    }
    for (const target of targetNodes) {
      (target as SVGElement).style.display = displayValue;
      // Also hide the edge label groups.
      const labelGroup = svgRoot.querySelector(`[id*="L-${nodeId}"]`);
      if (labelGroup) {
        (labelGroup as SVGElement).style.display = displayValue;
      }
    }
    indicator.textContent = show ? '▼' : '▶';
  }

  // Apply initial state.
  if (!expanded) {
    applyVisibility(false);
  }

  nodeEl.addEventListener('click', () => {
    expanded = !expanded;
    applyVisibility(expanded);
  });
}

/**
 * Append a small collapse/expand caret to the top-right of a node shape.
 * Returns the created element so callers can update its text.
 */
function createToggleIndicator(nodeEl: Element): SVGTextElement {
  const ns = 'http://www.w3.org/2000/svg';
  const text = document.createElementNS(ns, 'text') as SVGTextElement;
  text.classList.add('mermaid-collapse-indicator');
  text.textContent = '▼';
  text.setAttribute('font-size', '10');
  text.setAttribute('fill', '#555');

  // Try to position it relative to the bounding box of the node's shape.
  const shape = nodeEl.querySelector('rect, circle, ellipse, polygon, path');
  const graphicsEl = (shape ?? nodeEl) as SVGGraphicsElement;
  try {
    const bbox = graphicsEl.getBBox();
    text.setAttribute('x', String(bbox.x + bbox.width - 12));
    text.setAttribute('y', String(bbox.y + 12));
  } catch {
    // getBBox can throw outside a connected document; use a relative offset.
    text.setAttribute('dx', '-12');
    text.setAttribute('dy', '12');
  }

  text.style.pointerEvents = 'none';
  text.style.userSelect = 'none';
  nodeEl.appendChild(text);
  return text;
}

function escapeId(id: string): string {
  return id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
