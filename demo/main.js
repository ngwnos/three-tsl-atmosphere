import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { Pane } from 'tweakpane'
import { createAtmosphereRig, DEFAULT_ATMOSPHERE_SETTINGS } from 'three-tsl-atmosphere'
import { GaiaStarOverlay } from './gaiaStarOverlay.js'
import { SkyGridOverlay } from './skyGridOverlay.js'

const EARTH_ATMOSPHERE_SETTINGS = DEFAULT_ATMOSPHERE_SETTINGS
const ALT_ATMOSPHERE_SETTINGS = {
  ...DEFAULT_ATMOSPHERE_SETTINGS,
  starEffectiveTemperatureK: 3200,
  starRadiusM: 590000000,
  planetStarDistanceM: 97500000000,
  atmosphereHeightM: 85000,
  rayleighScatteringMultiplier: 1.2,
  mieScatteringMultiplier: 0.7,
  mieExtinctionMultiplier: 0.82,
  skyIntensity: 1.3,
  sunDiscIntensity: 1.1,
}

const MIN_ALTITUDE_METERS = 1.7
const MAX_ALTITUDE_METERS = 2_000_000
const MIN_ALTITUDE_SPEED_MPS = 10_000
const ALTITUDE_SPEED_FACTOR = 1.5
const SUN_ALTITUDE_STEP_DEG = 2
const MIN_SUN_ALTITUDE_DEG = -90
const MAX_SUN_ALTITUDE_DEG = 90
const MIN_EXPOSURE = 0.125
const MAX_EXPOSURE = 16
const EXPOSURE_STEP_STOPS = 1 / 3
const MIN_STAR_SCALE_LIMIT = 0.1
const MAX_STAR_SCALE_LIMIT = 8
const STAR_SCALE_STEP = Math.SQRT2
const DEFAULT_OBSERVER_LATITUDE_DEG = 37.7749
const DEFAULT_OBSERVER_LONGITUDE_DEG = -122.4194
const GREENWICH_SIDEREAL_ANGLE_DEG = 25
const GAIA_CHUNK_URLS = Array.from({ length: 5 }, (_, index) =>
  `/data/gaia/chunk_${String(index).padStart(4, '0')}.bin`,
)

const canvas = document.querySelector('#app')
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Missing demo canvas')
}
const controlPanelContainer = document.querySelector('#control-panel')
if (!(controlPanelContainer instanceof HTMLDivElement)) {
  throw new Error('Missing control panel container')
}
const urlParams = new URLSearchParams(window.location.search)
const starsEnabled = urlParams.get('stars') !== 'off'

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
const cameraAnchor = new THREE.Vector3(0, MIN_ALTITUDE_METERS, 0)
const cameraEuler = new THREE.Euler(0, 0, 0, 'YXZ')
const zoomPointer = new THREE.Vector3()
const zoomBeforeDirection = new THREE.Vector3()
const zoomAfterDirection = new THREE.Vector3()
const zoomRotation = new THREE.Quaternion()
const zoomedCameraQuaternion = new THREE.Quaternion()
const planetCenter = new THREE.Vector3()
const equatorialTiltQuaternion = new THREE.Quaternion()
const siderealQuaternion = new THREE.Quaternion()
const equatorialToLocalQuaternion = new THREE.Quaternion()
const equatorialToLocalMatrix = new THREE.Matrix4()
const MAX_PITCH = Math.PI * 0.48
const MIN_FOV = 20
const MAX_FOV = 150
const ZOOM_SENSITIVITY = 0.0015
let dragging = false
let activePointerId = null
let yaw = 0
let pitch = 0
let lastFrameTimeMs = 0
let lastPointerX = 0
let lastPointerY = 0
let isPreviewReady = false
let atmospherePreset = 'earth'
const atmosphereSettings = { ...EARTH_ATMOSPHERE_SETTINGS }
let altitudeMeters = MIN_ALTITUDE_METERS
let exposure = 1
let minStarScale = 0.55
let maxStarScale = 2.4
let observerLatitudeDeg = DEFAULT_OBSERVER_LATITUDE_DEG
let observerLongitudeDeg = DEFAULT_OBSERVER_LONGITUDE_DEG
let captureResources = null
const sunState = {
  altitudeDeg: 24,
  azimuthDeg: -35,
  intensity: 6,
}
const movementState = {
  up: false,
  down: false,
}
const gridState = {
  showAltAzGrid: false,
  showRaDecGrid: false,
}
let resolvePreviewReadyPromise = null
const previewReadyPromise = new Promise((resolve) => {
  resolvePreviewReadyPromise = resolve
})

