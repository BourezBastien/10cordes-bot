import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // Le bot, sur cette machine ; `API_PROXY_TARGET` le place ailleurs (bot distant, serveur d'essai).
        target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // Les polices restent des fichiers : la CSP des pages (font-src 'self')
    // refuse les données embarquées, et un fichier se met en cache un an.
    assetsInlineLimit: 0,
  },
});
