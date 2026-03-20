import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      'three-tsl-atmosphere': path.resolve(__dirname, '../src/index.ts'),
    },
  },
})
