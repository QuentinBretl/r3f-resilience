import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The demo imports the library by name, the same way a consumer would, so
  // the published entry point is the one actually exercised here.
  resolve: {
    alias: { 'r3f-resilience': new URL('./src/index.js', import.meta.url).pathname },
  },
});
