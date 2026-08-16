import { defineConfig } from "astro/config";

const isOrb = Boolean(process.env.AMP_ORB);

export default defineConfig({
  devToolbar: {
    enabled: false,
  },
  server: {
    port: 4321,
  },
  vite: {
    server: {
      strictPort: true,
      ...(isOrb ? { allowedHosts: true } : {}),
    },
    preview: {
      strictPort: true,
    },
  },
});
