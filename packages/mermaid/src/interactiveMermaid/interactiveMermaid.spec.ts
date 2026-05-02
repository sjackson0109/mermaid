import { describe, it, expect } from 'vitest';
import { parseTemplates, processUseStatements } from './templatePreprocessor.js';
import { parseInteractions } from './interactionPreprocessor.js';
import { preprocessExtended } from './index.js';

// ---------------------------------------------------------------------------
// templatePreprocessor
// ---------------------------------------------------------------------------

describe('parseTemplates', () => {
  it('extracts a template definition from source', () => {
    const source = `template greet(name) {
  graph TD
    A[Hello {{name}}]
}`;
    const { templates, remaining } = parseTemplates(source);
    expect(templates.has('greet')).toBe(true);
    expect(templates.get('greet')!.params).toEqual(['name']);
    expect(remaining).toBe('');
  });

  it('extracts array-type parameter names without []', () => {
    const source = `template flow(title, steps[]) {
  graph TD
    A[{{title}}] --> B[{{steps[0]}}]
}`;
    const { templates } = parseTemplates(source);
    expect(templates.get('flow')!.params).toEqual(['title', 'steps']);
  });

  it('removes the template block from the remaining source', () => {
    const source = `template t(x) {
  graph TD
    A[{{x}}]
}

use t(x="hello")`;
    const { remaining } = parseTemplates(source);
    expect(remaining).toContain('use t');
    expect(remaining).not.toContain('template');
  });

  it('handles multiple template definitions', () => {
    const source = `template a(x) {
  graph TD
    A[{{x}}]
}

template b(y) {
  graph LR
    B[{{y}}]
}`;
    const { templates } = parseTemplates(source);
    expect(templates.size).toBe(2);
    expect(templates.has('a')).toBe(true);
    expect(templates.has('b')).toBe(true);
  });
});

describe('processUseStatements', () => {
  it('expands a scalar parameter', () => {
    const source = `template greet(name) {
  graph TD
    A[{{name}}]
}`;
    const { templates, remaining } = parseTemplates(source);
    const useSource = remaining + '\nuse greet(name="World")';
    const result = processUseStatements(useSource, templates);
    expect(result).toContain('A[World]');
  });

  it('expands array parameters by index', () => {
    const templateSource = `template flow(title, steps[]) {
  graph TD
    A[{{title}}] --> B[{{steps[0]}}]
    A --> C[{{steps[1]}}]
}`;
    const { templates, remaining } = parseTemplates(templateSource);
    const useSource = remaining + `\nuse flow(\n  title="Pipeline",\n  steps=["Build", "Deploy"]\n)`;
    const result = processUseStatements(useSource, templates);
    expect(result).toContain('A[Pipeline]');
    expect(result).toContain('B[Build]');
    expect(result).toContain('C[Deploy]');
  });

  it('throws on unknown template name', () => {
    expect(() => {
      processUseStatements('use unknown(x="1")', new Map());
    }).toThrow('Unknown template');
  });
});

// ---------------------------------------------------------------------------
// interactionPreprocessor
// ---------------------------------------------------------------------------

describe('parseInteractions', () => {
  it('strips interaction blocks from diagram text', () => {
    const source = `graph TD
  A --> B

  interaction B {
    tooltip: "B node"
  }`;
    const { diagramText } = parseInteractions(source);
    expect(diagramText).not.toContain('interaction');
    expect(diagramText).toContain('A --> B');
  });

  it('parses tooltip property', () => {
    const source = `graph TD
  A --> B

  interaction B {
    tooltip: "Hello world"
  }`;
    const { interactions } = parseInteractions(source);
    expect(interactions).toHaveLength(1);
    expect(interactions[0].nodeId).toBe('B');
    expect(interactions[0].tooltip).toBe('Hello world');
  });

  it('parses collapsible and defaultState properties', () => {
    const source = `graph TD
  A --> B

  interaction B {
    collapsible: true
    defaultState: collapsed
  }`;
    const { interactions } = parseInteractions(source);
    expect(interactions[0].collapsible).toBe(true);
    expect(interactions[0].defaultState).toBe('collapsed');
  });

  it('handles multiple interaction blocks', () => {
    const source = `graph TD
  A --> B
  B --> C

  interaction B {
    tooltip: "B tooltip"
  }

  interaction C {
    tooltip: "C tooltip"
    collapsible: true
  }`;
    const { interactions } = parseInteractions(source);
    expect(interactions).toHaveLength(2);
    expect(interactions.find((i) => i.nodeId === 'B')?.tooltip).toBe('B tooltip');
    expect(interactions.find((i) => i.nodeId === 'C')?.collapsible).toBe(true);
  });

  it('returns empty array when no interaction blocks present', () => {
    const { interactions } = parseInteractions('graph TD\n  A --> B');
    expect(interactions).toHaveLength(0);
  });

  it('ignores unknown properties without error', () => {
    const source = `graph TD
  A --> B

  interaction B {
    unknownProp: someValue
    tooltip: "known"
  }`;
    const { interactions } = parseInteractions(source);
    expect(interactions[0].tooltip).toBe('known');
  });
});

// ---------------------------------------------------------------------------
// preprocessExtended (index)
// ---------------------------------------------------------------------------

describe('preprocessExtended', () => {
  it('expands templates and strips interaction blocks in one call', () => {
    const source = `template svc(name) {
  graph TD
    A[Client] --> B[{{name}}]

  interaction B {
    tooltip: "{{name}}"
  }
}

use svc(name="Auth API")`;
    const { diagramText, interactions } = preprocessExtended(source);
    expect(diagramText).toContain('B[Auth API]');
    expect(diagramText).not.toContain('interaction');
    expect(interactions).toHaveLength(1);
    expect(interactions[0].tooltip).toBe('Auth API');
  });

  it('passes through plain Mermaid source unchanged', () => {
    const plain = 'graph TD\n  A --> B\n  B --> C';
    const { diagramText, interactions } = preprocessExtended(plain);
    expect(diagramText).toBe(plain);
    expect(interactions).toHaveLength(0);
  });

  it('handles interaction blocks without templates', () => {
    const source = `graph TD
  A --> B

  interaction A {
    tooltip: "Start node"
  }`;
    const { diagramText, interactions } = preprocessExtended(source);
    expect(diagramText).toContain('A --> B');
    expect(diagramText).not.toContain('interaction');
    expect(interactions[0].nodeId).toBe('A');
  });
});