camera.position.copy(cameraAnchor)

const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: false })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.autoClear = false

const atmosphereRig = createAtmosphereRig(scene, {
  atmosphereSettings: EARTH_ATMOSPHERE_SETTINGS,
  skyLayer: 0,
  sun: sunState,
  environment: {
    enabled: false,
  },
  ambientIntensity: 0,
})
const starOverlay = new GaiaStarOverlay()
const gridOverlay = new SkyGridOverlay()
gridOverlay.addToScene(scene)
const pane = new Pane({
  container: controlPanelContainer,
  title: 'Atmosphere',
})
const paneState = {
  preset: 'earth',
  sunAltitudeDeg: sunState.altitudeDeg,
  sunAzimuthDeg: sunState.azimuthDeg,
  exposure,
  minStarScale,
  maxStarScale,
  altitudeKm: altitudeMeters / 1000,
  observerLatitudeDeg,
  observerLongitudeDeg,
  showAltAzGrid: gridState.showAltAzGrid,
  showRaDecGrid: gridState.showRaDecGrid,
}

const updateEquatorialFrame = () => {
  equatorialTiltQuaternion.setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    THREE.MathUtils.degToRad(90 - observerLatitudeDeg),
  )
  siderealQuaternion.setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    THREE.MathUtils.degToRad(GREENWICH_SIDEREAL_ANGLE_DEG + observerLongitudeDeg),
  )
  equatorialToLocalQuaternion.copy(equatorialTiltQuaternion).multiply(siderealQuaternion)
  equatorialToLocalMatrix.makeRotationFromQuaternion(equatorialToLocalQuaternion)
  gridOverlay.setEquatorialToLocal(equatorialToLocalQuaternion)
}

const syncPaneState = () => {
  paneState.preset = atmospherePreset
  paneState.sunAltitudeDeg = sunState.altitudeDeg
  paneState.sunAzimuthDeg = sunState.azimuthDeg
  paneState.exposure = exposure
  paneState.minStarScale = minStarScale
  paneState.maxStarScale = maxStarScale
  paneState.altitudeKm = altitudeMeters / 1000
  paneState.observerLatitudeDeg = observerLatitudeDeg
  paneState.observerLongitudeDeg = observerLongitudeDeg
  paneState.showAltAzGrid = gridState.showAltAzGrid
  paneState.showRaDecGrid = gridState.showRaDecGrid
  pane.refresh()
}

const applyVisualExposure = () => {
  atmosphereRig.setAtmosphereSettings({
    ...atmosphereSettings,
    skyIntensity: atmosphereSettings.skyIntensity * exposure,
    sunDiscIntensity: atmosphereSettings.sunDiscIntensity * exposure,
  })
  planetCenter.set(0, -atmosphereSettings.planetRadiusM, 0)
  starOverlay.setPlanet(planetCenter, atmosphereSettings.planetRadiusM)
  starOverlay.setEquatorialToLocal(equatorialToLocalMatrix)
  starOverlay.setExposure(exposure)
  starOverlay.setScaleRange(minStarScale, maxStarScale)
}

const applyCameraOrientation = () => {
  camera.position.copy(cameraAnchor)
  cameraEuler.set(pitch, yaw, 0)
  camera.quaternion.setFromEuler(cameraEuler)
}

const syncCameraAltitude = () => {
  cameraAnchor.set(0, altitudeMeters, 0)
  applyCameraOrientation()
}

const setCameraOrientationFromQuaternion = (quaternion) => {
  cameraEuler.setFromQuaternion(quaternion, 'YXZ')
  yaw = cameraEuler.y
  pitch = THREE.MathUtils.clamp(cameraEuler.x, -MAX_PITCH, MAX_PITCH)
  applyCameraOrientation()
}

const handleResize = () => {
  const width = window.innerWidth
  const height = window.innerHeight
  camera.aspect = width / Math.max(1, height)
  camera.updateProjectionMatrix()
  renderer.setSize(width, height, false)
}

const renderDisplayFrame = () => {
  renderer.clear()
  gridOverlay.setCameraPosition(camera.position)
  atmosphereRig.update(renderer, camera)
  renderer.render(scene, camera)
  if (starsEnabled) {
    starOverlay.render(renderer, camera, sunState.altitudeDeg)
  }
}

