/**
 * Template Preprocessor for Interactive Mermaid
 *
 * Parses reusable `template` declarations and `use` invocations from the
 * extended Mermaid syntax, expanding them into standard Mermaid diagram text
 * before the diagram is passed to the core renderer.
 *
 * Extended syntax example:
 *
 * ```
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
 */

/** A parsed template definition. */
export interface TemplateDefinition {
  /** Template name used in `use` statements. */
  name: string;
  /** Ordered list of parameter names, with array-type markers stripped. */
  params: string[];
  /** Raw body text of the template including Mermaid syntax and interaction blocks. */
  body: string;
}

/**
 * Scan `source` for all `template name(params) { ... }` blocks.
 *
 * @param source - Full extended Mermaid source text.
 * @returns A map of template definitions and the source with template blocks removed.
 */
export function parseTemplates(source: string): {
  templates: Map<string, TemplateDefinition>;
  remaining: string;
} {
  const templates = new Map<string, TemplateDefinition>();

  // Matches:  template <name>(<params>) {
  //             <body (may be multi-line, may contain nested { } blocks)>
  //           }
  // The closing brace MUST be at column 0 (no leading whitespace) so that
  // nested braces (e.g. interaction blocks inside the template) are not
  // mistaken for the template's own closing delimiter.
  const templateRegex = /^[ \t]*template\s+(\w+)\s*\(([^)]*)\)\s*\{([\s\S]*?)\n\}/gm;

  let remaining = source;
  let match: RegExpExecArray | null;

  while ((match = templateRegex.exec(source)) !== null) {
    const name = match[1];
    const rawParams = match[2];
    const body = match[3];

    const params = rawParams
      .split(',')
      .map((p) => p.trim().replace(/\[\]$/, '').trim())
      .filter(Boolean);

    templates.set(name, { name, params, body });
    remaining = remaining.replace(match[0], '');
  }

  return { templates, remaining: remaining.trim() };
}

/**
 * Replace every `use <name>(args)` statement in `source` with the expanded
 * template body.
 *
 * @param source   - Text that may contain `use` statements (template blocks already removed).
 * @param templates - Map produced by {@link parseTemplates}.
 * @returns Source text with all `use` statements substituted.
 * @throws {Error} When a `use` statement references an unknown template name.
 */
export function processUseStatements(
  source: string,
  templates: Map<string, TemplateDefinition>
): string {
  // Matches:  use <name>( ... )
  // The argument list may span multiple lines.
  const useRegex = /^[ \t]*use\s+(\w+)\s*\(([\s\S]*?)\)/gm;

  return source.replace(useRegex, (_match, name: string, argsStr: string) => {
    const template = templates.get(name);
    if (!template) {
      throw new Error(`[interactiveMermaid] Unknown template: "${name}"`);
    }
    const args = parseArgs(argsStr);
    return substituteTemplate(template, args);
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a `key=value` or `key=["a","b"]` argument string into a map.
 * Values may be quoted strings or JSON-style arrays.
 */
function parseArgs(argsStr: string): Map<string, string | string[]> {
  const args = new Map<string, string | string[]>();

  // Flatten to a single line so we can run a simple regex over it.
  const flat = argsStr.replace(/\r?\n/g, ' ').trim();

  // key=["item1","item2"]  or  key="value"  or  key=value
  const argRegex = /(\w+)\s*=\s*(\[(?:[^\]]*)\]|"[^"]*"|'[^']*'|[^\s,]+)/g;

  let match: RegExpExecArray | null;
  while ((match = argRegex.exec(flat)) !== null) {
    const key = match[1];
    const rawValue = match[2];

    if (rawValue.startsWith('[')) {
      // Array: ["item1", "item2"]
      const items = rawValue
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^["']|["']$/g, ''));
      args.set(key, items);
    } else {
      // Scalar
      args.set(key, rawValue.replace(/^["']|["']$/g, ''));
    }
  }

  return args;
}

/**
 * Substitute argument values into a template body.
 *
 * Placeholder syntax:
 *  - `{{paramName}}`    – scalar value
 *  - `{{paramName[0]}}` – element of an array value
 */
function substituteTemplate(
  template: TemplateDefinition,
  args: Map<string, string | string[]>
): string {
  let result = template.body;

  args.forEach((value, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, idx) => {
        result = result.replace(
          new RegExp(`\\{\\{${escapeRegExp(key)}\\[${idx}\\]\\}\\}`, 'g'),
          item
        );
      });
    } else {
      result = result.replace(new RegExp(`\\{\\{${escapeRegExp(key)}\\}\\}`, 'g'), value);
    }
  });

  return result;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
