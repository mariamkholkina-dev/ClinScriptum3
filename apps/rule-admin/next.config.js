/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@clinscriptum/shared"],
};

module.exports = nextConfig;
