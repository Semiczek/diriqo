import { gunzipSync } from 'node:zlib';
import { assertPublicReleasePath, assertNoReportSecrets, auditOfficeTarball } from './package-source.mjs';

const roots = new Set(['package.json', 'package-lock.json', 'next.config.ts', 'next-env.d.ts', 'tsconfig.json', 'postcss.config.mjs', 'eslint.config.mjs', 'proxy.ts']);
const reviewedSourceNames = {
  hub: new Set(['app/api/offers/[token]/pdf/route.ts', 'app/offer/[token]/page.tsx', 'app/portal/change-password/page.tsx', 'app/portal/reset-password/page.tsx']),
  diriqo: new Set(['app/[locale]/invite/[token]/page.tsx', 'app/api/offers/[token]/pdf/route.ts', 'app/forgot-password/page.tsx', 'app/invite/[token]/InviteBridgeClient.tsx', 'app/invite/[token]/page.tsx', 'app/offer/[token]/page.tsx', 'app/portal/change-password/page.tsx', 'app/portal/reset-password/page.tsx', 'app/reset-password/page.tsx', 'lib/invites/token.ts']),
};
export function isDeploymentSource(file) {
  return roots.has(file) || /^(?:app|components|hooks|lib|public|types|scripts|vendor)\//.test(file);
}
export function assertDeploymentSourcePath(host, file) {
  if (!Object.hasOwn(reviewedSourceNames, host) || typeof file !== 'string' || !isDeploymentSource(file)) throw Error('Unreviewed deployment source');
  if (file.includes('\\') || /[\u0000-\u001f\u007f:]/.test(file)
    || file.split('/').some(part => /^\.(?:npmrc|yarnrc(?:\..*)?|netrc|pypirc)$/i.test(part) || /\.env$/i.test(part))) throw Error('Private deployment source path');
  // Only exact reviewed route/source filenames receive an exception, never a data file.
  const checked = reviewedSourceNames[host].has(file)
    ? file.replace(/\[token\]|(?:forgot|reset|change)-password/g, 'reviewed-source').replace(/\/token\.ts$/, '/reviewed-source.ts')
    : file;
  assertPublicReleasePath(checked);
  return file;
}
export function inspectDeploymentSource(host, file, bytes) {
  assertDeploymentSourcePath(host, file);
  if (file.endsWith('.tgz')) {
    auditOfficeTarball(bytes);
    // Include JS/CSS in the nested-content scan, not just notices/JSON.
    assertNoReportSecrets(file, gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 }));
  } else {
    // Text may also be stored in .txt/.html/.sql/.ps1 or binary metadata.
    assertNoReportSecrets(file, bytes);
  }
}
export function assertRequiredDeploymentSources(host, files) {
  const names = files.map(entry => typeof entry === 'string' ? entry : entry.file);
  if (names.length > 3000 || new Set(names).size !== names.length) throw Error('Invalid deployment source count/duplicates');
  const required = [
    'package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'postcss.config.mjs', 'proxy.ts',
    'app/office/page.tsx', 'app/office/OfficeClient.tsx', 'app/office/actions.ts', 'app/logout/page.tsx',
    'app/api/office/files/route.ts', 'app/api/office/context/route.ts', 'lib/office/context.ts',
    'lib/office/staging-guard.ts', 'lib/office/http-limits.ts', 'lib/office/client-context.ts', 'lib/office/context-messages.ts',
    'vendor/diriqo-office-0.1.0.tgz', 'vendor/office-integrity.json',
    ...(host === 'hub' ? ['app/login/page.tsx'] : host === 'diriqo' ? ['app/sign-in/page.tsx', 'app/auth/sign-in/route.ts', 'app/api/office/company/route.ts'] : []),
  ];
  if (!Object.hasOwn(reviewedSourceNames, host)) throw Error('Unknown deployment host');
  for (const requiredFile of required) if (!names.includes(requiredFile)) throw Error('Required reviewed public staging source missing: ' + requiredFile);
}

/** Serialized as a standalone CJS bootstrap. No external lexical dependencies. */
function unpackDeployment(expectedHash) {
  const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), crypto = require('node:crypto');
  const root = process.cwd(), bytes = fs.readFileSync('office-staging-source.json.gz');
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw Error('Deployment archive mismatch');
  const entries = JSON.parse(zlib.gunzipSync(bytes, { maxOutputLength: 96 * 1024 * 1024 }));
  if (!Array.isArray(entries) || entries.length > 3000) throw Error('Invalid source count');
  const seen = new Set(), checked = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).sort().join(',') !== 'data,file,sha256' || typeof entry.file !== 'string'
      || !entry.file || entry.file.includes('\\') || /[\u0000-\u001f\u007f:]/.test(entry.file)
      || entry.file.startsWith('/') || entry.file.split('/').some(part => !part || part === '.' || part === '..')
      || typeof entry.data !== 'string' || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw Error('Unsafe source entry');
    const destination = path.resolve(root, entry.file), folded = destination.toLowerCase();
    if (!destination.startsWith(root + path.sep) || seen.has(folded)) throw Error('Unsafe or duplicate destination');
    seen.add(folded);
    // Never traverse a pre-existing symlink left in a build directory.
    for (let current = destination; current !== root; current = path.dirname(current)) {
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error('Symlink deployment destination');
    }
    const content = Buffer.from(entry.data, 'base64');
    if (content.toString('base64') !== entry.data || crypto.createHash('sha256').update(content).digest('hex') !== entry.sha256) throw Error('Source digest mismatch');
    checked.push({ destination, content });
  }
  // Validate every entry first: an invalid later entry leaves no partial source tree.
  for (const { destination, content } of checked) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  }
  console.log('Verified isolated Office staging source files: ' + entries.length);
}
export function createDeploymentBootstrap(hash) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw Error('Invalid deployment archive hash');
  return '(' + unpackDeployment.toString() + ')(' + JSON.stringify(hash) + ');\n';
}