const disposeCaptureResources = () => {
  if (!captureResources) {
    return
  }

  captureResources.postScene.remove(captureResources.postQuad)
  captureResources.postQuad.geometry.dispose()
  captureResources.postQuad.material.dispose()
  captureResources.sceneTarget.dispose()
  captureResources.outputTarget.dispose()
  captureResources.previewCanvas.remove()
  captureResources = null
}

const ensureCaptureResources = (width, height) => {
  const resolvedWidth = Math.max(1, Math.floor(width))
  const resolvedHeight = Math.max(1, Math.floor(height))
  if (
    captureResources &&
    captureResources.width === resolvedWidth &&
    captureResources.height === resolvedHeight
  ) {
    return captureResources
  }

  disposeCaptureResources()

  const sceneTarget = new THREE.RenderTarget(resolvedWidth, resolvedHeight, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: renderer.outputColorSpace,
    depthBuffer: true,
    stencilBuffer: false,
    samples: 0,
  })
  const outputTarget = new THREE.RenderTarget(resolvedWidth, resolvedHeight, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: renderer.outputColorSpace,
    depthBuffer: false,
    stencilBuffer: false,
    samples: 0,
  })
  renderer.initRenderTarget(sceneTarget)
  renderer.initRenderTarget(outputTarget)

  const postScene = new THREE.Scene()
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const postQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({
      map: sceneTarget.texture,
      transparent: true,
    }),
  )
  postScene.add(postQuad)

  const previewCanvas = document.createElement('canvas')
  previewCanvas.width = resolvedWidth
  previewCanvas.height = resolvedHeight
  previewCanvas.style.position = 'fixed'
  previewCanvas.style.left = '-99999px'
  previewCanvas.style.top = '-99999px'
  previewCanvas.style.width = `${resolvedWidth}px`
  previewCanvas.style.height = `${resolvedHeight}px`
  previewCanvas.style.pointerEvents = 'none'
  previewCanvas.setAttribute('aria-hidden', 'true')
  document.body.appendChild(previewCanvas)

  captureResources = {
    width: resolvedWidth,
    height: resolvedHeight,
    sceneTarget,
    outputTarget,
    postScene,
    postCamera,
    postQuad,
    previewCanvas,
  }
  return captureResources
}

const readPackedRenderTargetRgba = async (target, width, height) => {
  const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height)
  if (!(pixels instanceof Uint8Array)) {
    throw new Error('Expected Uint8Array render target pixels.')
  }

  const packedBytesPerRow = width * 4
  const packedByteLength = packedBytesPerRow * height
  if (pixels.byteLength === packedByteLength) {
    return new Uint8Array(pixels).buffer
  }

  const paddedBytesPerRow = Math.ceil(packedBytesPerRow / 256) * 256
  const minimumExpectedByteLength = ((height - 1) * paddedBytesPerRow) + packedBytesPerRow
  if (pixels.byteLength < minimumExpectedByteLength) {
    throw new Error(
      `Readback buffer is smaller than expected: got ${pixels.byteLength} bytes, need at least ${minimumExpectedByteLength}.`,
    )
  }

  const packedPixels = new Uint8Array(packedByteLength)
  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const sourceStart = rowIndex * paddedBytesPerRow
    const sourceEnd = sourceStart + packedBytesPerRow
    const targetStart = rowIndex * packedBytesPerRow
    packedPixels.set(pixels.subarray(sourceStart, sourceEnd), targetStart)
  }

  return packedPixels.buffer
}

const renderCaptureFrame = async (elapsedTime, width, height) => {
  const resources = ensureCaptureResources(width, height)
  const previousAspect = camera.aspect

  camera.aspect = resources.width / Math.max(1, resources.height)
  camera.updateProjectionMatrix()
  try {
    await atmosphereRig.prime(renderer)
    renderer.setRenderTarget(resources.sceneTarget)
    renderer.clear()
    gridOverlay.setCameraPosition(camera.position)
    atmosphereRig.update(renderer, camera)
    renderer.render(scene, camera)
    if (starsEnabled) {
      starOverlay.render(renderer, camera, sunState.altitudeDeg)
    }

    renderer.setRenderTarget(resources.outputTarget)
    renderer.render(resources.postScene, resources.postCamera)
    renderer.setRenderTarget(null)
  } finally {
    camera.aspect = previousAspect
    camera.updateProjectionMatrix()
  }
}

const setAtmospherePreset = (nextPreset) => {
  atmospherePreset = nextPreset
  Object.assign(
    atmosphereSettings,
    nextPreset === 'alternate' ? ALT_ATMOSPHERE_SETTINGS : EARTH_ATMOSPHERE_SETTINGS,
  )
  applyVisualExposure()
  syncPaneState()
  void atmosphereRig
    .prime(renderer)
    .then(() => {
      renderDisplayFrame()
    })
    .catch((error) => {
      console.error('Failed to re-prime atmosphere preset.', error)
    })
}

