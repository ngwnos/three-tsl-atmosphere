import * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'

export type AtmosphereVisualSettings = {
  skyIntensity: number
  skyTintR: number
  skyTintG: number
  skyTintB: number
  groundOpacity: number
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

export type AtmosphereSettings = AtmosphereVisualSettings &
  AtmosphereMediumSettings & {
    planetRadiusM: number
    atmosphereHeightM: number
    starRadiusM: number
    planetStarDistanceM: number
    starEffectiveTemperatureK: number
  }

export type AtmosphereSystemOptions = {
  worldUnitsPerMeter?: number
  skyDomeRadiusMeters?: number
  reprimeDebounceMs?: number
  presentationMode?: 'sky-dome' | 'screen-space'
}

export type AtmosphereSystem = {
  prime: (renderer: WebGPURenderer) => Promise<void>
  renderBackground: (renderer: WebGPURenderer, camera: THREE.Camera) => void
  renderTransmittance: (renderer: WebGPURenderer, camera: THREE.Camera) => void
  setSettings: (next: AtmosphereSettings) => void
  setSunDirection: (directionWorld: THREE.Vector3) => void
  setCameraPosition: (positionWorld: THREE.Vector3) => void
  setSkyLayer: (layer: number) => void
  getContext: () => unknown
  dispose: () => void
}

export declare const DEFAULT_ATMOSPHERE_SETTINGS: AtmosphereSettings

export declare const deriveSolarIrradiance: (
  settings: Pick<
    AtmosphereSettings,
    'starRadiusM' | 'planetStarDistanceM' | 'starEffectiveTemperatureK'
  >,
  target?: THREE.Vector3,
) => THREE.Vector3

export declare const deriveSunAngularRadius: (
  settings: Pick<AtmosphereSettings, 'starRadiusM' | 'planetStarDistanceM'>,
) => number

export declare const sunDirectionFromAngles: (
  altitudeDeg: number,
  azimuthDeg: number,
  target?: THREE.Vector3,
) => THREE.Vector3

export declare const createAtmosphereSystem: (
  scene: THREE.Scene,
  initialSettings?: AtmosphereSettings,
  options?: AtmosphereSystemOptions,
) => AtmosphereSystem

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
  renderBackground: (renderer: WebGPURenderer, camera: THREE.Camera) => void
  renderTransmittance: (renderer: WebGPURenderer, camera: THREE.Camera) => void
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

export declare const createAtmosphereRig: (
  scene: THREE.Scene,
  options?: AtmosphereRigOptions,
) => AtmosphereRig

export declare class AtmosphereLight extends THREE.DirectionalLight {
  readonly type: string
  atmosphereContext?: unknown
  distance: number
  direct: unknown
  indirect: unknown
  constructor(atmosphereContext?: unknown, distance?: number)
}

export declare class AtmosphereLightNode {
  static readonly type: string
}

export { AtmosphereParameters } from './bruneton/AtmosphereParameters'
