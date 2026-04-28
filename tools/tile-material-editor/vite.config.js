import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',           // relative asset paths — works from any serving location
  build: {
    outDir: '../tile-editor',   // output to tools/tile-editor/ (committed, served directly)
    emptyOutDir: true,
  },
});
