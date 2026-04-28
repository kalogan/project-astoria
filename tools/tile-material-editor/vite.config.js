import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: '/tools/tile-editor/',
  build: {
    outDir: path.resolve(__dirname, '../../dist/tools/tile-editor'),
    emptyOutDir: true,
  },
});