const toggleAtmospherePreset = () => {
  setAtmospherePreset(atmospherePreset === 'alternate' ? 'earth' : 'alternate')
}

const adjustSunAltitude = (deltaDeg) => {
  sunState.altitudeDeg = THREE.MathUtils.clamp(
    sunState.altitudeDeg + deltaDeg,
    MIN_SUN_ALTITUDE_DEG,
    MAX_SUN_ALTITUDE_DEG,
  )
  atmosphereRig.setSunAngles(sunState.altitudeDeg, sunState.azimuthDeg)
  syncPaneState()
}

const adjustExposure = (deltaStops) => {
  exposure = THREE.MathUtils.clamp(
    exposure * 2 ** deltaStops,
    MIN_EXPOSURE,
    MAX_EXPOSURE,
  )
  applyVisualExposure()
  syncPaneState()
}

const adjustStarScaleRange = (scaleFactor) => {
  minStarScale = THREE.MathUtils.clamp(
    minStarScale * scaleFactor,
    MIN_STAR_SCALE_LIMIT,
    MAX_STAR_SCALE_LIMIT,
  )
  maxStarScale = THREE.MathUtils.clamp(
    maxStarScale * scaleFactor,
    minStarScale,
    MAX_STAR_SCALE_LIMIT,
  )
  starOverlay.setScaleRange(minStarScale, maxStarScale)
  syncPaneState()
}

const stopDragging = () => {
  if (dragging && activePointerId !== null && canvas.hasPointerCapture(activePointerId)) {
    canvas.releasePointerCapture(activePointerId)
  }
  dragging = false
  activePointerId = null
  canvas.style.cursor = 'grab'
}

const getLookScale = () => {
  const width = Math.max(1, canvas.clientWidth || window.innerWidth)
  const height = Math.max(1, canvas.clientHeight || window.innerHeight)
  const verticalFov = THREE.MathUtils.degToRad(camera.fov)
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov * 0.5) * camera.aspect)
  return {
    yawPerPixel: horizontalFov / width,
    pitchPerPixel: verticalFov / height,
  }
}

const updateLook = (deltaX, deltaY) => {
  const { yawPerPixel, pitchPerPixel } = getLookScale()
  yaw += deltaX * yawPerPixel
  pitch = THREE.MathUtils.clamp(pitch + deltaY * pitchPerPixel, -MAX_PITCH, MAX_PITCH)
  applyCameraOrientation()
}

const getWorldDirectionAtPointer = (clientX, clientY, target) => {
  const rect = canvas.getBoundingClientRect()
  const width = Math.max(1, rect.width)
  const height = Math.max(1, rect.height)
  const ndcX = ((clientX - rect.left) / width) * 2 - 1
  const ndcY = -(((clientY - rect.top) / height) * 2 - 1)
  zoomPointer.set(ndcX, ndcY, 0.5)
  return target.copy(zoomPointer).unproject(camera).sub(camera.position).normalize()
}

const updateZoom = (deltaY, clientX, clientY) => {
  getWorldDirectionAtPointer(clientX, clientY, zoomBeforeDirection)
  const zoomFactor = Math.exp(deltaY * ZOOM_SENSITIVITY)
  camera.fov = THREE.MathUtils.clamp(camera.fov * zoomFactor, MIN_FOV, MAX_FOV)
  camera.updateProjectionMatrix()
  getWorldDirectionAtPointer(clientX, clientY, zoomAfterDirection)
  zoomRotation.setFromUnitVectors(zoomAfterDirection, zoomBeforeDirection)
  zoomedCameraQuaternion.copy(zoomRotation).multiply(camera.quaternion)
  setCameraOrientationFromQuaternion(zoomedCameraQuaternion)
}

const updateAltitude = (deltaSeconds) => {
  const direction = (movementState.up ? 1 : 0) - (movementState.down ? 1 : 0)
  if (direction === 0) return

  const speedMetersPerSecond = Math.max(
    MIN_ALTITUDE_SPEED_MPS,
    altitudeMeters * ALTITUDE_SPEED_FACTOR,
  )
  altitudeMeters = THREE.MathUtils.clamp(
    altitudeMeters + direction * speedMetersPerSecond * deltaSeconds,
    MIN_ALTITUDE_METERS,
    MAX_ALTITUDE_METERS,
  )
  syncCameraAltitude()
  syncPaneState()
}

