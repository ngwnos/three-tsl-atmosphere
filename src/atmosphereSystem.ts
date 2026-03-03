import * as THREE from 'three'
import { MeshBasicNodeMaterial, type WebGPURenderer } from 'three/webgpu'
import {
  Fn,
  cameraPosition,
  dot,
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
import { getSkyLuminance } from './bruneton/runtime'

export type AtmosphereSettings = {
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
  planetRadiusKm: number
  atmosphereHeightKm: number
  rayleighScaleHeightM: number
  mieScaleHeightM: number
  miePhaseG: number
  rayleighScatteringMultiplier: number
  mieScatteringMultiplier: number
  mieExtinctionMultiplier: number
  absorptionExtinctionMultiplier: number
  groundAlbedo: number
}

export const DEFAULT_ATMOSPHERE_SETTINGS: AtmosphereSettings = {
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
  dispose: () => void
}

const DEFAULT_WORLD_UNITS_PER_METER = 1
const DEFAULT_SKY_DOME_RADIUS_METERS = 50
const DEFAULT_REPRIME_DEBOUNCE_MS = 160
const KM_TO_M = 1000

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const clampNonNegative = (value: number) => Math.max(0, value)

const lutKey = (settings: AtmosphereSettings): string => {
  const values = [
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
  return values.map((value) => value.toFixed(6)).join('|')
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

  let settings: AtmosphereSettings = { ...initialSettings }

  const parameters = new AtmosphereParameters()
  const baseRayleigh = parameters.rayleighScattering.clone()
  const baseMieScattering = parameters.mieScattering.clone()
  const baseMieExtinction = parameters.mieExtinction.clone()
  const baseAbsorptionExtinction = parameters.absorptionExtinction.clone()

  const lutNode = new AtmosphereLUTNode(parameters)
  let atmosphereContext = new AtmosphereContextNode(parameters, lutNode)

  const planetCenterWorld = uniform(new THREE.Vector3())
  const sunDirectionWorld = uniform(new THREE.Vector3(0, 1, 0))
  const worldToUnit = uniform(parameters.worldToUnit * metersPerWorldUnit)
  const skyIntensity = uniform(settings.skyIntensity)
  const skyTint = uniform(new THREE.Vector3(settings.skyTintR, settings.skyTintG, settings.skyTintB))
  const sunDiscIntensity = uniform(settings.sunDiscIntensity)
  const sunDiscColor = uniform(
    new THREE.Vector3(settings.sunDiscColorR, settings.sunDiscColorG, settings.sunDiscColorB),
  )
  const sunDiscInnerCos = uniform(0)
  const sunDiscOuterCos = uniform(0)

  const geometry = new THREE.SphereGeometry(skyDomeRadiusMeters * worldUnitsPerMeter, 64, 32)
  const material = new MeshBasicNodeMaterial()
  material.side = THREE.BackSide
  material.depthTest = false
  material.depthWrite = false

  const buildColorNode = () =>
    Fn(() => {
      const worldViewDir = normalize(positionWorld.sub(cameraPosition)).toVar()
      const worldSunDir = normalize(sunDirectionWorld).toVar()

      const cameraUnit = cameraPosition.sub(planetCenterWorld).mul(worldToUnit).toVar()

      const skyTransfer = getSkyLuminance(cameraUnit, worldViewDir, float(0), worldSunDir).toVar()
      const skyLuminance = skyTransfer.get('luminance').mul(skyIntensity).mul(skyTint).toVar()

      const sunAlignment = dot(worldViewDir, worldSunDir).toVar()
      const sunDisc = smoothstep(sunDiscOuterCos, sunDiscInnerCos, sunAlignment)
        .mul(sunDiscIntensity)
        .toVar()

      const sunDiscLuminance = vec3(sunDiscColor).mul(sunDisc).toVar()

      return vec4(skyLuminance.add(sunDiscLuminance), float(1))
    })().context({ atmosphere: atmosphereContext })

  material.colorNode = buildColorNode()

  const skyMesh = new THREE.Mesh(geometry, material)
  skyMesh.frustumCulled = false
  skyMesh.renderOrder = -100
  scene.add(skyMesh)

  const sunScratch = new THREE.Vector3(0, 1, 0)

  let rendererRef: WebGPURenderer | null = null
  let primePromise: Promise<void> | null = null
  let pendingReprimeTimeout: ReturnType<typeof setTimeout> | null = null
  let lastLutSettingsKey = ''

  const syncSunDiscUniforms = (): void => {
    const innerScale = Math.max(0.01, settings.sunDiscInnerScale)
    const outerScale = Math.max(innerScale + 0.01, settings.sunDiscOuterScale)
    const sunAngularRadius = parameters.sunAngularRadius
    sunDiscInnerCos.value = Math.cos(sunAngularRadius * innerScale)
    sunDiscOuterCos.value = Math.cos(sunAngularRadius * outerScale)
  }

  const applyLutSettings = (): void => {
    const planetRadiusMeters = Math.max(1, settings.planetRadiusKm) * KM_TO_M
    const atmosphereHeightMeters = Math.max(0.1, settings.atmosphereHeightKm) * KM_TO_M

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

    planetCenterWorld.value.set(0, -planetRadiusMeters * worldUnitsPerMeter, 0)

    lutNode.configure(parameters.clone())

    atmosphereContext = new AtmosphereContextNode(parameters.clone(), lutNode)
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
    applyVisualSettings()

    const nextLutSettingsKey = lutKey(settings)
    const lutChanged = forceLutApply || nextLutSettingsKey !== lastLutSettingsKey
    if (lutChanged) {
      lastLutSettingsKey = nextLutSettingsKey
      applyLutSettings()
    }

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
    settings = { ...next }
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
    sunDirectionWorld.value.copy(sunScratch)
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
    dispose,
  }
}
