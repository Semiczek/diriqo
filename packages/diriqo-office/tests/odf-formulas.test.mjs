import test from 'node:test';
import assert from 'node:assert/strict';
import { officeFormulaToOdf as toOdf, odfFormulaToOffice as toOffice, OdfFormulaError } from '../src/server/odf-formulas.ts';

test('OpenFormula preserves ordinary ranges and absolute/relative row/column markers', () => {
  const source = '=SUM(A1:$B$2,C$3,$D4)+AVERAGE(E1:E10)';
  const expected = 'of:=SUM([.A1:.$B$2];[.C$3];[.$D4])+AVERAGE([.E1:.E10])';
  assert.equal(toOdf(source), expected); assert.equal(toOffice(expected), source);
});
test('OpenFormula preserves quoted Unicode sheet names and apostrophes', () => {
  const source = "='Kalkulace'!$B$1*2+'Tom''s žluťoučký list'!A$4";
  const expected = "of:=[$'Kalkulace'.$B$1]*2+[$'Tom''s žluťoučký list'.A$4]";
  assert.equal(toOdf(source), expected); assert.equal(toOffice(expected), source);
  assert.equal(toOffice("of:=SUM(['Žluťoučký list'.A1:.$B$2])"), "=SUM('Žluťoučký list'!A1:$B$2)");
  assert.equal(toOffice('of:=[$Sheet2.$A1]+[List1.A$2]'), "='Sheet2'!$A1+'List1'!A$2");
  assert.equal(toOffice(toOdf("=SUM('Česká firma'!A1:B9)")), "=SUM('Česká firma'!A1:B9)");
});
test('Formula string literals remain byte-for-byte unchanged across conversion', () => {
  const source = '=IF(A1="Sheet!$B$2;[.C3]","He said ""A1:B2"", okay","Ω")';
  assert.equal(toOdf(source), 'of:=IF([.A1]="Sheet!$B$2;[.C3]";"He said ""A1:B2"", okay";"Ω")');
  assert.equal(toOffice(toOdf(source)), source);
});
test('Arithmetic, comparisons, nested functions and numeric exponents are preserved', () => {
  for (const source of ['=ROUND((SUM(A1:A5)-2.5E-3)/10,2)', '=IF(AND(A1>=1,B1<>2),-C1,+D1%)', '=2^3^4&"x"', '=#DIV/0!', '=TRUE()', '=IF(A1,TRUE,FALSE)']) {
    const normalized = source.replace(/\bTRUE\b(?!\()/g, 'TRUE()').replace(/\bFALSE\b(?!\()/g, 'FALSE()');
    assert.equal(toOffice(toOdf(source)), normalized);
  }
  assert.equal(toOdf('=sum( a1 : B2 )'), 'of:=SUM([.A1:.B2])');
});
test('Unsupported named, 3D, array and malformed formulas fail with a typed error', () => {
  for (const value of ['=NamedValue+1', '=SUM(A:A)', '=SUM(1:10)', '=A1 B1', '=SUM(A1,,2)', '=SUM(', '=A1+', '=1 2', '=SUM({1,2})', "='One'!A1:'Two'!B2", '=XFE1', '=A1048577', '=LOG10(2)', '=1e999']) assert.throws(() => toOdf(value), e => e instanceof OdfFormulaError && e.code === 'UNSUPPORTED_FORMULA');
  for (const value of ['oooc:=SUM([.A1])', 'of:=A1+2', 'of:=SUM([.A1]~[.B2])', "of:=['A'.A1:'B'.B2]", 'of:=[.A1]+', 'of:=[.A1', 'of:=SUM({1;2})', 'of:=COM.MICROSOFT.XLOOKUP(1;[.A1])']) assert.throws(() => toOffice(value), OdfFormulaError);
});
test('External and active references/functions are rejected distinctly', () => {
  for (const value of ['=WEBSERVICE("https://example.test")', '=DDE("app","topic","item")', '=[other.xlsx]Sheet1!A1', '=A1|B1']) assert.throws(() => toOdf(value), e => e.code === 'UNSAFE_FORMULA');
  for (const value of ["of:=['file:///secret'#'Sheet1'.A1]", 'of:=WEBSERVICE("https://example.test")', 'of:=DDE("app";"topic";"item")', 'of:=COM.MICROSOFT.WEBSERVICE("https://example.test")', 'of:=ORG.OPENOFFICE.DDE("app";"topic";"item")']) assert.throws(() => toOffice(value), e => e.code === 'UNSAFE_FORMULA');
});
test('Formula parser enforces input, token and nesting limits without evaluating', () => {
  assert.throws(() => toOdf('=' + '('.repeat(40) + '1' + ')'.repeat(40)), /nesting/);
  assert.throws(() => toOdf('=' + '1+'.repeat(2100) + '1'), /size/);
  assert.throws(() => toOdf('=A1\n+2'), /control/);
  assert.throws(() => toOffice('of:="unterminated'), /Unterminated/);
});
