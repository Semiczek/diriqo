import { build } from 'esbuild';
import { mkdir, writeFile, readFile, cp, rm, lstat } from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {fortuneSafeTransformPlugin} from './fortune-safe-transform.mjs';
import {browserReactPeerPlugin,assertBrowserEsmPeerEdges} from './browser-react-peer.mjs';
const output=resolve('dist');
if(dirname(output)!==resolve('.')||basename(output)!=='dist'||(await lstat(output).catch(()=>null))?.isSymbolicLink())throw Error('Unsafe build output directory');
await rm(output,{recursive:true,force:true});
await mkdir(output, { recursive: true });
// Resolve dependencies through the package-local path even when node_modules is a junction.
// Otherwise esbuild chunk hashes embed the external checkout layout and differ from CI.
const shared = { preserveSymlinks: true, bundle: true, minify: true, sourcemap: false, logLevel: 'info', legalComments: 'linked', target: 'es2022', plugins:[fortuneSafeTransformPlugin()] };
const client = await build({ ...shared, plugins:[...shared.plugins,browserReactPeerPlugin()], entryPoints: { client: 'src/client/index.ts' }, outdir: 'dist', format: 'esm', splitting: true, platform: 'browser', external: ['react', 'react-dom', 'react/*', 'react-dom/*'], banner: { js: '"use client";' }, metafile: true, loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' } });
assertBrowserEsmPeerEdges(client.metafile);
await build({ ...shared, entryPoints: ['src/server/index.ts'], outfile: 'dist/server.js', format: 'esm', platform: 'node', banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } });
await build({ ...shared, entryPoints: ['src/server/import-worker.ts'], outfile: 'dist/import-worker.js', format: 'esm', platform: 'node', banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } });
await build({ ...shared, entryPoints: ['src/core/types.ts'], outfile: 'dist/core.js', format: 'esm', platform: 'neutral' });
await writeFile('dist/build-meta.json', JSON.stringify(client.metafile, null, 2));
// Public declarations are generated/reviewed with the existing host compiler and versioned here.
await cp('types','dist',{recursive:true});
const p = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile('dist/package-runtime.json', JSON.stringify({ name: p.name, version: p.version, private: true, type: 'module', exports: p.exports, peerDependencies: p.peerDependencies }, null, 2));
