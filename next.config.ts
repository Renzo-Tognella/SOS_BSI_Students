import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel file tracing does not detect dynamic fs reads (data/matrizes, etc.) automatically.
  // Keep the entire data folder available for Node.js API routes in production/serverless.
  outputFileTracingIncludes: {
    "/*": ["./data/**/*"]
  }
};

export default nextConfig;
