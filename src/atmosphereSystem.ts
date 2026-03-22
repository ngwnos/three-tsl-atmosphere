import * as THREE from 'three'
import { MeshBasicNodeMaterial, type WebGPURenderer } from 'three/webgpu'
import {
  cos,
  Fn,
  If,
  cameraPosition,
  dot,
  fwidth,
  float,
  getViewPosition,
  normalize,
  positionWorld,
  screenUV,
  select,
  smoothstep,
  sqrt,
  texture,
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

export type AtmosphereSettings = AtmosphereVisualSettings &
  AtmosphereMediumSettings & {
    planetRadiusM: number
    atmosphereHeightM: number
    starRadiusM: number
    planetStarDistanceM: number
    starEffectiveTemperatureK: number
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
  presentationMode?: 'sky-dome' | 'screen-space'
}

export type AtmosphereSystem = {
  prime: (renderer: WebGPURenderer) => Promise<void>
  renderBackground: (renderer: WebGPURenderer, camera: THREE.Camera) => void
  setCelestialTexture: (texture: THREE.Texture | null) => void
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
const DEFAULT_PRESENTATION_MODE = 'sky-dome' as const
const PLANCK_CONSTANT = 6.62607015e-34
const SPEED_OF_LIGHT = 299792458
const BOLTZMANN_CONSTANT = 1.380649e-23
const SOLAR_SAMPLE_WAVELENGTHS_M = [680e-9, 550e-9, 440e-9] as const

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const clampNonNegative = (value: number) => Math.max(0, value)
const clampPositive = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? value : fallback

const normalizeAtmosphereSettings = (settings: AtmosphereSettings): AtmosphereSettings => ({
  ...DEFAULT_ATMOSPHERE_SETTINGS,
  ...settings,
})

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

export const deriveSolarIrradiance = (
  settings: Pick<
    AtmosphereSettings,
    'starRadiusM' | 'planetStarDistanceM' | 'starEffectiveTemperatureK'
  >,
  target = new THREE.Vector3(),
): THREE.Vector3 => {
  const starRadiusM = clampPositive(
    settings.starRadiusM,
    DEFAULT_ATMOSPHERE_SETTINGS.starRadiusM,
  )
  const planetStarDistanceM = clampPositive(
    settings.planetStarDistanceM,
    DEFAULT_ATMOSPHERE_SETTINGS.planetStarDistanceM,
  )
  const starEffectiveTemperatureK = clampPositive(
    settings.starEffectiveTemperatureK,
    DEFAULT_ATMOSPHERE_SETTINGS.starEffectiveTemperatureK,
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

export const deriveSunAngularRadius = (
  settings: Pick<AtmosphereSettings, 'starRadiusM' | 'planetStarDistanceM'>,
): number => {
  const starRadiusM = clampPositive(
    settings.starRadiusM,
    DEFAULT_ATMOSPHERE_SETTINGS.starRadiusM,
  )
  const planetStarDistanceM = clampPositive(
    settings.planetStarDistanceM,
    DEFAULT_ATMOSPHERE_SETTINGS.planetStarDistanceM,
  )
  return Math.asin(THREE.MathUtils.clamp(starRadiusM / planetStarDistanceM, 1e-8, 0.999999))
}

const lutKey = (settings: AtmosphereSettings): string => {
  const values = [
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
  const presentationMode = options.presentationMode ?? DEFAULT_PRESENTATION_MODE

  let settings: AtmosphereSettings = normalizeAtmosphereSettings(initialSettings)

  const parameters = new AtmosphereParameters()
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
  const screenCameraProjectionMatrixInverse = uniform(new THREE.Matrix4())
  const screenCameraMatrixWorld = uniform(new THREE.Matrix4())
  const screenCameraWorldPosition = uniform(new THREE.Vector3())
  const screenCameraIsOrthographic = uniform(false)
  const celestialTextureNode = texture(new THREE.Texture())

  const geometry = new THREE.SphereGeometry(skyDomeRadiusMeters * worldUnitsPerMeter, 64, 32)

  const buildSkyLuminanceNode = (
    cameraWorldPositionNode: ReturnType<typeof vec3>,
    worldViewDirNode: ReturnType<typeof vec3>,
    softenPlanetMask: boolean,
  ) =>
    Fn(() => {
      const worldViewDir = normalize(worldViewDirNode).toVar()
      const worldSunDir = normalize(atmosphereContext.sunDirectionWorld).toVar()
      const cameraUnit = cameraWorldPositionNode
        .sub(atmosphereContext.planetCenterWorld)
        .mul(atmosphereContext.worldToUnitScene)
        .toVar()
      const cameraRadius = cameraUnit.length().toVar()

      const skyTransfer = getSkyLuminance(cameraUnit, worldViewDir, float(0), worldSunDir).toVar()
      const skyLuminance = skyTransfer.get('luminance').mul(skyIntensity).mul(skyTint).toVar()

      const sunChordThreshold = cos(sunDiscAngularRadius).oneMinus().mul(2).toVar()
      const sunChordVector = worldViewDir.sub(worldSunDir).toVar()
      const sunChordLength = dot(sunChordVector, sunChordVector).toVar()
      const sunFilterWidth = fwidth(sunChordLength).toVar()
      const sunDisc = smoothstep(
        sunChordThreshold,
        sunChordThreshold.sub(sunFilterWidth),
        sunChordLength,
      )
        .mul(sunDiscIntensity)
        .toVar()
      const sunDiscLuminance = getSolarLuminance()
        .mul(vec3(sunDiscColor))
        .mul(sunDisc)
        .mul(skyTransfer.get('transmittance'))
        .toVar()

      if (!softenPlanetMask) {
        return skyLuminance.add(sunDiscLuminance)
      }

      // When the viewer is in space, the planet limb becomes a hard
      // ground-intersection classification. Smooth the surface silhouette in
      // screen space so distant atmosphere edges do not stair-step.
      const cameraDotView = dot(cameraUnit, worldViewDir).toVar()
      const closestApproach = sqrt(
        cameraRadius.pow2().sub(cameraDotView.pow2()).max(float(0)),
      ).toVar()
      const limbDistance = closestApproach.sub(atmosphereContext.bottomRadius).toVar()
      const limbWidth = fwidth(limbDistance).max(float(1e-5)).mul(2).toVar()
      const rawPlanetMask = smoothstep(limbWidth.negate(), limbWidth, limbDistance).toVar()
      const applyPlanetMask = cameraRadius
        .greaterThan(atmosphereContext.topRadius)
        .and(cameraDotView.lessThan(0))
        .toVar()
      const planetMask = select(applyPlanetMask, rawPlanetMask, float(1)).toVar()

      return skyLuminance.add(sunDiscLuminance).mul(planetMask)
    })().context({ atmosphere: atmosphereContext })

  const buildColorNode = () =>
    vec4(
      buildSkyLuminanceNode(cameraPosition as ReturnType<typeof vec3>, positionWorld.sub(cameraPosition), true),
      float(1),
    )

  const buildScreenSpaceColorNode = () =>
    Fn(() => {
      const viewPosition = getViewPosition(
        screenUV,
        float(1),
        screenCameraProjectionMatrixInverse,
      ).toVar()
      const nearViewPosition = getViewPosition(
        screenUV,
        float(0),
        screenCameraProjectionMatrixInverse,
      ).toVar()
      const originView = vec3(0, 0, 0).toVar()
      const directionView = normalize(viewPosition).toVar()

      If(screenCameraIsOrthographic, () => {
        originView.assign(nearViewPosition)
        directionView.assign(vec3(0, 0, -1))
      })

      const worldOrigin = screenCameraWorldPosition.toVar()
      If(screenCameraIsOrthographic, () => {
        worldOrigin.assign(screenCameraMatrixWorld.mul(vec4(originView, float(1))).xyz)
      })

      const worldViewDirection = normalize(
        screenCameraMatrixWorld.mul(vec4(directionView, float(0))).xyz,
      ).toVar()
      const celestialSample = texture(celestialTextureNode, screenUV).rgb.toVar()

      const cameraUnit = worldOrigin
        .sub(atmosphereContext.planetCenterWorld)
        .mul(atmosphereContext.worldToUnitScene)
        .toVar()
      const worldSunDir = normalize(atmosphereContext.sunDirectionWorld).toVar()
      const skyTransfer = getSkyLuminance(cameraUnit, worldViewDirection, float(0), worldSunDir).toVar()
      const skyLuminance = buildSkyLuminanceNode(worldOrigin, worldViewDirection, false).toVar()
      const compositeLuminance = skyLuminance
        .add(skyTransfer.get('transmittance').mul(celestialSample))
        .toVar()

      return vec4(compositeLuminance, float(1))
    })()

  const createSkyMaterial = (): MeshBasicNodeMaterial => {
    const material = new MeshBasicNodeMaterial()
    material.side = THREE.BackSide
    material.depthTest = false
    material.depthWrite = false
    material.colorNode = buildColorNode()
    return material
  }

  const createScreenSpaceMaterial = (): MeshBasicNodeMaterial => {
    const material = new MeshBasicNodeMaterial()
    material.depthTest = false
    material.depthWrite = false
    material.outputNode = buildScreenSpaceColorNode()
    return material
  }

  let material = createSkyMaterial()
  let skyMesh: THREE.Mesh | null = null
  let backgroundScene: THREE.Scene | null = null
  let backgroundCamera: THREE.OrthographicCamera | null = null
  let backgroundQuad: THREE.Mesh | null = null

  if (presentationMode === 'screen-space') {
    backgroundScene = new THREE.Scene()
    backgroundCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    backgroundQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), createScreenSpaceMaterial())
    backgroundQuad.frustumCulled = false
    backgroundScene.add(backgroundQuad)
    material.dispose()
    material = backgroundQuad.material as MeshBasicNodeMaterial
  } else {
    skyMesh = new THREE.Mesh(geometry, material)
    skyMesh.frustumCulled = false
    skyMesh.renderOrder = -100
    scene.add(skyMesh)
  }

  const sunScratch = new THREE.Vector3(0, 1, 0)
  const solarIrradianceScratch = new THREE.Vector3()

  let rendererRef: WebGPURenderer | null = null
  let primePromise: Promise<void> | null = null
  let pendingReprimeTimeout: ReturnType<typeof setTimeout> | null = null
  let appliedLutSettingsKey = ''
  let hasPrimedLuts = false

  const syncSunDiscUniforms = (): void => {
    const innerScale = Math.max(0.01, settings.sunDiscInnerScale)
    const outerScale = Math.max(innerScale + 0.01, settings.sunDiscOuterScale)
    const averageScale = (innerScale + outerScale) * 0.5
    sunDiscAngularRadius.value = Math.max(1e-5, parameters.sunAngularRadius * averageScale)
  }

  const configureParametersForSettings = (
    sourceSettings: AtmosphereSettings,
  ): { planetRadiusMeters: number; parametersSnapshot: AtmosphereParameters } => {
    const planetRadiusMeters = clampPositive(
      sourceSettings.planetRadiusM,
      DEFAULT_ATMOSPHERE_SETTINGS.planetRadiusM,
    )
    const atmosphereHeightMeters = clampPositive(
      sourceSettings.atmosphereHeightM,
      DEFAULT_ATMOSPHERE_SETTINGS.atmosphereHeightM,
    )

    parameters.bottomRadius = planetRadiusMeters
    parameters.topRadius = planetRadiusMeters + atmosphereHeightMeters

    parameters.rayleighDensity.layers[1].expScale =
      -1 / Math.max(1, sourceSettings.rayleighScaleHeightM)
    parameters.mieDensity.layers[1].expScale = -1 / Math.max(1, sourceSettings.mieScaleHeightM)

    parameters.miePhaseFunctionG = THREE.MathUtils.clamp(sourceSettings.miePhaseG, 0, 0.999)

    parameters.rayleighScattering
      .copy(baseRayleigh)
      .multiplyScalar(clampNonNegative(sourceSettings.rayleighScatteringMultiplier))
    parameters.mieScattering
      .copy(baseMieScattering)
      .multiplyScalar(clampNonNegative(sourceSettings.mieScatteringMultiplier))
    parameters.mieExtinction
      .copy(baseMieExtinction)
      .multiplyScalar(clampNonNegative(sourceSettings.mieExtinctionMultiplier))
    parameters.absorptionExtinction
      .copy(baseAbsorptionExtinction)
      .multiplyScalar(clampNonNegative(sourceSettings.absorptionExtinctionMultiplier))

    parameters.groundAlbedo.setScalar(clamp01(sourceSettings.groundAlbedo))
    parameters.solarIrradiance.copy(deriveSolarIrradiance(sourceSettings, solarIrradianceScratch))
    parameters.sunAngularRadius = deriveSunAngularRadius(sourceSettings)

    return {
      planetRadiusMeters,
      parametersSnapshot: parameters.clone(),
    }
  }

  const prepareLutSettings = (
    sourceSettings: AtmosphereSettings,
  ): { planetRadiusMeters: number; parametersSnapshot: AtmosphereParameters } => {
    const prepared = configureParametersForSettings(sourceSettings)
    lutNode.configure(prepared.parametersSnapshot.clone())
    return prepared
  }

  const commitLutSettings = ({
    planetRadiusMeters,
    parametersSnapshot,
  }: {
    planetRadiusMeters: number
    parametersSnapshot: AtmosphereParameters
  }): void => {
    atmosphereContext.applyParameters(parametersSnapshot)
    atmosphereContext.planetCenterWorld.value.set(0, -planetRadiusMeters * worldUnitsPerMeter, 0)
    atmosphereContext.worldToUnitScene.value = parametersSnapshot.worldToUnit * metersPerWorldUnit
    const nextMaterial =
      presentationMode === 'screen-space' ? createScreenSpaceMaterial() : createSkyMaterial()
    if (skyMesh) {
      skyMesh.material = nextMaterial
    }
    if (backgroundQuad) {
      backgroundQuad.material = nextMaterial
    }
    material.dispose()
    material = nextMaterial
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
    const lutChanged = forceLutApply || nextLutSettingsKey !== appliedLutSettingsKey
    if (lutChanged && rendererRef == null) {
      const prepared = prepareLutSettings(settings)
      commitLutSettings(prepared)
      appliedLutSettingsKey = nextLutSettingsKey
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
      while (true) {
        const nextSettings = normalizeAtmosphereSettings(settings)
        const nextLutSettingsKey = lutKey(nextSettings)
        if (hasPrimedLuts && nextLutSettingsKey === appliedLutSettingsKey) {
          break
        }

        const prepared = prepareLutSettings(nextSettings)
        await lutNode.updateTextures(renderer)
        commitLutSettings(prepared)
        appliedLutSettingsKey = nextLutSettingsKey
        hasPrimedLuts = true
      }
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
    screenCameraWorldPosition.value.copy(positionWorld)
    if (skyMesh) {
      skyMesh.position.copy(positionWorld)
    }
  }

  const setSkyLayer = (layer: number): void => {
    const clampedLayer = THREE.MathUtils.clamp(Math.floor(layer), 0, 31)
    if (skyMesh) {
      skyMesh.layers.set(clampedLayer)
    }
  }

  const setCelestialTexture = (nextTexture: THREE.Texture | null): void => {
    celestialTextureNode.value = nextTexture ?? new THREE.Texture()
  }

  const renderBackground = (renderer: WebGPURenderer, camera: THREE.Camera): void => {
    if (!backgroundScene || !backgroundCamera) {
      return
    }

    camera.updateMatrixWorld()
    if ('projectionMatrixInverse' in camera) {
      screenCameraProjectionMatrixInverse.value.copy(
        (camera as THREE.PerspectiveCamera | THREE.OrthographicCamera).projectionMatrixInverse,
      )
    } else {
      screenCameraProjectionMatrixInverse.value.copy(camera.projectionMatrix).invert()
    }
    screenCameraMatrixWorld.value.copy(camera.matrixWorld)
    screenCameraWorldPosition.value.setFromMatrixPosition(camera.matrixWorld)
    screenCameraIsOrthographic.value = camera instanceof THREE.OrthographicCamera
    renderer.render(backgroundScene, backgroundCamera)
  }

  syncSettings(true)

  const dispose = (): void => {
    if (pendingReprimeTimeout) {
      clearTimeout(pendingReprimeTimeout)
      pendingReprimeTimeout = null
    }
    if (skyMesh) {
      scene.remove(skyMesh)
    }
    if (backgroundScene && backgroundQuad) {
      backgroundScene.remove(backgroundQuad)
      backgroundQuad.geometry.dispose()
    }
    geometry.dispose()
    material.dispose()
    atmosphereContext.dispose()
  }

  return {
    prime,
    renderBackground,
    setCelestialTexture,
    setSettings,
    setSunDirection,
    setCameraPosition,
    setSkyLayer,
    getContext: () => atmosphereContext,
    dispose,
  }
}
