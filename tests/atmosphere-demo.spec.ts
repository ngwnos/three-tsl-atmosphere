import { expect, test, type Page } from '@playwright/test'
import { PNG } from 'pngjs'

type FrameStats = {
  averageLuminance: number
  maxLuminance: number
  minLuminance: number
  nonBlackFraction: number
}

const ATMOSPHERE_MUTATION_TARGETS: Record<string, number> = {
  skyIntensity: 1.55,
  skyTintR: 1.1,
  skyTintG: 0.96,
  skyTintB: 1.18,
  sunDiscIntensity: 1.1,
  sunDiscColorR: 1.08,
  sunDiscColorG: 0.95,
  sunDiscColorB: 0.82,
  sunDiscInnerScale: 0.72,
  sunDiscOuterScale: 2.35,
  planetRadiusM: 6_650_000,
  atmosphereHeightM: 72_000,
  rayleighScaleHeightM: 9_200,
  mieScaleHeightM: 1_500,
  miePhaseG: 0.66,
  rayleighScatteringMultiplier: 1.18,
  mieScatteringMultiplier: 0.82,
  mieExtinctionMultiplier: 1.12,
  absorptionExtinctionMultiplier: 1.08,
  groundAlbedo: 0.42,
  starRadiusM: 780_000_000,
  planetStarDistanceM: 170_000_000_000,
  starEffectiveTemperatureK: 4_900,
}

const waitForDemoReady = async (page: Page) => {
  await page.goto('/?stars=off')
  await page.waitForFunction(() => (window as any).__threeTslAtmosphereTest?.waitUntilReady != null)
  await page.waitForFunction(() => (window as any).navigator?.gpu != null)
  await page.evaluate(() => (window as any).__threeTslAtmosphereTest.waitUntilReady())
  await expect
    .poll(async () => (await captureCanvasStats(page)).maxLuminance, {
      message: 'canvas never produced a visible frame',
      timeout: 30_000,
    })
    .toBeGreaterThan(0.01)
}

const captureCanvasStats = async (page: Page): Promise<FrameStats> => {
  const png = PNG.sync.read(await page.locator('#app').screenshot({ type: 'png' }))
  const width = png.width
  const height = png.height
  const bytes = png.data

  let sumLuminance = 0
  let maxLuminance = 0
  let minLuminance = Number.POSITIVE_INFINITY
  let nonBlackCount = 0

  for (let index = 0; index < bytes.length; index += 4) {
    const r = bytes[index] / 255
    const g = bytes[index + 1] / 255
    const b = bytes[index + 2] / 255
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    sumLuminance += luminance
    maxLuminance = Math.max(maxLuminance, luminance)
    minLuminance = Math.min(minLuminance, luminance)
    if (luminance > 0.002) {
      nonBlackCount += 1
    }
  }

  const pixelCount = width * height
  return {
    averageLuminance: sumLuminance / pixelCount,
    maxLuminance,
    minLuminance: Number.isFinite(minLuminance) ? minLuminance : 0,
    nonBlackFraction: nonBlackCount / pixelCount,
  }
}

const expectApprox = (actual: number, expected: number) => {
  const tolerance = Math.max(0.01, Math.abs(expected) * 0.001)
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
}

const expectRenderableFrame = (stats: FrameStats) => {
  expect(Number.isFinite(stats.averageLuminance)).toBeTruthy()
  expect(Number.isFinite(stats.maxLuminance)).toBeTruthy()
  expect(Number.isFinite(stats.minLuminance)).toBeTruthy()
  expect(Number.isFinite(stats.nonBlackFraction)).toBeTruthy()
  expect(stats.maxLuminance).toBeGreaterThan(0.01)
  expect(stats.averageLuminance).toBeGreaterThan(0.0005)
  expect(stats.nonBlackFraction).toBeGreaterThan(0.001)
}

const attachErrorCollectors = (page: Page) => {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const isIgnorablePageError = (text: string) =>
    text.includes('OperationError: Instance dropped in popErrorScope')

  page.on('console', (message) => {
    const text = message.text()
    if (text.includes('favicon.ico') && text.includes('404')) {
      return
    }
    if (message.type() === 'error') {
      consoleErrors.push(text)
      return
    }
    if (
      text.includes('THREE.TSL: Declaration name') ||
      text.includes('Error while parsing WGSL') ||
      text.includes('Invalid ShaderModule') ||
      text.includes('Invalid RenderPipeline') ||
      text.includes('Failed to re-prime atmosphere preset') ||
      text.includes('Atmosphere LUT re-prime failed')
    ) {
      consoleErrors.push(text)
    }
  })

  page.on('pageerror', (error) => {
    const text = String(error)
    if (isIgnorablePageError(text)) {
      return
    }
    pageErrors.push(text)
  })

  return { consoleErrors, pageErrors }
}

test.describe.configure({ mode: 'serial' })

test('demo renders a visible initial WebGPU frame', async ({ page }) => {
  const { consoleErrors, pageErrors } = attachErrorCollectors(page)
  await waitForDemoReady(page)
  const stats = await captureCanvasStats(page)
  expectRenderableFrame(stats)
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  expect(pageErrors, pageErrors.join('\n')).toEqual([])
})

test('slider-equivalent atmosphere parameter changes keep rendering stable', async ({ page }) => {
  test.setTimeout(240_000)
  const { consoleErrors, pageErrors } = attachErrorCollectors(page)

  await waitForDemoReady(page)

  const baseline = await page.evaluate(() => (window as any).__threeTslAtmosphereTest.getState())
  expect(baseline.atmospherePreset).toBe('earth')
  expect(baseline.starsEnabled).toBe(false)
  expectRenderableFrame(await captureCanvasStats(page))

  for (const [key, value] of Object.entries(ATMOSPHERE_MUTATION_TARGETS)) {
    await page.evaluate(
      async ([settingKey, nextValue]) =>
        (window as any).__threeTslAtmosphereTest.setAtmosphereSetting(settingKey, nextValue),
      [key, value],
    )

    const state = await page.evaluate(() => (window as any).__threeTslAtmosphereTest.getState())
    expectApprox(state.atmosphereSettings[key as keyof typeof state.atmosphereSettings], value)
    expectRenderableFrame(await captureCanvasStats(page))
  }

  await page.evaluate(() => (window as any).__threeTslAtmosphereTest.setSunAngles(-8, 40))
  expectRenderableFrame(await captureCanvasStats(page))

  await page.evaluate(() => (window as any).__threeTslAtmosphereTest.setExposure(1.8))
  expectRenderableFrame(await captureCanvasStats(page))

  expect(consoleErrors, consoleErrors.join('\n')).toEqual([])
  expect(pageErrors, pageErrors.join('\n')).toEqual([])
})
