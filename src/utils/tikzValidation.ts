const safeTikzCommands = new Set([
  'addlegendentry',
  'addplot',
  'begin',
  'clip',
  'coordinate',
  'draw',
  'end',
  'fill',
  'filldraw',
  'legend',
  'node',
  'path',
  'shade',
  'shadedraw',
]);

const safeMathCommands = new Set([
  'Delta',
  'Gamma',
  'Lambda',
  'Omega',
  'Phi',
  'Pi',
  'Psi',
  'Theta',
  'angle',
  'alpha',
  'approx',
  'beta',
  'cdot',
  'cdots',
  'circ',
  'cos',
  'cup',
  'delta',
  'det',
  'div',
  'dots',
  'emptyset',
  'epsilon',
  'equiv',
  'exists',
  'forall',
  'frac',
  'gamma',
  'ge',
  'geq',
  'in',
  'infty',
  'int',
  'ker',
  'lambda',
  'le',
  'leq',
  'left',
  'lim',
  'ln',
  'log',
  'mathbb',
  'mathcal',
  'max',
  'min',
  'mu',
  'neq',
  'notin',
  'omega',
  'overline',
  'partial',
  'parallel',
  'perp',
  'phi',
  'pi',
  'pm',
  'propto',
  'qquad',
  'quad',
  'right',
  'rightarrow',
  'sin',
  'sqrt',
  'subset',
  'subseteq',
  'sum',
  'tan',
  'text',
  'theta',
  'times',
  'to',
  'triangle',
  'vec',
  'mathrm',
  'mathbf',
]);

function hasBalancedBraces(value: string): boolean {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\\') {
      index += 1;
    } else if (value[index] === '{') {
      depth += 1;
    } else if (value[index] === '}') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

function hasOnlyAllowedCommands(value: string, allowedCommands: Set<string>): boolean {
  const commands = value.matchAll(/\\([A-Za-z]+)/g);
  for (const command of commands) {
    if (!allowedCommands.has(command[1])) return false;
  }
  return true;
}

function hasBalancedTikzEnvironments(value: string): boolean {
  const allowedEnvironments = new Set(['axis', 'scope']);
  const stack: string[] = [];
  const environments = value.matchAll(/\\(begin|end)\s*\{([^}]+)\}/g);

  for (const match of environments) {
    const [, action, name] = match;
    if (!allowedEnvironments.has(name)) return false;
    if (action === 'begin') {
      if (name === 'axis' && stack.includes('axis')) return false;
      stack.push(name);
    } else if (stack.pop() !== name) {
      return false;
    }
  }

  return stack.length === 0;
}

export function sanitizeTikzCode(code?: string): string | undefined {
  if (!code) return undefined;

  let body = code.trim().replace(/^```(?:latex|tex|tikz)?\s*/i, '').replace(/\s*```$/, '');
  body = body
    .replace(/^\\begin\{tikzpicture\}(?:\[[^\]]*\])?\s*/i, '')
    .replace(/\s*\\end\{tikzpicture\}\s*$/i, '')
    .trim();

  if (
    body.length === 0 ||
    body.length > 8000 ||
    /(^|[^\\])%/.test(body) ||
    !hasBalancedBraces(body) ||
    !hasBalancedTikzEnvironments(body) ||
    !hasOnlyAllowedCommands(body, new Set([...safeTikzCommands, ...safeMathCommands]))
  ) {
    return undefined;
  }

  return body;
}

export function isSafeMathExpression(expression: string): boolean {
  return (
    expression.length > 0 &&
    expression.length <= 500 &&
    !/[&#%]/.test(expression) &&
    hasBalancedBraces(expression) &&
    hasOnlyAllowedCommands(expression, safeMathCommands)
  );
}
