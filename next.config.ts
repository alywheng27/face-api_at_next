import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // face-api.js uses browser APIs (canvas, document).
  // This tells webpack NOT to bundle it on the server side.
  // webpack: (config, { isServer }) => {
  //   if (isServer) {
  //     // Replace face-api.js with an empty module on the server
  //     config.resolve.alias["face-api.js"] = false;
  //   }
  //   return config;
  // },
  /* config options here */
  reactCompiler: true,
};

export default nextConfig;
