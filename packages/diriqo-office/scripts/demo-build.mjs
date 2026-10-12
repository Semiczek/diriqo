import { build } from 'esbuild';
import { mkdir, cp } from 'node:fs/promises';
import {fortuneSafeTransformPlugin} from './fortune-safe-transform.mjs';
await mkdir('.cache/demo', { recursive: true });
await build({ entryPoints: { demo: 'demo/main.tsx' }, outdir: '.cache/demo', bundle: true, splitting: true, format: 'esm', target: 'es2022', minify: false, legalComments: 'linked', plugins:[fortuneSafeTransformPlugin()], loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' } });
await cp('demo/index.html', '.cache/demo/index.html');
