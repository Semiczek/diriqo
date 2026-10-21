// Export the immutable authoritative suite into three readable, independent
// rollback requests for provider transports with short request-state lifetimes.
// No hosted database access, no environment-file reads, no source/migration edits.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(root, 'supabase/tests/core-calculation-save.sql')
const runnerPath = path.join(root, 'scripts/test-core-calculation-save-sql.mjs')
// Hash canonical UTF-8 LF content so Git autocrlf cannot change the review gate.
const expectedSourceHash = '8cca70b5b6e90aa4690c3064699e7408f878da8e51a1a751c2db77a06286f208'
const bytes = await readFile(sourcePath)
const sha256 = value => createHash('sha256').update(value).digest('hex')
const sourceRawSha256 = sha256(bytes)
const sourceHashNormalization = 'CRLF-to-LF'
const canonicalSource = bytes.toString('utf8').replace(/\r\n/g, '\n')
assert.equal(sha256(canonicalSource), expectedSourceHash, 'Authoritative LF-normalized suite changed: review boundaries before exporting')
const lines = canonicalSource.split('\n')
const slice = (first, last) => lines.slice(first - 1, last).join('\n') + '\n'
const firstLine = prefix => {
  const index = lines.findIndex(line => line.startsWith(prefix))
  assert.ok(index >= 0, 'Missing reviewed SQL boundary: ' + prefix)
  return index + 1
}
const bodyStart = firstLine('  result:=public.create_core_calculation_atomic(ca,op,input);')
const historyStart = firstLine('  -- Legacy unknown values')
const licenceStart = firstLine("  update public.company_modules set is_enabled=false")
const footerStart = firstLine("  raise exception 'ROLLBACK_CALCULATION_FIXTURES'")
const footerEnd = firstLine("select current_setting('diriqo.core_calculation_test_result')")
const firstReset = lines.findIndex((line, index) => index >= bodyStart && line === "  execute 'reset role';") + 1
const preimageStart = firstLine('  select to_jsonb(x) into preimage from public.calculations x where id=calculation;')
const firstUpdate = firstLine('  result:=public.update_core_calculation_atomic(ca,calculation,1,update_op,updated);')
const updateReset = lines.findIndex((line, index) => index >= firstUpdate && line === "  execute 'reset role';") + 1
const knownVersion = firstLine('  select id into known_version from public.calculation_versions')
const beforeReplay = lines.findIndex((line, index) => index >= knownVersion && line === '  execute state_sql into before_state using ca;') + 1
assert.ok(bodyStart < historyStart && historyStart < licenceStart && licenceStart < footerStart)
assert.ok(firstReset > bodyStart && updateReset > firstUpdate && beforeReplay > knownVersion)
const header = slice(1, bodyStart - 1)
const footer = slice(footerStart, footerEnd)
// Reuse original executable setup. Its assertions still all execute in part A.
const repeatedSetup = [
  slice(bodyStart, bodyStart + 1), slice(firstReset, firstReset),
  slice(preimageStart, firstUpdate), slice(updateReset, updateReset), slice(knownVersion, beforeReplay),
].join('')
const splitC = process.argv.includes('--split-c')
let definitions = [
  { id:'a-create-input', first:bodyStart, last:historyStart - 1, expectedCount:59, setup:'' },
  { id:'b-history-access', first:historyStart, last:licenceStart - 1, expectedCount:26, setup:repeatedSetup },
  { id:'c-licence-rollback', first:licenceStart, last:footerStart - 1, expectedCount:19, setup:repeatedSetup },
]
// Consecutive body ranges retain every original assertion exactly once.
assert.equal(definitions[0].first, bodyStart)
for (let i = 1; i < definitions.length; i++) assert.equal(definitions[i].first, definitions[i - 1].last + 1)
assert.equal(definitions.at(-1).last, footerStart - 1)

