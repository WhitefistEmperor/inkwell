import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the browser talks only to Vite; Vite forwards /api to
    // Express. Same origin for the browser means no CORS problems.
    proxy: { '/api': 'http://localhost:4000' },
  },
});
