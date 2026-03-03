import * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'

import {
  createAtmosphereSystem,
  DEFAULT_ATMOSPHERE_SETTINGS,
  sunDirectionFromAngles,
  type AtmosphereSettings,
  type AtmosphereSystem,
  type AtmosphereSystemOptions,
} from './atmosphereSystem'

export type AtmosphereSunState = {
  altitudeDeg: number
  azimuthDeg: number
  intensity: number
}

export type AtmosphereEnvironmentMode = 'on-change' | 'manual'

export type AtmosphereEnvironmentOptions = {
  enabled?: boolean
  mode?: AtmosphereEnvironmentMode
  resolution?: number
  near?: number
  far?: number
  captureLayer?: number
  applyToSceneEnvironment?: boolean
  captureOnPrime?: boolean
}

export type AtmosphereRigOptions = {
  atmosphereSettings?: AtmosphereSettings
  atmosphereSystemOptions?: AtmosphereSystemOptions
  skyLayer?: number
  sun?: Partial<AtmosphereSunState>
  sunDistance?: number
  maxSunIntensity?: number
  ambientIntensity?: number
  syncAtmosphereToSun?: boolean
  environment?: AtmosphereEnvironmentOptions
}

export type AtmosphereRig = {
  atmosphere: AtmosphereSystem
  sunLight: THREE.DirectionalLight
  sunTarget: THREE.Object3D
  ambientLight: THREE.HemisphereLight
  prime: (renderer: WebGPURenderer) => Promise<void>
  update: (renderer: WebGPURenderer, camera?: THREE.Camera | null) => void
  setSun: (next: Partial<AtmosphereSunState>) => void
  setSunAngles: (altitudeDeg: number, azimuthDeg: number) => void
  setSunIntensity: (intensity: number) => void
  setAtmosphereSettings: (next: AtmosphereSettings) => void
  setAmbientIntensity: (next: number) => void
  requestEnvironmentCapture: () => void
  captureEnvironment: (renderer: WebGPURenderer, position?: THREE.Vector3) => void
  setCameraPosition: (positionWorld: THREE.Vector3) => void
  getEnvironmentTexture: () => THREE.CubeTexture | null
  dispose: () => void
}

const DEFAULT_SKY_LAYER = 1
const DEFAULT_SUN_DISTANCE = 5
const DEFAULT_SUN_INTENSITY = 1
const DEFAULT_MAX_SUN_INTENSITY = 12
const DEFAULT_AMBIENT_INTENSITY = 0.35
const DEFAULT_ENVIRONMENT_RESOLUTION = 256
const DEFAULT_ENVIRONMENT_NEAR = 0.1
const DEFAULT_ENVIRONMENT_FAR = 250

const SKY_TINT_NIGHT = new THREE.Color(0x0b1322)
const AMBIENT_GROUND_NIGHT = new THREE.Color(0x1a2538)
const AMBIENT_GROUND_DAY = new THREE.Color(0x4a3c2d)
const RAYLEIGH_EXTINCTION_BASE = new THREE.Vector3(0.06, 0.12, 0.24)
const MIE_EXTINCTION_BASE = new THREE.Vector3(0.015, 0.015, 0.015)
const ABSORPTION_EXTINCTION_BASE = new THREE.Vector3(0.003, 0.02, 0.002)

const createEnvironmentTarget = (resolution: number): THREE.WebGLCubeRenderTarget => {
  const target = new THREE.WebGLCubeRenderTarget(resolution, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  })
  target.texture.colorSpace = THREE.LinearSRGBColorSpace
  return target
}

const computeAirMass = (altitudeDeg: number): number => {
  const zenithDegrees = THREE.MathUtils.clamp(90 - altitudeDeg, 0, 89.9)
  const cosZenith = Math.cos(THREE.MathUtils.degToRad(zenithDegrees))
  return 1 / Math.max(0.03, cosZenith + 0.15 * Math.pow(Math.max(0.01, 93.885 - zenithDegrees), -1.253))
}

