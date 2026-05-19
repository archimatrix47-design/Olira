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

  // Server config
  server: {
    host: true,
    port: 3000,
  },
});
