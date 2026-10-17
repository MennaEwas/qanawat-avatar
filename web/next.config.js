const createNextPluginPreval = require("next-plugin-preval/config");
const withNextPluginPreval = createNextPluginPreval();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  output: "standalone",
  // Pin the tracing root to this app so the standalone bundle is self-contained
  // even when a parent directory has its own lockfile.
  outputFileTracingRoot: __dirname,
};

module.exports = withNextPluginPreval(nextConfig);
