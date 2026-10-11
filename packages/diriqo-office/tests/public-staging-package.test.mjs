import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import * as crypto from 'node:crypto';
import * as zlib from 'node:zlib';
import { isDeploymentSource, assertDeploymentSourcePath, inspectDeploymentSource, assertRequiredDeploymentSources, createDeploymentBootstrap } from '../scripts/public-staging-source-policy.mjs';

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const entry = (file, text = 'synthetic source') => ({ file, sha256: digest(Buffer.from(text)), data: Buffer.from(text).toString('base64') });
const common = ['package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'postcss.config.mjs', 'proxy.ts', 'app/office/page.tsx', 'app/office/OfficeClient.tsx', 'app/office/actions.ts', 'app/logout/page.tsx', 'app/api/office/files/route.ts', 'app/api/office/context/route.ts', 'lib/office/context.ts', 'lib/office/staging-guard.ts', 'lib/office/http-limits.ts', 'lib/office/client-context.ts', 'lib/office/context-messages.ts', 'vendor/diriqo-office-0.1.0.tgz', 'vendor/office-integrity.json'];
const required = host => [...common, ...(host === 'hub' ? ['app/login/page.tsx'] : ['app/sign-in/page.tsx', 'app/auth/sign-in/route.ts', 'app/api/office/company/route.ts'])];
function unpack(entries, { wrongOuterHash = false, symlinks = [] } = {}) {
  const archive = zlib.gzipSync(Buffer.from(JSON.stringify(entries))), writes = [], directories = [];
  const fs = { readFileSync: file => { assert.equal(file, 'office-staging-source.json.gz'); return archive; }, existsSync: file => symlinks.includes(file), lstatSync: file => ({ isSymbolicLink: () => symlinks.includes(file) }), mkdirSync: file => directories.push(file), writeFileSync: (file, bytes) => writes.push({ file, text: bytes.toString() }) };
  const code = createDeploymentBootstrap(wrongOuterHash ? '0'.repeat(64) : digest(archive));
  return { writes, directories, run: () => vm.runInNewContext(code, { require: name => ({ 'node:fs': fs, 'node:path': path.posix, 'node:crypto': crypto, 'node:zlib': zlib })[name], process: { cwd: () => '/deployment' }, Buffer, console: { log() {} } }) };
}
function tarball(files) {
  const blocks = [];
  for (const [name, content] of files) {
    const bytes = Buffer.from(content), header = Buffer.alloc(512);
    header.write(name, 0, 100); header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124, 12); header[156] = 48; header.fill(32, 148, 156);
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8);
    blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return zlib.gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

test('deployment includes proxy and exact reviewed source route exceptions only', () => {
  assert.equal(isDeploymentSource('proxy.ts'), true);
  for (const file of ['.env.local', '.npmrc', '.staging/private.json', 'unreviewed.ts']) assert.equal(isDeploymentSource(file), false);
  for (const [host, file] of [['hub', 'app/offer/[token]/page.tsx'], ['hub', 'app/portal/reset-password/page.tsx'], ['diriqo', 'app/reset-password/page.tsx'], ['diriqo', 'lib/invites/token.ts']]) assert.equal(assertDeploymentSourcePath(host, file), file);
  assert.throws(() => assertDeploymentSourcePath('hub', 'lib/invites/token.ts'));
});

test('private data filenames are never transformed into permitted source names', () => {
  for (const file of ['public/credentials.json', 'scripts/secrets.txt', 'lib/password.ts', 'app/reset-password/credentials.json', 'public/private-key.pem', 'scripts/local.env', 'lib/.npmrc', 'public/.netrc', 'lib/.yarnrc.yml', 'scripts/.staging/state.json', 'lib/../safe.ts', 'lib/./safe.ts', 'lib//safe.ts', 'lib/back\\slash.ts', 'lib/C:drive.ts']) assert.throws(() => inspectDeploymentSource('hub', file, Buffer.from('{"password":"synthetic-value"}')), file);
});

test('all source extensions scan secret patterns including production connection credentials', () => {
  const secret = 'sb_' + 'secret_' + 'synthetic'.repeat(4);
  for (const suffix of ['txt', 'html', 'sql', 'ps1', 'js', 'css', 'png']) assert.throws(() => inspectDeploymentSource('hub', 'public/example.' + suffix, Buffer.from(secret)), suffix);
  assert.throws(() => inspectDeploymentSource('diriqo', 'lib/config.ts', Buffer.from('postgresql://' + 'synthetic:synthetic@production.invalid/db')));
  assert.doesNotThrow(() => inspectDeploymentSource('hub', 'lib/office/staging-guard.ts', Buffer.from('const deniedProductionRefs = ["yrxfozthravgbbcqklzy"];')));
});

test('nested Office JS is scanned in addition to notices and manifest', () => {
  const clean = [['package/package.json', '{"name":"@diriqo/office"}'], ['package/dist/index.js', 'export const safe = true;']];
  assert.doesNotThrow(() => inspectDeploymentSource('hub', 'vendor/diriqo-office-0.1.0.tgz', tarball(clean)));
  assert.throws(() => inspectDeploymentSource('hub', 'vendor/diriqo-office-0.1.0.tgz', tarball([...clean, ['package/dist/extra.js', 'sb_' + 'secret_' + 'synthetic'.repeat(4)]])));
});

test('every required host and Office source is mandatory including proxy', () => {
  for (const host of ['hub', 'diriqo']) {
    const files = required(host); assert.doesNotThrow(() => assertRequiredDeploymentSources(host, files));
    for (const omitted of files) assert.throws(() => assertRequiredDeploymentSources(host, files.filter(file => file !== omitted)), omitted);
    assert.throws(() => assertRequiredDeploymentSources(host, [...files, files[0]]));
  }
  assert.throws(() => assertRequiredDeploymentSources('production', common));
});

test('verified bootstrap writes matching source bytes beneath build root', () => {
  const harness = unpack([entry('app/office/page.tsx', 'office'), entry('proxy.ts', 'guard')]); harness.run();
  assert.deepEqual(harness.writes, [{ file: '/deployment/app/office/page.tsx', text: 'office' }, { file: '/deployment/proxy.ts', text: 'guard' }]);
});

test('archive hash failure prevents all source writes', () => {
  const harness = unpack([entry('proxy.ts')], { wrongOuterHash: true });
  assert.throws(harness.run, /archive mismatch/); assert.equal(harness.writes.length, 0); assert.equal(harness.directories.length, 0);
});

test('unsafe archive paths fail before even earlier valid entries are written', () => {
  for (const file of ['../escape', '/absolute', 'C:/escape', 'a/../../escape', 'a\\escape', 'a//b', './a', 'a/.', 'a/..', 'a/colon:name', 'a/\u0000name']) {
    const harness = unpack([entry('proxy.ts'), entry(file)]);
    assert.throws(harness.run, /Unsafe/); assert.equal(harness.writes.length, 0, file); assert.equal(harness.directories.length, 0, file);
  }
});

test('duplicate or case-colliding paths cannot overwrite source', () => {
  for (const file of ['proxy.ts', 'PROXY.TS']) {
    const harness = unpack([entry('proxy.ts'), entry(file, 'overwrite')]); assert.throws(harness.run, /duplicate/); assert.equal(harness.writes.length, 0);
  }
});

test('malformed shape, noncanonical base64 and content hash mismatch prevent partial writes', () => {
  for (const malformed of [null, { ...entry('other.ts'), extra: true }, { ...entry('other.ts'), file: 1 }, { ...entry('other.ts'), sha256: 'f'.repeat(64) }, { ...entry('other.ts'), data: entry('other.ts').data + '\n' }, { ...entry('other.ts'), data: 1 }]) {
    const harness = unpack([entry('proxy.ts'), malformed]); assert.throws(harness.run); assert.equal(harness.writes.length, 0); assert.equal(harness.directories.length, 0);
  }
});

test('preexisting symlink file or parent cannot redirect unpacking', () => {
  for (const symlink of ['/deployment/app', '/deployment/app/office', '/deployment/app/office/page.tsx']) {
    const harness = unpack([entry('proxy.ts'), entry('app/office/page.tsx')], { symlinks: [symlink] }); assert.throws(harness.run, /Symlink/); assert.equal(harness.writes.length, 0);
  }
});
