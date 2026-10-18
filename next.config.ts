import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Office's Node worker entry point native instead of bundling its dist directory.
  serverExternalPackages: ['@diriqo/office/server'],
  outputFileTracingIncludes: { '/api/office/files': ['./node_modules/@diriqo/office/dist/import-worker.js', './node_modules/@diriqo/office/package.json', './node_modules/@diriqo/office/dist/*.LEGAL.txt', './node_modules/@diriqo/office/licenses/**/*', './node_modules/@diriqo/office/THIRD_PARTY_LICENSES.md', './node_modules/@diriqo/office/ASSET_LICENSES.md'] },
  experimental: { serverActions: { bodySizeLimit: '4mb' } },
};

export default nextConfig;
