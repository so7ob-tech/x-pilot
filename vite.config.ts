import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(root, 'index.html'),
        background: resolve(root, 'src/background/service-worker.ts'),
        content: resolve(root, 'src/content/content-entry.ts')
      },
      output: {
        entryFileNames: (chunk) => chunk.name === 'sidepanel' ? 'assets/[name].js' : '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
});
