/** @type {import('next').NextConfig} */
const api = process.env.API_URL || 'http://localhost:4000';
export default {
  output: 'standalone',
  transpilePackages: ['@bos/shared'],
  // The browser talks to the API through the web origin, so the session cookie stays first-party.
  async rewrites() { return [{ source: '/api/:path*', destination: `${api}/api/:path*` }]; },
};
