import * as THREE from 'three'
import { MeshBasicNodeMaterial, type WebGPURenderer } from 'three/webgpu'
import {
  cos,
  Fn,
  cameraPosition,
  dot,
  fwidth,
  float,
  normalize,
  positionWorld,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'

import { AtmosphereContextNode } from './bruneton/AtmosphereContextNode'
import { AtmosphereLUTNode } from './bruneton/AtmosphereLUTNode'
import { AtmosphereParameters } from './bruneton/AtmosphereParameters'
import { getSkyLuminance, getSolarLuminance } from './bruneton/runtime'

export type AtmosphereVisualSettings = {
  skyIntensity: number
  skyTintR: number
  skyTintG: number
  skyTintB: number
  sunDiscIntensity: number
  sunDiscColorR: number
  sunDiscColorG: number
  sunDiscColorB: number
  sunDiscInnerScale: number
  sunDiscOuterScale: number
}

export type AtmosphereMediumSettings = {
  rayleighScaleHeightM: number
  mieScaleHeightM: number
  miePhaseG: number
  rayleighScatteringMultiplier: number
  mieScatteringMultiplier: number
  mieExtinctionMultiplier: number
  absorptionExtinctionMultiplier: number
  groundAlbedo: number
}

export type AtmosphereArtisticSettings = AtmosphereVisualSettings &
  AtmosphereMediumSettings & {
    mode?: 'artistic'
    planetRadiusKm: number
    atmosphereHeightKm: number
  }

export type AtmospherePhysicalSettings = AtmosphereVisualSettings &
  AtmosphereMediumSettings & {
    mode: 'physical'
    planetRadiusM: number
    atmosphereHeightM: number
    starRadiusM: number
    planetStarDistanceM: number
    starEffectiveTemperatureK: number
  }

export type AtmosphereSettings = AtmosphereArtisticSettings | AtmospherePhysicalSettings

export const DEFAULT_ATMOSPHERE_SETTINGS: AtmosphereArtisticSettings = {
  skyIntensity: 1.2,
  skyTintR: 1,
  skyTintG: 1,
  skyTintB: 1,
  sunDiscIntensity: 1.4,
  sunDiscColorR: 1,
  sunDiscColorG: 0.9686274509803922,
  sunDiscColorB: 0.8901960784313725,
  sunDiscInnerScale: 0.85,
  sunDiscOuterScale: 1.8,
  planetRadiusKm: 6360,
  atmosphereHeightKm: 60,
  rayleighScaleHeightM: 8000,
  mieScaleHeightM: 1200,
  miePhaseG: 0.8,
  rayleighScatteringMultiplier: 1,
  mieScatteringMultiplier: 1,
  mieExtinctionMultiplier: 1,
  absorptionExtinctionMultiplier: 1,
  groundAlbedo: 0.3,
}

export const DEFAULT_ATMOSPHERE_PHYSICAL_SETTINGS: AtmospherePhysicalSettings = {
  mode: 'physical',
  skyIntensity: 1.2,
  skyTintR: 1,
  skyTintG: 1,
  skyTintB: 1,
  sunDiscIntensity: 1.4,
  sunDiscColorR: 1,
  sunDiscColorG: 0.9686274509803922,
  sunDiscColorB: 0.8901960784313725,
  sunDiscInnerScale: 0.85,
  sunDiscOuterScale: 1.8,
  planetRadiusM: 6360000,
  atmosphereHeightM: 60000,
  rayleighScaleHeightM: 8000,
  mieScaleHeightM: 1200,
  miePhaseG: 0.8,
  rayleighScatteringMultiplier: 1,
  mieScatteringMultiplier: 1,
  mieExtinctionMultiplier: 1,
  absorptionExtinctionMultiplier: 1,
  groundAlbedo: 0.3,
  starRadiusM: 695700000,
  planetStarDistanceM: 149597870700,
  starEffectiveTemperatureK: 5772,
}

export type AtmosphereSystemOptions = {
  worldUnitsPerMeter?: number
  skyDomeRadiusMeters?: number
  reprimeDebounceMs?: number
}

export type AtmosphereSystem = {
  prime: (renderer: WebGPURenderer) => Promise<void>
  setSettings: (next: AtmosphereSettings) => void
  setSunDirection: (directionWorld: THREE.Vector3) => void
  setCameraPosition: (positionWorld: THREE.Vector3) => void
  setSkyLayer: (layer: number) => void
  getContext: () => AtmosphereContextNode
  dispose: () => void
}

const DEFAULT_WORLD_UNITS_PER_METER = 1
const DEFAULT_SKY_DOME_RADIUS_METERS = 50
const DEFAULT_REPRIME_DEBOUNCE_MS = 160
const KM_TO_M = 1000
const PLANCK_CONSTANT = 6.62607015e-34
const SPEED_OF_LIGHT = 299792458
const BOLTZMANN_CONSTANT = 1.380649e-23
const SOLAR_SAMPLE_WAVELENGTHS_M = [680e-9, 550e-9, 440e-9] as const

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const clampNonNegative = (value: number) => Math.max(0, value)
const clampPositive = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? value : fallback

const isPhysicalAtmosphereSettings = (
  settings: AtmosphereSettings,
): settings is AtmospherePhysicalSettings => settings.mode === 'physical'

const normalizeAtmosphereSettings = (settings: AtmosphereSettings): AtmosphereSettings =>
  isPhysicalAtmosphereSettings(settings)
    ? { ...DEFAULT_ATMOSPHERE_PHYSICAL_SETTINGS, ...settings }
    : { ...DEFAULT_ATMOSPHERE_SETTINGS, ...settings }

const computeBlackbodySpectralRadiancePerMeter = (
  wavelengthM: number,
  temperatureK: number,
): number => {
  const exponent =
    (PLANCK_CONSTANT * SPEED_OF_LIGHT) / (wavelengthM * BOLTZMANN_CONSTANT * temperatureK)

  if (!Number.isFinite(exponent) || exponent > 700) {
    return 0
  }

  const numerator = 2 * PLANCK_CONSTANT * SPEED_OF_LIGHT ** 2
  const denominator = wavelengthM ** 5 * (Math.exp(exponent) - 1)
  return denominator > 0 ? numerator / denominator : 0
}

export const derivePhysicalSolarIrradiance = (
  settings: Pick<
    AtmospherePhysicalSettings,
    'starRadiusM' | 'planetStarDistanceM' | 'starEffectiveTemperatureK'
  >,
  target = new THREE.Vector3(),
): THREE.Vector3 => {
  const starRadiusM = clampPositive(
    settings.starRadiusM,
    DEFAULT_ATMOSPHERE_PHYSICAL_SETTINGS.starRadiusM,
  )
  const planetStarDistanceM = clampPositive(
    settings.planetStarDistanceM,
    DEFAULT_ATMOSPHERE_PHYSICAL_SETTINGS.planetStarDistanceM,
  )
  const starEffectiveTemperatureK = clampPositive(
    settings.starEffectiveTemperatureK,
    DEFAULT_ATMOSPHERE_PHYSICAL_SETTINGS.starEffectiveTemperatureK,
  )
  const angularRadiusRatio = THREE.MathUtils.clamp(starRadiusM / planetStarDistanceM, 1e-8, 0.999999)
  const solidAngle = Math.PI * angularRadiusRatio ** 2

  const values = SOLAR_SAMPLE_WAVELENGTHS_M.map((wavelengthM) => {
    const radiancePerMeter = computeBlackbodySpectralRadiancePerMeter(
      wavelengthM,
      starEffectiveTemperatureK,
    )
    return radiancePerMeter * solidAngle * 1e-9
  })

  return target.set(values[0], values[1], values[2])
}

export const derivePhysicalSunAngularRadius = (
  settings: Pick<AtmospherePhysicalSettings, 'starRadiusM' | 'planetStarDistanceM'>,
): number => {
  const starRadiusM = clampPositive(
    settings.starRadiusM,
    DEFAULT_ATMOSPHERE_PHYSICAL_SETTINGS.starRadiusM,
  )
  const planetStarDistanceM = clampPositive(
    settings.planetStarDistanceM,
    DEFAULT_ATMOSPHERE_PHYSICAL_SETTINGS.planetStarDistanceM,
  )
  return Math.asin(THREE.MathUtils.clamp(starRadiusM / planetStarDistanceM, 1e-8, 0.999999))
}

const getPlanetRadiusMeters = (settings: AtmosphereSettings): number =>
  isPhysicalAtmosphereSettings(settings)
    ? clampPositive(settings.planetRadiusM, DEFAULT_ATMOSPHERE_PHYSICAL_SETTINGS.planetRadiusM)
    : Math.max(1, settings.planetRadiusKm) * KM_TO_M

const getAtmosphereHeightMeters = (settings: AtmosphereSettings): number =>
  isPhysicalAtmosphereSettings(settings)
    ? clampPositive(
        settings.atmosphereHeightM,
        DEFAULT_ATMOSPHERE_PHYSICAL_SETTINGS.atmosphereHeightM,
      )
    : Math.max(0.1, settings.atmosphereHeightKm) * KM_TO_M

const lutKey = (settings: AtmosphereSettings): string => {
  const values: Array<number | string> = isPhysicalAtmosphereSettings(settings)
    ? [
        'physical',
        settings.planetRadiusM,
        settings.atmosphereHeightM,
        settings.starRadiusM,
        settings.planetStarDistanceM,
        settings.starEffectiveTemperatureK,
        settings.rayleighScaleHeightM,
        settings.mieScaleHeightM,
        settings.miePhaseG,
        settings.rayleighScatteringMultiplier,
        settings.mieScatteringMultiplier,
        settings.mieExtinctionMultiplier,
        settings.absorptionExtinctionMultiplier,
        settings.groundAlbedo,
      ]
    : [
        'artistic',
        settings.planetRadiusKm,
        settings.atmosphereHeightKm,
        settings.rayleighScaleHeightM,
        settings.mieScaleHeightM,
        settings.miePhaseG,
        settings.rayleighScatteringMultiplier,
        settings.mieScatteringMultiplier,
        settings.mieExtinctionMultiplier,
        settings.absorptionExtinctionMultiplier,
        settings.groundAlbedo,
      ]

  return values
    .map((value) => (typeof value === 'number' ? value.toFixed(6) : value))
    .join('|')
}

export const sunDirectionFromAngles = (
  altitudeDeg: number,
  azimuthDeg: number,
  target = new THREE.Vector3(),
): THREE.Vector3 => {
  const altitudeRadians = THREE.MathUtils.degToRad(altitudeDeg)
  const azimuthRadians = THREE.MathUtils.degToRad(azimuthDeg)
  const horizontal = Math.cos(altitudeRadians)
  const x = Math.sin(azimuthRadians) * horizontal
  const y = Math.sin(altitudeRadians)
  const z = Math.cos(azimuthRadians) * horizontal
  return target.set(x, y, z).normalize()
}

export const createAtmosphereSystem = (
  scene: THREE.Scene,
  initialSettings: AtmosphereSettings = DEFAULT_ATMOSPHERE_SETTINGS,
  options: AtmosphereSystemOptions = {},
): AtmosphereSystem => {
  const worldUnitsPerMeter =
    Number.isFinite(options.worldUnitsPerMeter) && (options.worldUnitsPerMeter ?? 0) > 0
      ? (options.worldUnitsPerMeter as number)
      : DEFAULT_WORLD_UNITS_PER_METER
  const metersPerWorldUnit = 1 / worldUnitsPerMeter
  const skyDomeRadiusMeters =
    Number.isFinite(options.skyDomeRadiusMeters) && (options.skyDomeRadiusMeters ?? 0) > 0
      ? (options.skyDomeRadiusMeters as number)
      : DEFAULT_SKY_DOME_RADIUS_METERS
  const reprimeDebounceMs =
    Number.isFinite(options.reprimeDebounceMs) && (options.reprimeDebounceMs ?? 0) >= 0
      ? (options.reprimeDebounceMs as number)
      : DEFAULT_REPRIME_DEBOUNCE_MS

  let settings: AtmosphereSettings = normalizeAtmosphereSettings(initialSettings)

  const parameters = new AtmosphereParameters()
  const baseSolarIrradiance = parameters.solarIrradiance.clone()
  const baseSunAngularRadius = parameters.sunAngularRadius
  const baseRayleigh = parameters.rayleighScattering.clone()
  const baseMieScattering = parameters.mieScattering.clone()
  const baseMieExtinction = parameters.mieExtinction.clone()
  const baseAbsorptionExtinction = parameters.absorptionExtinction.clone()

  const lutNode = new AtmosphereLUTNode(parameters)
  let atmosphereContext = new AtmosphereContextNode(parameters, lutNode)

  atmosphereContext.worldToUnitScene.value = parameters.worldToUnit * metersPerWorldUnit
  const skyIntensity = uniform(settings.skyIntensity)
  const skyTint = uniform(new THREE.Vector3(settings.skyTintR, settings.skyTintG, settings.skyTintB))
  const sunDiscIntensity = uniform(settings.sunDiscIntensity)
  const sunDiscColor = uniform(
    new THREE.Vector3(settings.sunDiscColorR, settings.sunDiscColorG, settings.sunDiscColorB),
  )
  const sunDiscAngularRadius = uniform(parameters.sunAngularRadius)

  const geometry = new THREE.SphereGeometry(skyDomeRadiusMeters * worldUnitsPerMeter, 64, 32)
  const material = new MeshBasicNodeMaterial()
  material.side = THREE.BackSide
  material.depthTest = false
  material.depthWrite = false

  const buildColorNode = () =>
    Fn(() => {
      const worldViewDir = normalize(positionWorld.sub(cameraPosition)).toVar()
      const worldSunDir = normalize(atmosphereContext.sunDirectionWorld).toVar()

      const cameraUnit = cameraPosition
        .sub(atmosphereContext.planetCenterWorld)
        .mul(atmosphereContext.worldToUnitScene)
        .toVar()

      const skyTransfer = getSkyLuminance(cameraUnit, worldViewDir, float(0), worldSunDir).toVar()
      const skyLuminance = skyTransfer.get('luminance').mul(skyIntensity).mul(skyTint).toVar()

      const sunChordThreshold = cos(sunDiscAngularRadius).oneMinus().mul(2).toVar()
      const sunChordVector = worldViewDir.sub(worldSunDir).toVar()
      const sunChordLength = dot(sunChordVector, sunChordVector).toVar()
      const sunFilterWidth = fwidth(sunChordLength).toVar()
      const sunDisc = smoothstep(sunChordThreshold, sunChordThreshold.sub(sunFilterWidth), sunChordLength)
        .mul(sunDiscIntensity)
        .toVar()
      const sunDiscLuminance = getSolarLuminance()
        .mul(vec3(sunDiscColor))
        .mul(sunDisc)
        .mul(skyTransfer.get('transmittance'))
        .toVar()

      return vec4(skyLuminance.add(sunDiscLuminance), float(1))
    })().context({ atmosphere: atmosphereContext })

  material.colorNode = buildColorNode()

  const skyMesh = new THREE.Mesh(geometry, material)
  skyMesh.frustumCulled = false
  skyMesh.renderOrder = -100
  scene.add(skyMesh)

  const sunScratch = new THREE.Vector3(0, 1, 0)
  const solarIrradianceScratch = new THREE.Vector3()

  let rendererRef: WebGPURenderer | null = null
  let primePromise: Promise<void> | null = null
  let pendingReprimeTimeout: ReturnType<typeof setTimeout> | null = null
  let lastLutSettingsKey = ''

  const syncSunDiscUniforms = (): void => {
    const innerScale = Math.max(0.01, settings.sunDiscInnerScale)
    const outerScale = Math.max(innerScale + 0.01, settings.sunDiscOuterScale)
    const averageScale = (innerScale + outerScale) * 0.5
    sunDiscAngularRadius.value = Math.max(1e-5, parameters.sunAngularRadius * averageScale)
  }

  const applyLutSettings = (): void => {
    const planetRadiusMeters = getPlanetRadiusMeters(settings)
    const atmosphereHeightMeters = getAtmosphereHeightMeters(settings)

    parameters.bottomRadius = planetRadiusMeters
    parameters.topRadius = planetRadiusMeters + atmosphereHeightMeters

    parameters.rayleighDensity.layers[1].expScale = -1 / Math.max(1, settings.rayleighScaleHeightM)
    parameters.mieDensity.layers[1].expScale = -1 / Math.max(1, settings.mieScaleHeightM)

    parameters.miePhaseFunctionG = THREE.MathUtils.clamp(settings.miePhaseG, 0, 0.999)

    parameters.rayleighScattering
      .copy(baseRayleigh)
      .multiplyScalar(clampNonNegative(settings.rayleighScatteringMultiplier))
    parameters.mieScattering
      .copy(baseMieScattering)
      .multiplyScalar(clampNonNegative(settings.mieScatteringMultiplier))
    parameters.mieExtinction
      .copy(baseMieExtinction)
      .multiplyScalar(clampNonNegative(settings.mieExtinctionMultiplier))
    parameters.absorptionExtinction
      .copy(baseAbsorptionExtinction)
      .multiplyScalar(clampNonNegative(settings.absorptionExtinctionMultiplier))

    parameters.groundAlbedo.setScalar(clamp01(settings.groundAlbedo))

    if (isPhysicalAtmosphereSettings(settings)) {
      parameters.solarIrradiance.copy(derivePhysicalSolarIrradiance(settings, solarIrradianceScratch))
      parameters.sunAngularRadius = derivePhysicalSunAngularRadius(settings)
    } else {
      parameters.solarIrradiance.copy(baseSolarIrradiance)
      parameters.sunAngularRadius = baseSunAngularRadius
    }

    lutNode.configure(parameters.clone())

    const sunDirectionValue = atmosphereContext.sunDirectionWorld.value.clone()
    atmosphereContext = new AtmosphereContextNode(parameters.clone(), lutNode)
    atmosphereContext.sunDirectionWorld.value.copy(sunDirectionValue)
    atmosphereContext.planetCenterWorld.value.set(0, -planetRadiusMeters * worldUnitsPerMeter, 0)
    atmosphereContext.worldToUnitScene.value = parameters.worldToUnit * metersPerWorldUnit
    material.colorNode = buildColorNode()
    material.needsUpdate = true
  }

  const applyVisualSettings = (): void => {
    skyIntensity.value = clampNonNegative(settings.skyIntensity)
    skyTint.value.set(
      clampNonNegative(settings.skyTintR),
      clampNonNegative(settings.skyTintG),
      clampNonNegative(settings.skyTintB),
    )
    sunDiscIntensity.value = clampNonNegative(settings.sunDiscIntensity)
    sunDiscColor.value.set(
      clampNonNegative(settings.sunDiscColorR),
      clampNonNegative(settings.sunDiscColorG),
      clampNonNegative(settings.sunDiscColorB),
    )
    syncSunDiscUniforms()
  }

  const scheduleReprime = (): void => {
    const activeRenderer = rendererRef
    if (!activeRenderer) return
    if (pendingReprimeTimeout) {
      clearTimeout(pendingReprimeTimeout)
    }
    pendingReprimeTimeout = setTimeout(() => {
      pendingReprimeTimeout = null
      void prime(activeRenderer).catch((error) => {
        console.error('Atmosphere LUT re-prime failed.', error)
      })
    }, reprimeDebounceMs)
  }

  const syncSettings = (forceLutApply = false): boolean => {
    const nextLutSettingsKey = lutKey(settings)
    const lutChanged = forceLutApply || nextLutSettingsKey !== lastLutSettingsKey
    if (lutChanged) {
      lastLutSettingsKey = nextLutSettingsKey
      applyLutSettings()
    }

    applyVisualSettings()

    return lutChanged
  }

  const prime = async (renderer: WebGPURenderer): Promise<void> => {
    rendererRef = renderer
    if (primePromise) {
      return primePromise
    }
    primePromise = (async () => {
      await lutNode.updateTextures(renderer)
    })().finally(() => {
      primePromise = null
    })
    return primePromise
  }

  const setSettings = (next: AtmosphereSettings): void => {
    settings = normalizeAtmosphereSettings(next)
    const lutChanged = syncSettings(false)
    if (lutChanged) {
      scheduleReprime()
    }
  }

  const setSunDirection = (directionWorld: THREE.Vector3): void => {
    sunScratch.copy(directionWorld)
    if (sunScratch.lengthSq() <= 1e-8) {
      sunScratch.set(0, 1, 0)
    } else {
      sunScratch.normalize()
    }
    atmosphereContext.sunDirectionWorld.value.copy(sunScratch)
  }

  const setCameraPosition = (positionWorld: THREE.Vector3): void => {
    skyMesh.position.copy(positionWorld)
  }

  const setSkyLayer = (layer: number): void => {
    const clampedLayer = THREE.MathUtils.clamp(Math.floor(layer), 0, 31)
    skyMesh.layers.set(clampedLayer)
  }

  syncSettings(true)

  const dispose = (): void => {
    if (pendingReprimeTimeout) {
      clearTimeout(pendingReprimeTimeout)
      pendingReprimeTimeout = null
    }
    scene.remove(skyMesh)
    geometry.dispose()
    material.dispose()
    atmosphereContext.dispose()
  }

  return {
    prime,
    setSettings,
    setSunDirection,
    setCameraPosition,
    setSkyLayer,
    getContext: () => atmosphereContext,
    dispose,
  }
}