const bindAtmosphereSetting = (folder, key, options = {}) => {
  folder.addBinding(atmosphereSettings, key, options).on('change', () => {
    applyVisualExposure()
    syncPaneState()
  })
}

const buildControlPanel = () => {
  const sceneFolder = pane.addFolder({
    title: 'Scene',
    expanded: true,
  })
  sceneFolder
    .addBinding(paneState, 'preset', {
      label: 'Preset',
      options: {
        Earth: 'earth',
        Alternate: 'alternate',
      },
    })
    .on('change', (event) => {
      setAtmospherePreset(event.value)
    })
  sceneFolder
    .addBinding(paneState, 'sunAltitudeDeg', {
      label: 'Sun alt',
      min: MIN_SUN_ALTITUDE_DEG,
      max: MAX_SUN_ALTITUDE_DEG,
      step: 0.1,
    })
    .on('change', (event) => {
      sunState.altitudeDeg = event.value
      atmosphereRig.setSunAngles(sunState.altitudeDeg, sunState.azimuthDeg)
      syncPaneState()
    })
  sceneFolder
    .addBinding(paneState, 'sunAzimuthDeg', {
      label: 'Sun az',
      min: -180,
      max: 180,
      step: 0.1,
    })
    .on('change', (event) => {
      sunState.azimuthDeg = event.value
      atmosphereRig.setSunAngles(sunState.altitudeDeg, sunState.azimuthDeg)
      syncPaneState()
    })
  sceneFolder
    .addBinding(paneState, 'exposure', {
      label: 'Exposure',
      min: MIN_EXPOSURE,
      max: MAX_EXPOSURE,
      step: 0.01,
    })
    .on('change', (event) => {
      exposure = event.value
      applyVisualExposure()
      syncPaneState()
    })
  sceneFolder
    .addBinding(paneState, 'observerLatitudeDeg', {
      label: 'Latitude',
      min: -90,
      max: 90,
      step: 0.1,
    })
    .on('change', (event) => {
      observerLatitudeDeg = event.value
      updateEquatorialFrame()
      applyVisualExposure()
      syncPaneState()
    })
  sceneFolder
    .addBinding(paneState, 'observerLongitudeDeg', {
      label: 'Longitude',
      min: -180,
      max: 180,
      step: 0.1,
    })
    .on('change', (event) => {
      observerLongitudeDeg = event.value
      updateEquatorialFrame()
      applyVisualExposure()
      syncPaneState()
    })

  const visualFolder = pane.addFolder({
    title: 'Visual',
    expanded: false,
  })
  bindAtmosphereSetting(visualFolder, 'skyIntensity', {
    label: 'Sky int',
    min: 0,
    max: 4,
    step: 0.01,
  })
  bindAtmosphereSetting(visualFolder, 'skyTintR', {
    label: 'Sky R',
    min: 0,
    max: 2,
    step: 0.01,
  })
  bindAtmosphereSetting(visualFolder, 'skyTintG', {
    label: 'Sky G',
    min: 0,
    max: 2,
    step: 0.01,
  })
  bindAtmosphereSetting(visualFolder, 'skyTintB', {
    label: 'Sky B',
    min: 0,
    max: 2,
    step: 0.01,
  })
  bindAtmosphereSetting(visualFolder, 'sunDiscIntensity', {
    label: 'Sun int',
    min: 0,
    max: 4,
    step: 0.01,
  })
  bindAtmosphereSetting(visualFolder, 'sunDiscColorR', {
    label: 'Sun R',
    min: 0,
    max: 2,
    step: 0.01,
  })
  bindAtmosphereSetting(visualFolder, 'sunDiscColorG', {
    label: 'Sun G',
    min: 0,
    max: 2,
    step: 0.01,
  })
  bindAtmosphereSetting(visualFolder, 'sunDiscColorB', {
    label: 'Sun B',
    min: 0,
    max: 2,
    step: 0.01,
  })
  bindAtmosphereSetting(visualFolder, 'sunDiscInnerScale', {
    label: 'Sun in',
    min: 0.1,
    max: 5,
    step: 0.01,
  })
  bindAtmosphereSetting(visualFolder, 'sunDiscOuterScale', {
    label: 'Sun out',
    min: 0.1,
    max: 6,
    step: 0.01,
  })

  const mediumFolder = pane.addFolder({
    title: 'Medium',
    expanded: false,
  })
  bindAtmosphereSetting(mediumFolder, 'rayleighScaleHeightM', {
    label: 'Ray h',
    min: 100,
    max: 30000,
    step: 100,
  })
  bindAtmosphereSetting(mediumFolder, 'mieScaleHeightM', {
    label: 'Mie h',
    min: 50,
    max: 10000,
    step: 50,
  })
  bindAtmosphereSetting(mediumFolder, 'miePhaseG', {
    label: 'Mie g',
    min: 0,
    max: 0.99,
    step: 0.001,
  })
  bindAtmosphereSetting(mediumFolder, 'rayleighScatteringMultiplier', {
    label: 'Ray mult',
    min: 0,
    max: 6,
    step: 0.01,
  })
  bindAtmosphereSetting(mediumFolder, 'mieScatteringMultiplier', {
    label: 'Mie scat',
    min: 0,
    max: 6,
    step: 0.01,
  })
  bindAtmosphereSetting(mediumFolder, 'mieExtinctionMultiplier', {
    label: 'Mie ext',
    min: 0,
    max: 6,
    step: 0.01,
  })
  bindAtmosphereSetting(mediumFolder, 'absorptionExtinctionMultiplier', {
    label: 'Abs ext',
    min: 0,
    max: 6,
    step: 0.01,
  })
  bindAtmosphereSetting(mediumFolder, 'groundAlbedo', {
    label: 'Albedo',
    min: 0,
    max: 1,
    step: 0.01,
  })

  const astronomicalFolder = pane.addFolder({
    title: 'Astronomical',
    expanded: false,
  })
  bindAtmosphereSetting(astronomicalFolder, 'planetRadiusM', {
    label: 'Planet R',
    min: 500000,
    max: 30000000,
    step: 10000,
  })
  bindAtmosphereSetting(astronomicalFolder, 'atmosphereHeightM', {
    label: 'Atmo H',
    min: 1000,
    max: 200000,
    step: 1000,
  })
  bindAtmosphereSetting(astronomicalFolder, 'starRadiusM', {
    label: 'Star R',
    min: 100000000,
    max: 3000000000,
    step: 1000000,
  })
  bindAtmosphereSetting(astronomicalFolder, 'planetStarDistanceM', {
    label: 'Distance',
    min: 1000000000,
    max: 500000000000,
    step: 100000000,
  })
  bindAtmosphereSetting(astronomicalFolder, 'starEffectiveTemperatureK', {
    label: 'Star K',
    min: 1000,
    max: 20000,
    step: 10,
  })

  const starsFolder = pane.addFolder({
    title: 'Stars',
    expanded: true,
  })
  starsFolder
    .addBinding(paneState, 'showAltAzGrid', {
      label: 'Alt/Az grid',
    })
    .on('change', (event) => {
      gridState.showAltAzGrid = event.value
      gridOverlay.setAltAzEnabled(gridState.showAltAzGrid)
      syncPaneState()
    })
  starsFolder
    .addBinding(paneState, 'showRaDecGrid', {
      label: 'RA/Dec grid',
    })
    .on('change', (event) => {
      gridState.showRaDecGrid = event.value
      gridOverlay.setRaDecEnabled(gridState.showRaDecGrid)
      syncPaneState()
    })
  starsFolder
    .addBinding(paneState, 'minStarScale', {
      label: 'Min size',
      min: MIN_STAR_SCALE_LIMIT,
      max: MAX_STAR_SCALE_LIMIT,
      step: 0.01,
    })
    .on('change', (event) => {
      minStarScale = Math.min(event.value, maxStarScale)
      starOverlay.setScaleRange(minStarScale, maxStarScale)
      syncPaneState()
    })
  starsFolder
    .addBinding(paneState, 'maxStarScale', {
      label: 'Max size',
      min: MIN_STAR_SCALE_LIMIT,
      max: MAX_STAR_SCALE_LIMIT,
      step: 0.01,
    })
    .on('change', (event) => {
      maxStarScale = Math.max(event.value, minStarScale)
      starOverlay.setScaleRange(minStarScale, maxStarScale)
      syncPaneState()
    })

  const cameraFolder = pane.addFolder({
    title: 'Camera',
    expanded: false,
  })
  cameraFolder
    .addBinding(paneState, 'altitudeKm', {
      label: 'Altitude km',
      min: MIN_ALTITUDE_METERS / 1000,
      max: MAX_ALTITUDE_METERS / 1000,
      step: 0.1,
    })
    .on('change', (event) => {
      altitudeMeters = event.value * 1000
      syncCameraAltitude()
      syncPaneState()
    })
}

