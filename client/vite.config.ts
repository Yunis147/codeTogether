import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // y-monaco and worker imports reference monaco-editor's internal esm/vs modules.
      // Monaco's export map restricts subpath imports, so resolve them directly.
      'monaco-editor/esm/vs': fileURLToPath(
        new URL('../node_modules/monaco-editor/esm/vs', import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/sync': {
        target: 'ws://localhost:1234',
        ws: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
});
