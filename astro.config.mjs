import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  integrations: [tailwind()],
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
      minify: 'terser',
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
