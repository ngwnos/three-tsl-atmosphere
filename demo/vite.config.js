import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const allowedHosts = (env.ORCA_ALLOWED_HOSTS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  return {
    resolve: {
      alias: {
        'three-tsl-atmosphere': path.resolve(__dirname, '../src/index.ts'),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 3005,
      strictPort: true,
      allowedHosts,
    },
    preview: {
      host: '127.0.0.1',
      port: 3005,
      strictPort: true,
      allowedHosts,
    },
  }
})
