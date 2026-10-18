/** Original bounded OpenFormula/A1 translator; no evaluator or third-party source. */
export class OdfFormulaError extends Error {
  readonly code: 'UNSAFE_FORMULA' | 'UNSUPPORTED_FORMULA';
  constructor(message: string, code: 'UNSAFE_FORMULA' | 'UNSUPPORTED_FORMULA' = 'UNSUPPORTED_FORMULA') { super(`OFFICE_FORMAT: ${message}`); this.code = code; }
}
function unsupported(message = 'Formula syntax is outside the supported OpenFormula subset'): never { throw new OdfFormulaError(message); }
function unsafe(): never { throw new OdfFormulaError('External or active formula is not accepted', 'UNSAFE_FORMULA'); }
const functions = new Set('SUM AVERAGE MIN MAX COUNT COUNTA IF AND OR NOT SUMIF COUNTIF SUMIFS COUNTIFS ROUND ROUNDUP ROUNDDOWN ABS INT MOD POWER SQRT VLOOKUP HLOOKUP INDEX MATCH IFERROR ISERROR ISNA ISNUMBER ISTEXT ISBLANK LEN LEFT RIGHT MID TRIM UPPER LOWER CONCATENATE DATE YEAR MONTH DAY HOUR MINUTE SECOND TODAY NOW TRUE FALSE'.split(' '));
const activeFunctions = new Set('WEBSERVICE FILTERXML HYPERLINK IMAGE IMPORTXML IMPORTDATA IMPORTHTML IMPORTRANGE GOOGLEFINANCE RTD CALL REGISTER REGISTER.ID EXEC EVALUATE SQL.REQUEST DDE'.split(' '));
type Endpoint = { sheet?: string; cell: string };
type Token = { kind: 'atom' | 'function' | 'operator' | 'left' | 'right' | 'separator'; text: string };
const cellPattern = /^\$?[A-Za-z]{1,3}\$?[1-9][0-9]{0,6}/;
const quoted = /^'(?:[^']|'')*'/u;
const identifier = /^[\p{L}_][\p{L}\p{N}_.]*/u;
function cell(value: string): string {
  if (!/^\$?[A-Za-z]{1,3}\$?[1-9][0-9]{0,6}$/.test(value)) unsupported('Unsupported cell address');
  const column = value.replace(/[$0-9]/g, '').toUpperCase(); let col = 0;
  for (const character of column) col = col * 26 + character.charCodeAt(0) - 64;
  if (col > 16384 || Number(value.match(/[0-9]+$/)![0]) > 1048576) unsupported('Cell address exceeds spreadsheet limits');
  return value.toUpperCase();
}
function sheet(value: string): string {
  const name = value.startsWith("'") ? value.slice(1, -1).replace(/''/g, "'") : value;
  if (/^(?:https?|file|ftp|data):|\\\\|\[|\]/i.test(name)) unsafe();
  if (!name || name.length > 128 || /[\x00-\x1f\[\]\\/:*?]/.test(name)) unsupported('Unsupported sheet name');
  return name;
}
const quoteSheet = (value: string) => `'${value.replace(/'/g, "''")}'`;
function officeEndpoint(formula: string, offset: number): { endpoint: Endpoint; end: number } | undefined {
  let p = offset, name: string | undefined;
  const possibleSheet = formula.slice(p).match(quoted)?.[0] ?? formula.slice(p).match(identifier)?.[0];
  if (possibleSheet && formula[p + possibleSheet.length] === '!') { name = sheet(possibleSheet); p += possibleSheet.length + 1; }
  const address = formula.slice(p).match(cellPattern)?.[0];
  if (!address || /[\p{L}\p{N}_.$]/u.test(formula[p + address.length] ?? '')) return undefined;
  return { endpoint: { ...(name === undefined ? {} : { sheet: name }), cell: cell(address) }, end: p + address.length };
}
function odfEndpoint(value: string): Endpoint {
  value = value.trim();
  // An explicit sheet name in the editor has a stable identity. ODF's optional
  // sheet-$ marker is normalized to that identity; row/column-$ are preserved.
  const match = value.match(/^(?:\$?('(?:[^']|'')*'|[\p{L}_][\p{L}\p{N}_.]*))?\.(\$?[A-Za-z]{1,3}\$?[1-9][0-9]{0,6})$/u);
  if (!match) { if (/#|(?:https?|file|ftp):|\\\\/i.test(value)) unsafe(); unsupported('Unsupported OpenFormula reference'); }
  return { ...(match[1] === undefined ? {} : { sheet: sheet(match[1]) }), cell: cell(match[2]) };
}
function odfReference(source: string): string {
  let quotedName = false, split = -1;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "'") { if (quotedName && source[i + 1] === "'") { i++; continue; } quotedName = !quotedName; }
    if (!quotedName && source[i] === ':') { if (split !== -1) unsupported('Three-dimensional references are not supported'); split = i; }
  }
  if (quotedName) unsupported('Unterminated sheet name');
  const first = odfEndpoint(split < 0 ? source : source.slice(0, split));
  const second = split < 0 ? undefined : odfEndpoint(source.slice(split + 1));
  if (second?.sheet !== undefined && second.sheet !== first.sheet) unsupported('Three-dimensional references are not supported');
  return (first.sheet === undefined ? '' : quoteSheet(first.sheet) + '!') + first.cell + (second ? ':' + second.cell : '');
}
function officeReference(first: Endpoint, second?: Endpoint): string {
  if (second?.sheet !== undefined && second.sheet !== first.sheet) unsupported('Three-dimensional references are not supported');
  const render = (point: Endpoint, inherited?: string) => {
    const name = point.sheet ?? inherited;
    return (name === undefined ? '' : '$' + quoteSheet(name)) + '.' + point.cell;
  };
  return '[' + render(first) + (second ? ':' + render(second, first.sheet) : '') + ']';
}

function convert(value: string, mode: 'toOdf' | 'toOffice'): string {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f]/.test(value)) unsupported('Formula size or control-character limit exceeded');
  const prefix = mode === 'toOdf' ? '=' : 'of:=';
  if (!value.startsWith(prefix)) unsupported('Unsupported formula namespace');
  const source = value.slice(prefix.length), tokens: Token[] = [];
  let p = 0;
  const add = (kind: Token['kind'], text: string) => { if (tokens.length >= 1024) unsupported('Formula token limit exceeded'); tokens.push({ kind, text }); };
  while (p < source.length) {
    const c = source[p];
    if (/\s/.test(c)) { p++; continue; }
    if (c === '"') {
      const start = p++;
      for (;;) { if (p >= source.length) unsupported('Unterminated formula string'); if (source[p++] !== '"') continue; if (source[p] === '"') { p++; continue; } break; }
      add('atom', source.slice(start, p)); continue;
    }
    if (mode === 'toOffice' && c === '[') {
      const end = source.indexOf(']', p + 1); if (end < 0) unsupported('Unterminated OpenFormula reference');
      add('atom', odfReference(source.slice(p + 1, end))); p = end + 1; continue;
    }
    const name = source.slice(p).match(identifier)?.[0];
    // Function recognition precedes cell recognition: LOG10 is not cell LOG10.
    if (name && /^\s*\(/.test(source.slice(p + name.length))) {
      const canonical = name.toUpperCase();
      if (activeFunctions.has(canonical) || activeFunctions.has(canonical.split('.').at(-1)!) || /\.REGISTER\.ID$/.test(canonical)) unsafe();
      if (!functions.has(canonical)) unsupported('Function is outside the supported OpenFormula subset');
      add('function', canonical); p += name.length; continue;
    }
    if (mode === 'toOdf') {
      const first = officeEndpoint(source, p);
      if (first) {
        p = first.end; let second: Endpoint | undefined;
        let after = p; while (/\s/.test(source[after] ?? '')) after++;
        if (source[after] === ':') { let start = after + 1; while (/\s/.test(source[start] ?? '')) start++; const end = officeEndpoint(source, start); if (!end) unsupported('Invalid reference range'); second = end.endpoint; p = end.end; }
        add('atom', officeReference(first.endpoint, second)); continue;
      }
    }
    const number = source.slice(p).match(/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?/)?.[0];
    if (number) { if (!Number.isFinite(Number(number))) unsupported('Non-finite formula number'); add('atom', number); p += number.length; continue; }
    const error = source.slice(p).match(/^#(?:DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!)/)?.[0];
    if (error) { add('atom', error); p += error.length; continue; }
    if (mode === 'toOdf' && /^(?:TRUE|FALSE)$/i.test(name ?? '')) { add('atom', name!.toUpperCase() + '()'); p += name!.length; continue; }
    if (c === '(') add('left', '(');
    else if (c === ')') add('right', ')');
    else if (c === (mode === 'toOdf' ? ',' : ';')) add('separator', mode === 'toOdf' ? ';' : ',');
    else {
      const op = source.slice(p).match(/^(?:<=|>=|<>|[+\-*/^&=<>%])/)?.[0];
      if (op) { add('operator', op); p += op.length; continue; }
      if (/[\[\]\\|]/.test(c) || /^(?:https?|file|ftp|data):/i.test(source.slice(p))) unsafe();
      unsupported();
    }
    p++;
  }
  // Validate expressions before rewriting. Commas are only function separators;
  // reference intersections/unions, arrays and named expressions stay unsupported.
  let at = 0, depth = 0;
  function expression(): void {
    if (++depth > 32) unsupported('Formula nesting limit exceeded');
    function term() {
      let unary = 0;
      while (tokens[at]?.kind === 'operator' && ['+', '-'].includes(tokens[at].text)) { if (++unary > 32) unsupported(); at++; }
      const token = tokens[at++]; if (!token) unsupported('Missing formula operand');
      if (token.kind === 'function') {
        if (tokens[at++]?.kind !== 'left') unsupported();
        if (tokens[at]?.kind !== 'right') {
          expression();
          while (tokens[at]?.kind === 'separator') { at++; expression(); }
        }
        if (tokens[at++]?.kind !== 'right') unsupported('Unbalanced function parentheses');
      } else if (token.kind === 'left') { expression(); if (tokens[at++]?.kind !== 'right') unsupported('Unbalanced formula parentheses'); }
      else if (token.kind !== 'atom') unsupported('Missing formula operand');
      while (tokens[at]?.kind === 'operator' && tokens[at].text === '%') at++;
    }
    term();
    while (tokens[at]?.kind === 'operator' && tokens[at].text !== '%') { at++; term(); }
    depth--;
  }
  expression(); if (at !== tokens.length) unsupported('Unexpected formula token');
  return (mode === 'toOdf' ? 'of:=' : '=') + tokens.map(token => token.text).join('');
}

export const officeFormulaToOdf = (formula: string): string => convert(formula, 'toOdf');
export const odfFormulaToOffice = (formula: string): string => convert(formula, 'toOffice');