canvas.style.cursor = 'grab'
canvas.style.touchAction = 'none'
updateEquatorialFrame()
gridOverlay.setAltAzEnabled(gridState.showAltAzGrid)
gridOverlay.setRaDecEnabled(gridState.showRaDecGrid)
buildControlPanel()
syncPaneState()

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  dragging = true
  activePointerId = event.pointerId
  lastPointerX = event.clientX
  lastPointerY = event.clientY
  canvas.setPointerCapture(event.pointerId)
  canvas.style.cursor = 'grabbing'
})

canvas.addEventListener('pointermove', (event) => {
  if (!dragging || event.pointerId !== activePointerId) return
  const deltaX = event.clientX - lastPointerX
  const deltaY = event.clientY - lastPointerY
  lastPointerX = event.clientX
  lastPointerY = event.clientY
  updateLook(deltaX, deltaY)
})

canvas.addEventListener('pointerup', (event) => {
  if (event.pointerId !== activePointerId) return
  stopDragging()
})

canvas.addEventListener('pointercancel', (event) => {
  if (event.pointerId !== activePointerId) return
  stopDragging()
})

canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    updateZoom(event.deltaY, event.clientX, event.clientY)
  },
  { passive: false },
)

window.addEventListener('blur', () => {
  movementState.up = false
  movementState.down = false
  stopDragging()
})
window.addEventListener('resize', handleResize)
window.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) {
    return
  }

  if (event.key === '+') {
    event.preventDefault()
    adjustExposure(EXPOSURE_STEP_STOPS)
    return
  }

  if (event.key === '_') {
    event.preventDefault()
    adjustExposure(-EXPOSURE_STEP_STOPS)
    return
  }

  if (event.key === '=') {
    event.preventDefault()
    adjustSunAltitude(SUN_ALTITUDE_STEP_DEG)
    return
  }

  if (event.key === '-') {
    event.preventDefault()
    adjustSunAltitude(-SUN_ALTITUDE_STEP_DEG)
    return
  }

  if (event.key === 'j' || event.key === 'J') {
    event.preventDefault()
    adjustStarScaleRange(1 / STAR_SCALE_STEP)
    return
  }

  if (event.key === 'k' || event.key === 'K') {
    event.preventDefault()
    adjustStarScaleRange(STAR_SCALE_STEP)
    return
  }

  if (event.repeat) {
    return
  }

  if (event.key === '1') {
    event.preventDefault()
    toggleAtmospherePreset()
    return
  }

  if (event.key === 'w' || event.key === 'W') {
    event.preventDefault()
    movementState.up = true
    return
  }

  if (event.key === 's' || event.key === 'S') {
    event.preventDefault()
    movementState.down = true
  }
})

