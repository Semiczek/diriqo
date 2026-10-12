/**
 * Diriqo Office modification of @fortune-sheet/core 1.0.4 MIT source.
 * Removes three dynamic Function constructors used only to insert rows.
 * Adds the Office formula-budget/cycle gate and fixes explicit-sheet calculation writes.
 * Original notices: licenses/texts/_fortune-sheet_core@1.0.4/.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const FORTUNE_CORE_HASHES = Object.freeze({
  'index.esm.js': '579fa2bcc2797c0f8ea1c588f610345fc94a72b824ba473bfbd9d4536512e8fe',
  'index.js': '39f929eae09794138c32385f2b9aedb3687e69d9abaa6c91fd577ebb55283cd8',
});

const replacements = Object.freeze([
  ['new Function("d", "return d.unshift(".concat(arr.join(","), ")"))(d);',
   'd.unshift(...arr.map(function (value) { return JSON.parse(value); }));'],
  ['new Function("d", "return d.splice(".concat(index, ", 0, ").concat(arr.join(","), ")"))(d);',
   'd.splice(index, 0, ...arr.map(function (value) { return JSON.parse(value); }));'],
  ['new Function("d", "return d.splice(".concat(index + 1, ", 0, ").concat(arr.join(","), ")"))(d);',
   'd.splice(index + 1, 0, ...arr.map(function (value) { return JSON.parse(value); }));'],
]);

export function transformFortuneCore(source, filename = 'index.esm.js') {
  const expected = FORTUNE_CORE_HASHES[path.basename(filename)];
  const actual = crypto.createHash('sha256').update(source).digest('hex');
  if (!expected || expected !== actual) {
    throw new Error('FortuneSheet source differs from audited 1.0.4; review license and safe transform before upgrading: ' + filename);
  }
  let output = source;
  for (const [before, after] of replacements) {
    if (output.split(before).length !== 2) {
      throw new Error('Expected exactly one FortuneSheet row-insertion statement: ' + before);
    }
    output = output.replace(before, after);
  }
  const entry='function execfunction(ctx, txt, r, c, id, calcChainSet, isrefresh, notInsertFunc) {';
  const write='setCellValue$1(ctx, r, c, result[1], null);';
  const result='var result = parsedResponse.result;';
  for(const value of [entry,write,result])if(output.split(value).length!==2)throw new Error('Fortune calculation source changed; review the pinned transform.');
  output=output.replace(entry,entry+'\n  var officeError = __officeFormulaGuard(ctx, txt, r, c, id);\n  if (officeError) return [true, officeError, txt];');
  output=output.replace(write,'setCellValue$1(ctx, r, c, result[1], { id: id });');
  output=output.replace(result,result+'\n  if (typeof result === "string" && result.length > 32767 || Array.isArray(result)) result = "#OFFICE_LIMIT!";\n  if (typeof result === "number" && !Number.isFinite(result)) result = "#NUM!";');
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(output)) {
    throw new Error('Unexpected dynamic code evaluation remains in FortuneSheet core');
  }
  const guard=path.resolve('src/core/fortune-formula-guard.ts').replaceAll('\\','/');
  return '// Diriqo Office modifications: safe row insertion, bounded formula graph, explicit sheet writes. Original MIT notices retained.\nimport { guardFortuneCalculation as __officeFormulaGuard } from '+JSON.stringify(guard)+';\n' + output;
}

export function fortuneSafeTransformPlugin() {
  return {
    name: 'diriqo-fortune-safe-row-insertion',
    setup(build) {
      build.onLoad({ filter: /[\\/]@fortune-sheet[\\/]core[\\/]dist[\\/]index(?:\.esm)?\.js$/ }, async args => ({
        contents: transformFortuneCore(await fs.readFile(args.path, 'utf8'), args.path),
        loader: 'js',
        resolveDir: path.dirname(args.path),
      }));
    },
  };
}
