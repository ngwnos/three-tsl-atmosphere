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

export type AtmosphereEnvironmentMode = 'auto' | 'manual'

export type AtmosphereEnvironmentOptions = {
  enabled?: boolean
  mode?: AtmosphereEnvironmentMode
  resolution?: number
  near?: number
  far?: number
  captureLayer?: number
  applyToSceneEnvironment?: boolean
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

const SUN_COLOR_HORIZON = new THREE.Color(0xffa266)
const SUN_COLOR_DAY = new THREE.Color(0xfff7e3)
const SKY_TINT_NIGHT = new THREE.Color(0x3d4f7f)
const SKY_TINT_DAY = new THREE.Color(0xe7f4ff)
const AMBIENT_GROUND_NIGHT = new THREE.Color(0x1a2538)
const AMBIENT_GROUND_DAY = new THREE.Color(0x4a3c2d)

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
    SKY_TINT_DAY.getHex(),
    AMBIENT_GROUND_DAY.getHex(),
    DEFAULT_AMBIENT_INTENSITY,
  )
  scene.add(ambientLight)

  const environmentOptions = options.environment ?? {}
  const environmentEnabled = environmentOptions.enabled ?? true
  const environmentMode: AtmosphereEnvironmentMode = environmentOptions.mode ?? 'auto'
  const environmentApplyToScene = environmentOptions.applyToSceneEnvironment ?? true
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
    const daylight = THREE.MathUtils.clamp(Math.sin(altitudeRadians) * 0.85 + 0.15, 0, 1)
    const normalizedSunStrength = THREE.MathUtils.clamp(
      sunState.intensity / maxSunIntensity,
      0,
      1,
    )
    const solarVisibility = THREE.MathUtils.clamp(0.2 + daylight * 0.8, 0, 1)
    const unifiedSolarStrength = normalizedSunStrength * solarVisibility

    sunColorScratch.copy(SUN_COLOR_HORIZON).lerp(SUN_COLOR_DAY, Math.pow(daylight, 0.35))
    skyTintScratch.copy(SKY_TINT_NIGHT).lerp(SKY_TINT_DAY, Math.pow(daylight, 0.55))
    ambientGroundScratch
      .copy(AMBIENT_GROUND_NIGHT)
      .lerp(AMBIENT_GROUND_DAY, Math.pow(daylight, 0.45))

    sunDirectionFromAngles(
      sunState.altitudeDeg,
      sunState.azimuthDeg,
      sunDirectionScratch,
    )

    sunLight.color.copy(sunColorScratch)
    sunLight.intensity = Math.max(0, sunState.intensity)
    sunLight.position.copy(sunDirectionScratch).multiplyScalar(sunDistance)
    sunTarget.position.set(0, 0, 0)
    sunTarget.updateMatrixWorld()

    ambientLight.color.copy(skyTintScratch).multiplyScalar(0.7 + daylight * 0.3)
    ambientLight.groundColor.copy(ambientGroundScratch)
    ambientLight.intensity = Math.max(0, ambientIntensity)

    if (syncAtmosphereToSun) {
      const skyTintStrength = THREE.MathUtils.lerp(0.4, 1, unifiedSolarStrength)
      atmosphereSettings = {
        ...atmosphereSettings,
        skyIntensity: THREE.MathUtils.lerp(0.06, 3.2, unifiedSolarStrength),
        skyTintR: skyTintScratch.r * skyTintStrength,
        skyTintG: skyTintScratch.g * skyTintStrength,
        skyTintB: skyTintScratch.b * skyTintStrength,
        sunDiscIntensity: THREE.MathUtils.lerp(0, 18, normalizedSunStrength),
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
    if (environmentEnabled && environmentMode === 'auto' && environmentDirty) {
      captureEnvironment(renderer, capturePositionScratch)
    }
  }

  const requestEnvironmentCapture = (): void => {
    environmentDirty = true
  }

  const prime = async (renderer: WebGPURenderer): Promise<void> => {
    rendererRef = renderer
    await atmosphere.prime(renderer)
    if (environmentEnabled) {
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

  if (rendererRef && environmentEnabled) {
    environmentDirty = true
  }

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