window.addEventListener('keyup', (event) => {
  if (event.key === 'w' || event.key === 'W') {
    movementState.up = false
    return
  }

  if (event.key === 's' || event.key === 'S') {
    movementState.down = false
  }
})

const createIdeaOrcaCapture = () => ({
  describe: async () => ({
    name: 'three-tsl-atmosphere',
    mode: 'manual',
    width: canvas.clientWidth || window.innerWidth,
    height: canvas.clientHeight || window.innerHeight,
  }),
  prepare: async ({ width, height }) => {
    handleResize()
    await renderCaptureFrame(0, width, height)
  },
  renderFrame: async ({ elapsedTime }) => {
    handleResize()
    const width = captureResources?.width ?? canvas.clientWidth ?? window.innerWidth
    const height = captureResources?.height ?? canvas.clientHeight ?? window.innerHeight
    await renderCaptureFrame(elapsedTime, width, height)
  },
  readFrameRgba: async () => {
    if (!captureResources) {
      throw new Error('Capture surface is not prepared.')
    }
    return readPackedRenderTargetRgba(
      captureResources.outputTarget,
      captureResources.width,
      captureResources.height,
    )
  },
  getVideoFrameSource: async () => {
    if (!captureResources) {
      throw new Error('Capture surface is not prepared.')
    }
    const context = captureResources.previewCanvas.getContext('2d')
    if (!context) {
      throw new Error('2D preview canvas context is unavailable.')
    }
    const rgba = await readPackedRenderTargetRgba(
      captureResources.outputTarget,
      captureResources.width,
      captureResources.height,
    )
    const pixels = new Uint8ClampedArray(rgba)
    const imageData = new ImageData(
      pixels,
      captureResources.width,
      captureResources.height,
    )
    context.putImageData(imageData, 0, 0)
    return captureResources.previewCanvas
  },
})

