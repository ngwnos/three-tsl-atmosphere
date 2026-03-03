import * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'

import { AtmosphereLight } from './AtmosphereLight'
import { AtmosphereLightNode } from './AtmosphereLightNode'
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
  sunLight: AtmosphereLight
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

type LightNodeLibrary = {
  getLightNodeClass: (lightClass: new (...args: never[]) => unknown) => unknown
  addLight: (
    lightNodeClass: new (...args: never[]) => unknown,
    lightClass: new (...args: never[]) => unknown,
  ) => void
}

const DEFAULT_SKY_LAYER = 1
const DEFAULT_SUN_DISTANCE = 5
const DEFAULT_SUN_INTENSITY = 1
const DEFAULT_MAX_SUN_INTENSITY = 12
const DEFAULT_AMBIENT_INTENSITY = 0.35
const DEFAULT_ENVIRONMENT_RESOLUTION = 256
const DEFAULT_ENVIRONMENT_NEAR = 0.1
const DEFAULT_ENVIRONMENT_FAR = 250

const DEFAULT_AMBIENT_SKY_COLOR = new THREE.Color(0xffffff)
const DEFAULT_AMBIENT_GROUND_COLOR = new THREE.Color(0x4a3c2d)

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

const getRendererLightNodeLibrary = (renderer: WebGPURenderer): LightNodeLibrary | null => {
  const maybeRenderer = renderer as unknown as { library?: unknown }
  const library = maybeRenderer.library
  if (!library || typeof library !== 'object') {
    return null
  }
  const lightLibrary = library as Partial<LightNodeLibrary>
  if (
    typeof lightLibrary.getLightNodeClass !== 'function' ||
    typeof lightLibrary.addLight !== 'function'
  ) {
    return null
  }
  return lightLibrary as LightNodeLibrary
}

const ensureAtmosphereLightNodeRegistered = (renderer: WebGPURenderer): void => {
  const lightLibrary = getRendererLightNodeLibrary(renderer)
  if (!lightLibrary) {
    return
  }
  if (lightLibrary.getLightNodeClass(AtmosphereLight)) {
    return
  }
  lightLibrary.addLight(AtmosphereLightNode, AtmosphereLight)
}

export const createAtmosphereRig = (
  scene: THREE.Scene,
  options: AtmosphereRigOptions = {},
): AtmosphereRig => {
  let baseAtmosphereSettings: AtmosphereSettings = {
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
    baseAtmosphereSettings,
    options.atmosphereSystemOptions,
  )
  atmosphere.setSkyLayer(skyLayer)

  const sunTarget = new THREE.Object3D()
  scene.add(sunTarget)

  const sunLight = new AtmosphereLight(atmosphere.getContext(), sunDistance)
  sunLight.target = sunTarget
  sunLight.color.set(0xffffff)
  sunLight.intensity = DEFAULT_SUN_INTENSITY
  scene.add(sunLight)

  const ambientLight = new THREE.HemisphereLight(
    DEFAULT_AMBIENT_SKY_COLOR.getHex(),
    DEFAULT_AMBIENT_GROUND_COLOR.getHex(),
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

  let environmentDirty = true

  const syncSunState = (): void => {
    sunDirectionFromAngles(
      sunState.altitudeDeg,
      sunState.azimuthDeg,
      sunDirectionScratch,
    )

    let atmosphereSettings = baseAtmosphereSettings
    if (syncAtmosphereToSun) {
      const sunScale = THREE.MathUtils.clamp(sunState.intensity / maxSunIntensity, 0, 1)
      atmosphereSettings = {
        ...baseAtmosphereSettings,
        skyIntensity: baseAtmosphereSettings.skyIntensity * sunScale,
        sunDiscIntensity: baseAtmosphereSettings.sunDiscIntensity * sunScale,
      }
      atmosphere.setSettings(atmosphereSettings)
    }

    sunLight.atmosphereContext = atmosphere.getContext()
    atmosphere.setSunDirection(sunDirectionScratch)

    sunLight.color.set(0xffffff)
    sunLight.intensity = Math.max(0, sunState.intensity)
    sunTarget.position.set(0, 0, 0)
    sunLight.updateMatrixWorld(true)
    sunTarget.updateMatrixWorld()

    ambientLight.intensity = Math.max(0, ambientIntensity)
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
    syncSunState()
  }

  const captureEnvironment = (
    renderer: WebGPURenderer,
    position = capturePositionScratch,
  ): void => {
    if (!environmentEnabled || !environmentCamera || !environmentTargets) {
      return
    }

    const writeTarget = environmentTargets[environmentWriteIndex]

    const previousSceneEnvironment = scene.environment
    scene.environment = null

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
    ensureAtmosphereLightNodeRegistered(renderer)
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
    ensureAtmosphereLightNodeRegistered(renderer)
    await atmosphere.prime(renderer)
    syncSunState()
    if (environmentEnabled && environmentCaptureOnPrime) {
      captureEnvironment(renderer, capturePositionScratch)
    }
  }

  const setAtmosphereSettings = (next: AtmosphereSettings): void => {
    baseAtmosphereSettings = { ...next }
    if (syncAtmosphereToSun) {
      syncSunState()
      return
    }
    atmosphere.setSettings(baseAtmosphereSettings)
    sunLight.atmosphereContext = atmosphere.getContext()
    atmosphere.setSunDirection(sunDirectionScratch)
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
  }

  syncSunState()

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
