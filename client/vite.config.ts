import { createLogger, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const logger = createLogger();
const originalError = logger.error.bind(logger);
logger.error = (msg, options) => {
  const err = options?.error as NodeJS.ErrnoException | undefined;
  if (err?.code === 'ECONNREFUSED' || err?.code === 'EPIPE') {
    return;
  }
  originalError(msg, options);
};

export default defineConfig({
  customLogger: logger,
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
      '/uploads': 'http://localhost:3001',
      '/sync': {
        target: 'ws://localhost:3001',
        ws: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'ECONNREFUSED' || code === 'EPIPE') return;
            console.error('[vite] sync proxy error:', err.message);
          });
        },
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'ECONNREFUSED' || code === 'EPIPE') return;
            console.error('[vite] socket.io proxy error:', err.message);
          });
        },
      },
    },
  },
});
