import * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'

export type AtmosphereSettings = {
  skyIntensity: number
  sunDiscIntensity: number
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

export declare const DEFAULT_ATMOSPHERE_SETTINGS: AtmosphereSettings

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

export { AtmosphereParameters } from './bruneton/AtmosphereParameters'
