// Run after `npm run build`; excluded from the source-only tests/*.test.mjs glob.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {importOfficeFileBounded} from '../../dist/server.js';
import {importOfficeFile} from '../../src/server/formats.ts';
import {alternativeOfficeFixtures} from '../fixtures/alternative-office.mjs';

for(const fixture of alternativeOfficeFixtures()) test(`built bounded worker imports ${fixture.name}`,async()=>{
 const expected=await importOfficeFile(fixture.name,fixture.bytes);
 const actual=await importOfficeFileBounded(fixture.name,fixture.bytes,new URL('../../dist/import-worker.js',import.meta.url));
 assert.deepEqual(actual,expected);
 assert.equal(actual.original.sha256,createHash('sha256').update(fixture.bytes).digest('hex'));
 assert.equal(actual.content.kind,fixture.kind);assert.equal(actual.original.mime,fixture.mime);
 assert.ok(actual.warnings.length);
});
