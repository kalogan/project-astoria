import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/tools/tile-editor/',
  build: {
    outDir: '../../client/tools/tile-editor',
    emptyOutDir: true,
  },
});