if (splitC) {
  const faultStart = firstLine('  -- A trigger fault after header/history writes')
  const revokeStart = firstLine('  update private.company_test_module_grants set revoked_at=')
  const expiryStart = firstLine("  for c in select unnest(array['create','update']) kind loop")
  const deleteStart = firstLine('  delete from private.company_module_rollouts where company_id=ca;')
  const rolloutSetup = firstLine('  insert into private.company_module_rollouts(company_id,product,livemode)')
  const grantSetup = firstLine('  insert into private.company_test_module_grants(id,company_id,product,source_ref')
  const coreOnlySetup = slice(rolloutSetup, rolloutSetup) + slice(grantSetup, grantSetup + 1)
  definitions = [
    { id:'c1-licences-delete', first:licenceStart, last:footerStart - 1, expectedCount:13, setup:repeatedSetup,
      ranges:[[licenceStart, faultStart - 1], [revokeStart, expiryStart - 1], [deleteStart, footerStart - 1]] },
    { id:'c2-late-faults', first:faultStart, last:revokeStart - 1, expectedCount:4,
      setup:repeatedSetup + coreOnlySetup, ranges:[[faultStart, revokeStart - 1]] },
    { id:'c3-expiry', first:expiryStart, last:deleteStart - 1, expectedCount:2,
      setup:repeatedSetup + coreOnlySetup + slice(revokeStart, revokeStart), ranges:[[expiryStart, deleteStart - 1]] },
  ]
  const covered = definitions.flatMap(part => part.ranges.flatMap(([first, last]) => Array.from({length:last-first+1},(_,i)=>first+i))).sort((a,b)=>a-b)
  assert.deepEqual(covered, Array.from({length:footerStart-licenceStart},(_,i)=>licenceStart+i),
    'Split C must retain every original statement exactly once; setup alone may repeat')
}
const requestedScenarios = splitC ? 19 : 104

