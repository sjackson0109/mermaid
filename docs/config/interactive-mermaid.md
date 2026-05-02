# Interactive Mermaid – Specification & Feasibility Study

> **Status:** Proof of concept.  The implementation lives in
> `packages/mermaid/src/interactiveMermaid/` and the interactive demo is at
> `demos/interactive.html`.

---

## Table of Contents

1. [Objective](#objective)
2. [Feasibility Assessment](#feasibility-assessment)
3. [Proposed Syntax Specification](#proposed-syntax-specification)
4. [Architecture](#architecture)
5. [Implementation Guide](#implementation-guide)
6. [Example Diagrams](#example-diagrams)
7. [Compatibility Notes](#compatibility-notes)
8. [Risks and Limitations](#risks-and-limitations)
9. [Recommendation](#recommendation)

---

## Objective

Extend the Mermaid authoring experience with two orthogonal features, without
modifying the Mermaid core:

| Feature | What it adds |
|---|---|
| **Parameterised templates** | Reusable diagram skeletons with named placeholders |
| **Interaction blocks** | Declarative node behaviours: collapsible nodes and hover tooltips |

Both features are implemented as a thin **preprocessor/binder** layer that
wraps Mermaid's existing rendering pipeline.

---

## Feasibility Assessment

### Mermaid rendering lifecycle

Mermaid's public API exposes:

```
mermaid.initialize(config)
mermaid.render(id, text) → Promise<{ svg: string, bindFunctions: fn }>
mermaid.run()  // equivalent of startOnLoad
```

The `render()` function:
1. Calls `preprocessDiagram(text)` (strips front-matter, directives, comments).
2. Detects the diagram type.
3. Parses and renders to an SVG string.
4. Returns the SVG string and an optional `bindFunctions` callback for
   existing click/tooltip bindings.

This lifecycle makes two integration points obvious:

- **Before step 1** – inject a custom preprocessor that expands templates and
  strips interaction blocks.
- **After step 4** – traverse the returned SVG DOM and apply interaction
  bindings.

### Parser extension feasibility

Mermaid's parser is built with [Jison](https://github.com/zaach/jison).  Adding
`template` and `interaction` keywords to every diagram grammar would require
forking the core parsers and is impractical without becoming a core Mermaid
contributor.

**Verdict:** Parser extension is not recommended for this feature set.

### Preprocessor feasibility ✅

Because `template` and `interaction` blocks use syntax that no existing
diagram type would produce (they would fail Mermaid's parser), they can be
stripped with a plain text preprocessor before the source is ever passed to
Mermaid.  The preprocessor is a pure string transformation and requires no
parser changes.

**Verdict:** Fully feasible.  Implemented in this PoC.

### Post-render DOM manipulation feasibility ✅

Mermaid returns an SVG string.  When injected into the DOM:
- Node elements carry predictable class names (`.node`, `.edgePath`).
- Node IDs follow a pattern such as `flowchart-<id>-<index>`.
- The SVG is a standard DOM tree that JavaScript can traverse and mutate.

Tooltips can be applied via `<title>` SVG elements (native, accessible) and
enhanced with floating `<div>` overlays.  Collapsible behaviour can be
implemented by toggling `display: none` on edge paths and target nodes.

**Verdict:** Fully feasible within browser environments.

### SVG group manipulation for collapsible nodes

A collapsed node hides:
- All `<g class="edgePath">` elements whose `id` matches
  `.*-<nodeId>-.*`.
- The target `<g class="node">` elements reached by those edges.

Because Mermaid renders each diagram type consistently this approach works
across flowcharts, sequence diagrams (with minor adaptations), and class
diagrams.

### Static-export fallback

When Mermaid is used in a CLI or headless context (`document` is not
available), `bindInteractions` is a no-op.  The SVG produced is a standard,
fully readable static diagram – no information is lost.

### Compatibility with Markdown renderers

| Environment | Template expansion | Interaction binding |
|---|---|---|
| Browser (CDN) | ✅ Client-side script | ✅ Post-render script |
| GitHub Markdown | ⛔ Not supported (static SVG only) | ⛔ |
| GitLab Markdown | ⛔ Not supported | ⛔ |
| MkDocs Material | ✅ via custom JS hook | ✅ |
| Docusaurus | ✅ via MDX component | ✅ |
| VS Code Preview | ⛔ Script execution blocked | ⛔ |
| Obsidian | ✅ via community plugin | ✅ |

When running in an environment that does not execute JavaScript, the diagram
degrades cleanly to a static Mermaid rendering (interaction blocks are already
stripped by the preprocessor before Mermaid sees the source).

---

## Proposed Syntax Specification

### 1 – Template declaration

```
template <name>(<param1>, <param2[]>, …) {
  <mermaid diagram definition>

  [interaction blocks]
}
```

- `<name>` – identifier, alphanumeric and underscores.
- `<param>` – scalar placeholder.
- `<param[]>` – array placeholder (zero-indexed).
- The body may contain any valid Mermaid diagram definition **and** any number
  of `interaction` blocks.
- Template bodies are not rendered on their own; they must be instantiated with
  `use`.
- **Convention:** the closing `}` of a `template` block must be at column 0
  (no leading whitespace). This disambiguates it from nested `interaction { }`
  closing braces inside the template body.

### 2 – Template invocation

```
use <name>(
  <param>="<value>",
  <param>=["<item0>", "<item1>", …]
)
```

- The argument list may span multiple lines.
- Values may be quoted strings (`"…"`) or JSON-style arrays (`[…]`).

### 3 – Placeholder syntax inside templates

| Placeholder | Resolved to |
|---|---|
| `{{paramName}}` | The scalar value of `paramName` |
| `{{paramName[0]}}` | Element at index 0 of the array `paramName` |

Placeholders can appear anywhere in the template body including node labels,
edge labels, interaction tooltip text, and ID fragments.

### 4 – Interaction block

```
interaction <nodeId> {
  collapsible:  true | false
  defaultState: expanded | collapsed
  tooltip:      "<text>"
  cursor:       <css-cursor-value>
}
```

- `<nodeId>` must match the node identifier used in the diagram source (e.g.
  `B` in `B[API Gateway]`).
- All properties are optional.
- Unknown properties are silently ignored for forward compatibility.

#### Supported properties

| Property | Type | Default | Description |
|---|---|---|---|
| `collapsible` | boolean | `false` | Clicking the node toggles outgoing edges |
| `defaultState` | `expanded` \| `collapsed` | `expanded` | Initial visibility state |
| `tooltip` | string | — | Text shown on hover |
| `cursor` | CSS cursor | `pointer` (when tooltip/collapsible set) | Mouse cursor style |

---

## Architecture

```
Extended Mermaid Syntax
        │
        ▼
┌───────────────────────────────────────────────┐
│  Template Preprocessor                        │
│  • Parses template { … } declarations         │
│  • Expands use <name>(…) statements           │
│  • Substitutes {{placeholders}}               │
└───────────────────┬───────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────┐
│  Interaction Preprocessor                     │
│  • Strips interaction <id> { … } blocks       │
│  • Returns InteractionConfig[]                │
└───────────────────┬───────────────────────────┘
                    │  Standard Mermaid text
                    ▼
        Mermaid Renderer (unchanged)
                    │  SVG string
                    ▼
┌───────────────────────────────────────────────┐
│  Interaction Binder                           │
│  • Finds nodes by ID / class / label text     │
│  • Injects SVG <title> for accessibility      │
│  • Attaches floating tooltip overlay          │
│  • Wires click handler for collapse/expand    │
└───────────────────┬───────────────────────────┘
                    │
                    ▼
         Interactive SVG / HTML Output
```

### Module layout

```
packages/mermaid/src/interactiveMermaid/
├── index.ts                  Public API + renderInteractive() helper
├── templatePreprocessor.ts   parseTemplates() + processUseStatements()
├── interactionPreprocessor.ts parseInteractions()
└── interactionBinder.ts      bindInteractions()
```

---

## Implementation Guide

### Browser (CDN)

```html
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.esm.min.mjs';
  import { renderInteractive } from './interactiveMermaid/index.js';

  mermaid.initialize({ startOnLoad: false });

  const source = document.querySelector('pre.interactive-mermaid').textContent;
  await renderInteractive(document.getElementById('diagram'), source, mermaid);
</script>
```

### Preprocessor only (Node.js / SSG)

```ts
import { preprocessExtended } from './interactiveMermaid/index.js';

const { diagramText } = preprocessExtended(myExtendedSource);
// Pass diagramText to mermaid CLI or any renderer.
```

### MkDocs Material

Add a custom JavaScript hook that:
1. Selects all `<pre class="mermaid">` elements.
2. Calls `preprocessExtended` on their content.
3. Replaces the source with `diagramText`.
4. Lets Mermaid render normally.
5. Calls `bindInteractions` after render.

### Docusaurus (MDX)

Create an `<InteractiveMermaid>` React component that wraps the pipeline,
rendering into a `useEffect` hook.

---

## Example Diagrams

### Service flow (template + interactions)

```text
template service_flow(serviceName, endpoints[]) {
  graph TD
    A[Client] --> B[{{serviceName}}]
    B --> C[{{endpoints[0]}}]
    B --> D[{{endpoints[1]}}]

  interaction B {
    collapsible: true
    defaultState: expanded
    tooltip: "{{serviceName}} – click to collapse"
  }

  interaction C {
    tooltip: "Endpoint: {{endpoints[0]}}"
  }

  interaction D {
    tooltip: "Endpoint: {{endpoints[1]}}"
  }
}

use service_flow(
  serviceName="Auth API",
  endpoints=["Login", "Token Refresh"]
)
```

### Plain interaction block (no template)

```text
graph TD
  A[Client] --> B[API Gateway]
  B --> C[Auth Service]
  B --> D[Billing Service]

  interaction B {
    collapsible: true
    defaultState: expanded
    tooltip: "Central API Gateway – click to collapse downstream"
  }

  interaction C {
    tooltip: "Handles JWT authentication"
  }

  interaction D {
    tooltip: "Manages subscription billing"
  }
```

---

## Compatibility Notes

### What stays standard Mermaid

- All diagram types (flowchart, sequence, class, ER, state, …) are unmodified.
- The `diagramText` produced by the preprocessor is 100% standard Mermaid.
- Existing Mermaid configuration (front-matter, `%%{ init: … }%%`) continues
  to work.
- The `mermaid.render()` and `mermaid.run()` APIs are unchanged.

### GitHub / GitLab Markdown rendering

These platforms render Mermaid server-side and do not run post-render
JavaScript.  The interaction binder is therefore inactive.  However, because
interaction blocks are stripped by the preprocessor before Mermaid sees the
source, authors using these platforms need to remove/skip the `interaction`
blocks or use a separate preprocessing step.

A documentation-first author workflow could:
1. Maintain `.imermaid` files with the full extended syntax.
2. Generate `.mermaid` files (stripped) as build artefacts for GitHub
   embedding.

### Accessibility

- The `<title>` element added inside each node provides tooltip text to screen
  readers and browsers that do not run the JS overlay.
- The `data-tooltip` attribute enables CSS-only tooltip implementations if
  preferred.

---

## Risks and Limitations

| Risk | Severity | Mitigation |
|---|---|---|
| Mermaid SVG structure changes between versions break the binder | Medium | Binder uses multiple lookup strategies; add version-guard tests |
| Node ID collision when `nodeId` is a substring of another ID | Low | Regex uses word-boundary anchors around the ID |
| `getBBox()` unavailable in headless/SSR | Low | Try/catch falls back to relative offset; binder is no-op without `document` |
| Template `{{placeholder}}` collides with Mermaid's own `{{ }}` double-brace syntax for subgraphs | Low | Mermaid does not use `{{ }}` in its syntax today; monitor future releases |
| Collapsible behaviour for non-flowchart diagrams requires per-diagram-type logic | Medium | PoC targets flowchart; extend per diagram type as needed |
| GitHub/GitLab render interaction blocks as syntax errors if not pre-stripped | Medium | Preprocessor must run before the source reaches the platform |

---

## Recommendation

### Preferred form: **Mermaid wrapper / client-side preprocessor**

The preferred architecture is a **standalone wrapper library** that:

- Ships as a small ES module (`interactive-mermaid.js`).
- Requires only `mermaid` as a peer dependency.
- Is completely opt-in: plain Mermaid sources continue to work.
- Does not require forking or patching Mermaid internals.
- Can be loaded via CDN, bundled with a framework, or run in Node.js for
  static pre-processing.

This approach:

| Criterion | Score |
|---|---|
| Zero changes to Mermaid core | ✅ |
| Degrades cleanly to static SVG | ✅ |
| No user JavaScript required | ✅ |
| Documentation-first workflow | ✅ |
| Supports SSG (MkDocs, Docusaurus) | ✅ (with integration adapter) |
| Works on GitHub/GitLab | ⚠ Interaction JS inactive; static fallback works |
| Declarative syntax | ✅ |

A **Mermaid plugin** (via the official external diagram extension API) is also
feasible but is scoped to adding new diagram _types_, not cross-cutting
behaviours like tooltips and collapse, so it is a less natural fit.

A **Markdown preprocessor** (e.g. remark/rehype plugin) is viable for
Node.js-based SSGs but moves the interaction binding to a build step, losing
the runtime interactivity unless paired with a client-side binder anyway.

A **standalone visual modelling syntax** (compiling to Mermaid) is the highest
ambition of this proposal but requires the most investment; the wrapper
approach is the correct first step on that path.
