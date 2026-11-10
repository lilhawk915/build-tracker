import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// "pages" builds the live site for https://lilhawk915.github.io/build-tracker/
export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/build-tracker/' : '/',
  plugins: [react()],
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000 },
}));
