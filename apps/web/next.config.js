/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // shared-types se consume como TS crudo desde el monorepo.
  transpilePackages: ['@healthflow/shared-types'],
};

module.exports = nextConfig;