const sampleCanvasStats = () => {
  const sampleWidth = 64
  const sampleHeight = 64
  const sampleCanvas = document.createElement('canvas')
  sampleCanvas.width = sampleWidth
  sampleCanvas.height = sampleHeight
  const context = sampleCanvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    throw new Error('Failed to create 2D sample context.')
  }

  context.drawImage(canvas, 0, 0, sampleWidth, sampleHeight)
  const { data } = context.getImageData(0, 0, sampleWidth, sampleHeight)
  let sumLuminance = 0
  let maxLuminance = 0
  let nonBlackCount = 0

  for (let index = 0; index < data.length; index += 4) {
    const r = data[index] / 255
    const g = data[index + 1] / 255
    const b = data[index + 2] / 255
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    sumLuminance += luminance
    maxLuminance = Math.max(maxLuminance, luminance)
    if (luminance > 0.002) {
      nonBlackCount += 1
    }
  }

  const pixelCount = sampleWidth * sampleHeight
  return {
    averageLuminance: sumLuminance / pixelCount,
    maxLuminance,
    nonBlackFraction: nonBlackCount / pixelCount,
  }
}

const waitForFrames = async (frameCount = 2) => {
  for (let index = 0; index < frameCount; index += 1) {
    await new Promise((resolve) => {
      requestAnimationFrame(() => resolve(undefined))
    })
  }
}

const settleAfterSettingChange = async () => {
  await atmosphereRig.prime(renderer)
  await waitForFrames(3)
  renderDisplayFrame()
  await waitForFrames(2)
}

const createTestApi = () => ({
  isReady: () => isPreviewReady,
  waitUntilReady: () => previewReadyPromise,
  getState: () => ({
    atmospherePreset,
    atmosphereSettings: { ...atmosphereSettings },
    sunState: { ...sunState },
    exposure,
    minStarScale,
    maxStarScale,
    altitudeMeters,
    cameraFov: camera.fov,
    starsEnabled,
  }),
  sampleCanvasStats,
  async setAtmosphereSetting(key, value) {
    if (!(key in atmosphereSettings)) {
      throw new Error(`Unknown atmosphere setting: ${String(key)}`)
    }
    atmosphereSettings[key] = value
    applyVisualExposure()
    syncPaneState()
    await settleAfterSettingChange()
    return sampleCanvasStats()
  },
  async setSunAngles(altitudeDeg, azimuthDeg = sunState.azimuthDeg) {
    sunState.altitudeDeg = altitudeDeg
    sunState.azimuthDeg = azimuthDeg
    atmosphereRig.setSunAngles(sunState.altitudeDeg, sunState.azimuthDeg)
    syncPaneState()
    await waitForFrames(2)
    renderDisplayFrame()
    return sampleCanvasStats()
  },
  async setExposure(nextExposure) {
    exposure = THREE.MathUtils.clamp(nextExposure, MIN_EXPOSURE, MAX_EXPOSURE)
    applyVisualExposure()
    syncPaneState()
    await waitForFrames(2)
    renderDisplayFrame()
    return sampleCanvasStats()
  },
  async setPreset(nextPreset) {
    setAtmospherePreset(nextPreset)
    await settleAfterSettingChange()
    return sampleCanvasStats()
  },
})

globalThis.__ideaOrcaCapture = createIdeaOrcaCapture()
globalThis.__threeTslAtmosphereTest = createTestApi()

const bootstrap = async () => {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not available in this browser.')
  }

  applyCameraOrientation()
  await renderer.init()
  handleResize()
  await Promise.all([
    atmosphereRig.prime(renderer),
    starsEnabled ? starOverlay.load(GAIA_CHUNK_URLS) : Promise.resolve(),
  ])
  applyVisualExposure()
  renderDisplayFrame()

  isPreviewReady = true
  resolvePreviewReadyPromise?.()
  window.dispatchEvent(new Event('idea-orca-preview-ready'))

  lastFrameTimeMs = performance.now()
  renderer.setAnimationLoop(() => {
    const nowMs = performance.now()
    const deltaSeconds = Math.min((nowMs - lastFrameTimeMs) / 1000, 0.1)
    lastFrameTimeMs = nowMs
    updateAltitude(deltaSeconds)
    renderDisplayFrame()
  })
}

bootstrap().catch((error) => {
  console.error(error)
  document.body.innerHTML = `<pre>${error instanceof Error ? error.message : String(error)}</pre>`
})
