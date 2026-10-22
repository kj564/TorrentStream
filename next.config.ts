import type { NextConfig } from "next";

// For GitHub Pages, the site is served at https://<user>.github.io/TorentStream/
// so we need basePath = "/TorentStream" during production builds.
// For local dev, basePath is empty so the site runs at http://localhost:3000/.
const isGithubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  // Static export for GitHub Pages (no server-side runtime).
  output: "export",
  // GitHub Pages project pages are served at /<repo-name>/, so all assets
  // must be prefixed with that path during build.
  basePath: isGithubPages ? "/TorentStream" : "",
  assetPrefix: isGithubPages ? "/TorentStream/" : undefined,
  // No image optimization in static export.
  images: { unoptimized: true },
  // Trailing slash so relative asset paths resolve correctly on GitHub Pages.
  trailingSlash: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