const outputDir = await mkdtemp(path.join(tmpdir(), 'diriqo-core-calculation-chunks-'))
const parts = []
for (const part of definitions) {
  const reportKey = 'diriqo.core_calculation_' + part.id.replaceAll('-', '_')
  let reportFooter = footer
    .replaceAll('diriqo.core_calculation_test_result', reportKey)
    .replace("jsonb_build_object('fixtures','rolled_back',",
      "jsonb_build_object('chunk','" + part.id + "','source_sha256','" + expectedSourceHash + "','fixtures','rolled_back',")
  // apply_migration may omit result sets. These assertions execute inside DO
  // after forced fixture rollback, before the provider can record success.
  const cleanupProof = "  assert jsonb_array_length(passed)=" + part.expectedCount + ",'expected_scenario_count_" + part.id + "';\n"
    + "  assert to_regprocedure('private.core_calculation_test_fault()') is null\n"
    + "   and to_regprocedure('private.core_calculation_test_expiry()') is null,'no_test_functions_after_rollback';\n"
    + "  assert not exists(select 1 from pg_trigger where not tgisinternal and tgname in('core_calculation_test_fault','core_calculation_test_expiry')),'no_test_triggers_after_rollback';\n"
  reportFooter = reportFooter.replace("  perform set_config(", cleanupProof + "  perform set_config(")
  const requiresDdlTool = ['c2-late-faults','c3-expiry','c-licence-rollback'].includes(part.id)
  const collisionGuard = "  assert to_regprocedure('private.core_calculation_test_fault()') is null\n"
    + "   and to_regprocedure('private.core_calculation_test_expiry()') is null,'test_function_names_must_be_unused';\n"
    + "  assert not exists(select 1 from pg_trigger where not tgisinternal and tgname in('core_calculation_test_fault','core_calculation_test_expiry')),'test_trigger_names_must_be_unused';\n"
  const guardedHeader = requiresDdlTool ? header.replace('\nbegin\n', '\nbegin\n' + collisionGuard) : header
  const body = part.ranges ? part.ranges.map(([first,last]) => slice(first,last)).join('') : slice(part.first,part.last)
  const sql = '-- Generated from immutable core-calculation-save.sql; source lines '
    + part.first + '-' + part.last + '. Independent synthetic rollback only.\n'
    + guardedHeader + part.setup + body + reportFooter
  assert.ok(sql.length < 18000, 'Unexpected transport growth: keep requests readable and small')
  const file = path.join(outputDir, part.id + '.sql')
  await writeFile(file, sql, 'utf8')
  parts.push({ id:part.id, file, sourceBodyLines:part.ranges ?? [[part.first, part.last]], requiresDdlTool,
    expectedCount:part.expectedCount, cleanupAssertions:5, characters:sql.length, bytes:Buffer.byteLength(sql),
    sha256:sha256(sql) })
}
const manifest = {
  schemaVersion:1, sourcePath, sourceSha256:expectedSourceHash, sourceRawSha256, sourceHashNormalization, totalScenarios:requestedScenarios, completeSuiteScenarios:104,
  notes:'All original assertions are retained. Repeated fixture setup is not counted again. Each part rolls back and checks cleanup independently.',
  parts, localVerification:null,
}
const manifestPath = path.join(outputDir, 'manifest.json')
if (process.argv.includes('--verify-local')) {
  assert.ok(process.env.PGLITE_MODULE && path.isAbsolute(process.env.PGLITE_MODULE), 'Set existing absolute PGLITE_MODULE for local verification')
  let runner = await readFile(runnerPath, 'utf8')
  const rootAnchor = "const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')"
  assert.equal(runner.split(rootAnchor).length, 2, 'Runner root anchor changed')
  runner = runner.replace(rootAnchor, 'const root = ' + JSON.stringify(root))
  const testAnchor = "  const reports = await db.exec(await sql('supabase/tests/core-calculation-save.sql'))"
  assert.equal(runner.split(testAnchor).length, 2, 'Runner test anchor changed')
  const verification = testAnchor + '\n' + [
    '  const baseline = reports.at(-1)?.rows[0]?.result',
    '  const chunkResults = []',
    '  const expectedChunkPassed = ' + (splitC ? 'baseline.passed.slice(-19)' : 'baseline.passed') + ';',
    '  for (const part of ' + JSON.stringify(parts) + ') {',
    '    const chunkStarted = performance.now()',
    "    const chunkReport = (await db.exec(await readFile(part.file, 'utf8'))).at(-1)?.rows[0]?.result",
    '    assert.equal(chunkReport?.chunk, part.id)',
    "    assert.equal(chunkReport?.fixtures, 'rolled_back')",
    '    assert.equal(chunkReport?.count, part.expectedCount)',
    '    assert.equal(chunkReport?.cleanup_assertions, 5)',
    '    chunkReport.localRuntimeMs = Math.round(performance.now() - chunkStarted)',
    '    chunkResults.push(chunkReport)',
    '  }',
    '  assert.equal(chunkResults.reduce((sum, part) => sum + part.count, 0), expectedChunkPassed.length)',
    '  assert.deepEqual(chunkResults.flatMap(part => part.passed).sort(), [...expectedChunkPassed].sort(),',
    "    'Split suite must preserve the complete multiset of requested original scenario results')",
  ].join('\n')
  runner = runner.replace(testAnchor, verification)
  const outputAnchor = "migration_preservation_assertions:5, ...result, local_paid:localPaid"
  assert.equal(runner.split(outputAnchor).length, 2, 'Runner report anchor changed')
  runner = runner.replace(outputAnchor, outputAnchor + ', hosted_chunks:chunkResults')
  const localRunner = path.join(outputDir, 'verify-chunks.mjs')
  await writeFile(localRunner, runner, 'utf8')
  const executed = spawnSync(process.execPath, [localRunner], {
    cwd:root, env:process.env, encoding:'utf8', maxBuffer:2 * 1024 * 1024,
  })
  if (executed.status !== 0) {
    process.stderr.write(executed.stderr || executed.stdout || 'Local chunk verification did not finish.\n')
    throw new Error('Local verification failed; do not run generated chunks on hosted DB')
  }
  const evidence = JSON.parse(executed.stdout)
  const evidencePath = path.join(outputDir, 'local-verification.json')
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n', 'utf8')
  manifest.localVerification = {
    passed:true, report:evidencePath, totalScenarios:requestedScenarios, completeSuiteScenarios:evidence.count,
    chunkCounts:evidence.hosted_chunks.map(part => ({ id:part.chunk, count:part.count, cleanup:part.cleanup_assertions, localRuntimeMs:part.localRuntimeMs })),
    identicalScenarioMultiset:true, migrationPreservation:evidence.migration_preservation_assertions,
    localPaidScenarios:evidence.local_paid.count, localPaidCleanup:evidence.local_paid.cleanup_assertions,
  }
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
console.log(JSON.stringify({ manifest:manifestPath, ...manifest }, null, 2))
