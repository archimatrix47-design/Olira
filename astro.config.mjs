import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',

  // Image optimization
  image: {
    service: {
      entrypoint: 'astro/assets/services/sharp'
    },
  },

  // Vite config for minimal bundle and API proxy
  vite: {
    build: {
      // esbuild, not terser: terser runs in Node worker threads, and on the
      // server even two of them could not reserve their memory inside the cPanel
      // deploy task's 4 GB address-space cap ("Failed to reserve virtual memory
      // for CodeRange"). esbuild minifies in its own process. Cost: 3 KB of
      // compressed script across the whole site (157 KB to 160 KB).
      minify: 'esbuild',
      rollupOptions: {
        output: {
          manualChunks: undefined
        }
      }
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, '/api'),
          secure: false,
          ws: true
        }
      }
    }
  },

  // Dev server config.
  // Port 4321 (Astro's default) deliberately — NOT 3000, which is the Express
  // API (server.js). They collided before, so Astro silently auto-incremented
  // to 3001/3002/… and the frontend URL changed between runs. The `/api` proxy
  // above still points at the API on :3000.
  server: {
    host: true,
    port: 4321,
  },
});
