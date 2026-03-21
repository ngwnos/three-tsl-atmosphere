import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: false,
    launchOptions: {
      args: [
        '--no-sandbox',
        '--enable-unsafe-webgpu',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--enable-accelerated-2d-canvas',
        '--use-gpu-in-tests',
        '--use-angle=swiftshader',
        '--use-cmd-decoder=passthrough',
        '--disable-gpu-sandbox',
      ],
    },
  },
  webServer: {
    command:
      "bash -lc 'bun run build && bun run build:demo && cd demo && bunx vite preview --host 127.0.0.1 --port 4173 --strictPort'",
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
  },
})
