import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En développement, tout passe par le même origine (5173) : l'API, les fichiers publics et Socket.IO sont proxifiés
// vers le serveur. Le cookie de refresh, l'anti-CSRF (en-tête Origin) et l'anti-hotlink fonctionnent alors sans réglage.
const target = process.env.VITE_API_TARGET ?? 'http://localhost:5000';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target, changeOrigin: false },
      '/files': { target, changeOrigin: false },
      '/socket.io': { target, ws: true, changeOrigin: false },
    },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          data: ['@tanstack/react-query', 'zustand', 'zod', 'react-hook-form', '@hookform/resolvers'],
          motion: ['framer-motion'],
          socket: ['socket.io-client'],
        },
      },
    },
  },
});