export const createAtmosphereRig = (
  scene: THREE.Scene,
  options: AtmosphereRigOptions = {},
): AtmosphereRig => {
  let atmosphereSettings: AtmosphereSettings = {
    ...DEFAULT_ATMOSPHERE_SETTINGS,
    ...options.atmosphereSettings,
  }

  const skyLayer = THREE.MathUtils.clamp(
    Math.floor(options.skyLayer ?? DEFAULT_SKY_LAYER),
    0,
    31,
  )
  const sunDistance =
    Number.isFinite(options.sunDistance) && (options.sunDistance ?? 0) > 0
      ? (options.sunDistance as number)
      : DEFAULT_SUN_DISTANCE
  const maxSunIntensity =
    Number.isFinite(options.maxSunIntensity) && (options.maxSunIntensity ?? 0) > 0
      ? (options.maxSunIntensity as number)
      : DEFAULT_MAX_SUN_INTENSITY
  const syncAtmosphereToSun = options.syncAtmosphereToSun ?? true

  const atmosphere = createAtmosphereSystem(
    scene,
    atmosphereSettings,
    options.atmosphereSystemOptions,
  )
  atmosphere.setSkyLayer(skyLayer)

  const sunTarget = new THREE.Object3D()
  scene.add(sunTarget)

  const sunLight = new THREE.DirectionalLight(0xffffff, DEFAULT_SUN_INTENSITY)
  sunLight.target = sunTarget
  scene.add(sunLight)

  const ambientLight = new THREE.HemisphereLight(
    0xffffff,
    AMBIENT_GROUND_DAY.getHex(),
    DEFAULT_AMBIENT_INTENSITY,
  )
  scene.add(ambientLight)

  const environmentOptions = options.environment ?? {}
  const environmentEnabled = environmentOptions.enabled ?? false
  const environmentMode: AtmosphereEnvironmentMode = environmentOptions.mode ?? 'on-change'
  const environmentApplyToScene = environmentOptions.applyToSceneEnvironment ?? true
  const environmentCaptureOnPrime = environmentOptions.captureOnPrime ?? true
  const environmentCaptureLayer = THREE.MathUtils.clamp(
    Math.floor(environmentOptions.captureLayer ?? skyLayer),
    0,
    31,
  )

  const environmentTargets = environmentEnabled
    ? [
        createEnvironmentTarget(
          Math.max(16, Math.floor(environmentOptions.resolution ?? DEFAULT_ENVIRONMENT_RESOLUTION)),
        ),
        createEnvironmentTarget(
          Math.max(16, Math.floor(environmentOptions.resolution ?? DEFAULT_ENVIRONMENT_RESOLUTION)),
        ),
      ]
    : null

  let environmentReadIndex = 0
  let environmentWriteIndex = 1

  const environmentCamera = environmentEnabled
    ? new THREE.CubeCamera(
        environmentOptions.near ?? DEFAULT_ENVIRONMENT_NEAR,
        environmentOptions.far ?? DEFAULT_ENVIRONMENT_FAR,
        environmentTargets[environmentWriteIndex],
      )
    : null

  if (environmentCamera) {
    environmentCamera.layers.set(environmentCaptureLayer)
    scene.add(environmentCamera)
    if (environmentApplyToScene) {
      scene.environment = environmentTargets[environmentReadIndex].texture
    }
  }

  const sunDirectionScratch = new THREE.Vector3(0, 1, 0)
  const sunColorScratch = new THREE.Color()
  const skyTintScratch = new THREE.Color()
  const ambientGroundScratch = new THREE.Color()
  const extinctionScratch = new THREE.Vector3()
  const capturePositionScratch = new THREE.Vector3(0, 0, 0)

  let ambientIntensity =
    Number.isFinite(options.ambientIntensity) && (options.ambientIntensity ?? -1) >= 0
      ? (options.ambientIntensity as number)
      : DEFAULT_AMBIENT_INTENSITY

  let sunState: AtmosphereSunState = {
    altitudeDeg: options.sun?.altitudeDeg ?? 35,
    azimuthDeg: options.sun?.azimuthDeg ?? 0,
    intensity: Math.max(0, options.sun?.intensity ?? DEFAULT_SUN_INTENSITY),
  }

  let rendererRef: WebGPURenderer | null = null
  let environmentDirty = true

  const applyLightingAndAtmosphereFromSun = (): void => {
    const altitudeRadians = THREE.MathUtils.degToRad(sunState.altitudeDeg)
    const daylight = THREE.MathUtils.clamp(Math.sin(altitudeRadians) * 0.5 + 0.5, 0, 1)
    const solarVisibility = THREE.MathUtils.smoothstep(sunState.altitudeDeg, -8, 2)
    const normalizedSunStrength = THREE.MathUtils.clamp(
      sunState.intensity / maxSunIntensity,
      0,
      1,
    )
    const unifiedSolarStrength = normalizedSunStrength * solarVisibility

    sunDirectionFromAngles(
      sunState.altitudeDeg,
      sunState.azimuthDeg,
      sunDirectionScratch,
    )

    const rayleighScale = Math.max(0, atmosphereSettings.rayleighScatteringMultiplier)
    const mieScale = Math.max(0, atmosphereSettings.mieExtinctionMultiplier)
    const absorptionScale = Math.max(0, atmosphereSettings.absorptionExtinctionMultiplier)
    extinctionScratch
      .copy(RAYLEIGH_EXTINCTION_BASE)
      .multiplyScalar(rayleighScale)
      .addScaledVector(MIE_EXTINCTION_BASE, mieScale)
      .addScaledVector(ABSORPTION_EXTINCTION_BASE, absorptionScale)
      .multiplyScalar(computeAirMass(sunState.altitudeDeg))

    sunColorScratch.setRGB(
      Math.exp(-extinctionScratch.x),
      Math.exp(-extinctionScratch.y),
      Math.exp(-extinctionScratch.z),
    )

    sunLight.color.copy(sunColorScratch)
    sunLight.intensity = Math.max(0, sunState.intensity * solarVisibility)
    sunLight.position.copy(sunDirectionScratch).multiplyScalar(sunDistance)
    sunTarget.position.set(0, 0, 0)
    sunTarget.updateMatrixWorld()

    skyTintScratch.setRGB(
      Math.max(0, atmosphereSettings.skyTintR),
      Math.max(0, atmosphereSettings.skyTintG),
      Math.max(0, atmosphereSettings.skyTintB),
    )
    skyTintScratch.multiplyScalar(Math.max(0, atmosphereSettings.skyIntensity))
    skyTintScratch.multiplyScalar(0.15 + daylight * 0.85)
    skyTintScratch.lerp(SKY_TINT_NIGHT, Math.pow(1 - daylight, 0.6))

    ambientGroundScratch
      .copy(AMBIENT_GROUND_NIGHT)
      .lerp(AMBIENT_GROUND_DAY, Math.pow(daylight, 0.4))

    ambientLight.color.copy(skyTintScratch).multiplyScalar(0.7 + daylight * 0.3)
    ambientLight.groundColor.copy(ambientGroundScratch)
    ambientLight.intensity = Math.max(0, ambientIntensity * (0.1 + 0.9 * daylight))

    if (syncAtmosphereToSun) {
      const skyTintStrength = THREE.MathUtils.lerp(0.3, 1, unifiedSolarStrength)
      atmosphereSettings = {
        ...atmosphereSettings,
        skyIntensity: THREE.MathUtils.lerp(0.05, 3.2, unifiedSolarStrength),
        skyTintR: skyTintScratch.r * skyTintStrength,
        skyTintG: skyTintScratch.g * skyTintStrength,
        skyTintB: skyTintScratch.b * skyTintStrength,
        sunDiscIntensity: THREE.MathUtils.lerp(0, 18, unifiedSolarStrength),
        sunDiscColorR: sunColorScratch.r,
        sunDiscColorG: sunColorScratch.g,
        sunDiscColorB: sunColorScratch.b,
      }
      atmosphere.setSettings(atmosphereSettings)
    }

    atmosphere.setSunDirection(sunDirectionScratch)
    environmentDirty = true
  }

  const setSun = (next: Partial<AtmosphereSunState>): void => {
    sunState = {
      altitudeDeg:
        typeof next.altitudeDeg === 'number' ? next.altitudeDeg : sunState.altitudeDeg,
      azimuthDeg:
        typeof next.azimuthDeg === 'number' ? next.azimuthDeg : sunState.azimuthDeg,
      intensity:
        typeof next.intensity === 'number'
          ? Math.max(0, next.intensity)
          : sunState.intensity,
    }
    applyLightingAndAtmosphereFromSun()
  }

  const captureEnvironment = (
    renderer: WebGPURenderer,
    position = capturePositionScratch,
  ): void => {
    if (!environmentEnabled || !environmentCamera || !environmentTargets) {
      return
    }

    const readTarget = environmentTargets[environmentReadIndex]
    const writeTarget = environmentTargets[environmentWriteIndex]

    const previousSceneEnvironment = scene.environment
    scene.environment = readTarget.texture

    environmentCamera.renderTarget = writeTarget
    environmentCamera.position.copy(position)
    environmentCamera.update(renderer, scene)

    environmentReadIndex = environmentWriteIndex
    environmentWriteIndex = (environmentWriteIndex + 1) % environmentTargets.length

    scene.environment = environmentApplyToScene
      ? environmentTargets[environmentReadIndex].texture
      : previousSceneEnvironment

    environmentDirty = false
  }

  const setCameraPosition = (positionWorld: THREE.Vector3): void => {
    atmosphere.setCameraPosition(positionWorld)
    capturePositionScratch.copy(positionWorld)
  }

  const update = (renderer: WebGPURenderer, camera?: THREE.Camera | null): void => {
    rendererRef = renderer
    if (camera) {
      setCameraPosition(camera.position)
    }
    if (!environmentEnabled) {
      return
    }
    if (environmentMode === 'on-change' && environmentDirty) {
      captureEnvironment(renderer, capturePositionScratch)
    }
  }

  const requestEnvironmentCapture = (): void => {
    environmentDirty = true
  }

  const prime = async (renderer: WebGPURenderer): Promise<void> => {
    rendererRef = renderer
    await atmosphere.prime(renderer)
    if (environmentEnabled && environmentCaptureOnPrime) {
      captureEnvironment(renderer, capturePositionScratch)
    }
  }

  const setAtmosphereSettings = (next: AtmosphereSettings): void => {
    atmosphereSettings = { ...next }
    atmosphere.setSettings(atmosphereSettings)
    environmentDirty = true
  }

  const setAmbientIntensity = (next: number): void => {
    ambientIntensity = Math.max(0, next)
    ambientLight.intensity = ambientIntensity
  }

  const getEnvironmentTexture = (): THREE.CubeTexture | null => {
    if (!environmentEnabled || !environmentTargets) {
      return null
    }
    return environmentTargets[environmentReadIndex].texture
  }

  const dispose = (): void => {
    atmosphere.dispose()
    scene.remove(sunLight)
    scene.remove(sunTarget)
    scene.remove(ambientLight)

    if (environmentCamera) {
      scene.remove(environmentCamera)
    }
    if (environmentTargets) {
      for (const target of environmentTargets) {
        target.dispose()
      }
    }

    if (environmentApplyToScene && scene.environment) {
      const currentTexture = scene.environment
      if (currentTexture === getEnvironmentTexture()) {
        scene.environment = null
      }
    }

    rendererRef = null
  }

  applyLightingAndAtmosphereFromSun()

  return {
    atmosphere,
    sunLight,
    sunTarget,
    ambientLight,
    prime,
    update,
    setSun,
    setSunAngles: (altitudeDeg: number, azimuthDeg: number) => {
      setSun({ altitudeDeg, azimuthDeg })
    },
    setSunIntensity: (intensity: number) => {
      setSun({ intensity })
    },
    setAtmosphereSettings,
    setAmbientIntensity,
    requestEnvironmentCapture,
    captureEnvironment,
    setCameraPosition,
    getEnvironmentTexture,
    dispose,
  }
}
