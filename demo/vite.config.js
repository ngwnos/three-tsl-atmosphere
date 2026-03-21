import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      'three-tsl-atmosphere': path.resolve(__dirname, '../src/index.ts'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 3005,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 3005,
    strictPort: true,
  },
})
