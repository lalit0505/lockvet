/**
 * Tokenize a simple SPDX license expression.
 * Supports identifiers, OR, AND, and parentheses.
 *
 * @param {string} expr
 * @returns {string[]}
 */
function tokenize(expr) {
  const tokens = [];
  const regex = /\s*([()]+|OR|AND|[^\s()]+)\s*/gi;
  let match;
  while ((match = regex.exec(expr)) !== null) {
    const raw = match[1];
    if (raw === '(' || raw === ')') {
      tokens.push(raw);
    } else {
      // Handle joined parens e.g. "(MIT" or "GPL-3.0)"
      let buffer = '';
      for (let i = 0; i < raw.length; i++) {
        const char = raw[i];
        if (char === '(' || char === ')') {
          if (buffer.length > 0) {
            tokens.push(buffer);
            buffer = '';
          }
          tokens.push(char);
        } else {
          buffer += char;
        }
      }
      if (buffer.length > 0) {
        tokens.push(buffer);
      }
    }
  }
  return tokens;
}

/**
 * Parse tokens into an Abstract Syntax Tree.
 * Grammar:
 * Expression := OrExpr
 * OrExpr     := AndExpr ('OR' AndExpr)*
 * AndExpr    := Primary ('AND' Primary)*
 * Primary    := '(' Expression ')' | IDENTIFIER
 *
 * @param {string[]} tokens
 * @returns {object} AST node
 */
function parseSpdx(tokens) {
  let pos = 0;

  function parsePrimary() {
    const token = tokens[pos];
    if (!token) {
      return { type: 'ID', value: 'UNKNOWN' };
    }
    if (token === '(') {
      pos++;
      const expr = parseOr();
      if (tokens[pos] === ')') {
        pos++;
      }
      return expr;
    }
    pos++;
    return { type: 'ID', value: token };
  }

  function parseAnd() {
    let left = parsePrimary();
    while (pos < tokens.length && tokens[pos].toUpperCase() === 'AND') {
      pos++;
      const right = parsePrimary();
      left = { type: 'AND', left, right };
    }
    return left;
  }

  function parseOr() {
    let left = parseAnd();
    while (pos < tokens.length && tokens[pos].toUpperCase() === 'OR') {
      pos++;
      const right = parseAnd();
      left = { type: 'OR', left, right };
    }
    return left;
  }

  return parseOr();
}

/**
 * Evaluate if an SPDX AST is allowed by the allowed set.
 * Single ID: satisfied if in set.
 * A OR B: satisfied if either is allowed.
 * A AND B: satisfied if both are allowed.
 *
 * @param {object} ast
 * @param {Set<string>} allowedSet
 * @returns {boolean}
 */
export function isSpdxAllowed(ast, allowedSet) {
  if (ast.type === 'ID') {
    return allowedSet.has(ast.value.toUpperCase());
  }
  if (ast.type === 'OR') {
    return isSpdxAllowed(ast.left, allowedSet) || isSpdxAllowed(ast.right, allowedSet);
  }
  if (ast.type === 'AND') {
    return isSpdxAllowed(ast.left, allowedSet) && isSpdxAllowed(ast.right, allowedSet);
  }
  return false;
}

/**
 * Evaluate if an SPDX AST is denied by the denied set.
 * Single ID: denied if in set.
 * A OR B: denied ONLY if all alternatives are denied.
 * A AND B: denied if any alternative is denied.
 *
 * @param {object} ast
 * @param {Set<string>} deniedSet
 * @returns {boolean}
 */
export function isSpdxDenied(ast, deniedSet) {
  if (ast.type === 'ID') {
    return deniedSet.has(ast.value.toUpperCase());
  }
  if (ast.type === 'OR') {
    return isSpdxDenied(ast.left, deniedSet) && isSpdxDenied(ast.right, deniedSet);
  }
  if (ast.type === 'AND') {
    return isSpdxDenied(ast.left, deniedSet) || isSpdxDenied(ast.right, deniedSet);
  }
  return false;
}

/**
 * Check a license string against allow and deny sets.
 *
 * @param {string} licenseStr
 * @param {Set<string>} allowedSet
 * @param {Set<string>} deniedSet
 * @returns {{ denied: boolean, notAllowed: boolean, reason: string | null }}
 */
export function evaluateLicense(licenseStr, allowedSet, deniedSet) {
  const norm = (licenseStr || 'UNKNOWN').trim();
  const tokens = tokenize(norm);
  const ast = parseSpdx(tokens);

  if (deniedSet && deniedSet.size > 0) {
    if (isSpdxDenied(ast, deniedSet)) {
      return {
        denied: true,
        notAllowed: false,
        reason: `License "${norm}" is denied by configuration`
      };
    }
  }

  if (allowedSet && allowedSet.size > 0) {
    if (!isSpdxAllowed(ast, allowedSet)) {
      return {
        denied: false,
        notAllowed: true,
        reason: `License "${norm}" is not in the allowed license list`
      };
    }
  }

  return { denied: false, notAllowed: false, reason: null };
}
