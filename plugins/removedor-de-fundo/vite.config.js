import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        format: 'iife',
      },
    },
  },
});

