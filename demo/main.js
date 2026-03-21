import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { createAtmosphereRig, DEFAULT_ATMOSPHERE_SETTINGS } from 'three-tsl-atmosphere'
import { GaiaStarOverlay } from './gaiaStarOverlay.js'

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
const MIN_STAR_SCALE = 0.25
const MAX_STAR_SCALE = 8
const STAR_SCALE_STEP = Math.SQRT2

const canvas = document.querySelector('#app')
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Missing demo canvas')
}

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
const cameraAnchor = new THREE.Vector3(0, MIN_ALTITUDE_METERS, 0)
const cameraEuler = new THREE.Euler(0, 0, 0, 'YXZ')
const zoomPointer = new THREE.Vector3()
const zoomBeforeDirection = new THREE.Vector3()
const zoomAfterDirection = new THREE.Vector3()
const zoomRotation = new THREE.Quaternion()
const zoomedCameraQuaternion = new THREE.Quaternion()
const clock = new THREE.Clock()
const MAX_PITCH = Math.PI * 0.48
const MIN_FOV = 20
const MAX_FOV = 90
const ZOOM_SENSITIVITY = 0.0015
let dragging = false
let activePointerId = null
let yaw = 0
let pitch = 0
let lastPointerX = 0
let lastPointerY = 0
let atmospherePreset = 'earth'
let altitudeMeters = MIN_ALTITUDE_METERS
let exposure = 1
let starScale = 1
const sunState = {
  altitudeDeg: 24,
  azimuthDeg: -35,
  intensity: 6,
}
const movementState = {
  up: false,
  down: false,
}

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

const getActiveAtmosphereSettings = () =>
  atmospherePreset === 'alternate'
    ? ALT_ATMOSPHERE_SETTINGS
    : EARTH_ATMOSPHERE_SETTINGS

const applyVisualExposure = () => {
  const baseSettings = getActiveAtmosphereSettings()
  atmosphereRig.setAtmosphereSettings({
    ...baseSettings,
    skyIntensity: baseSettings.skyIntensity * exposure,
    sunDiscIntensity: baseSettings.sunDiscIntensity * exposure,
  })
  starOverlay.setExposure(exposure)
  starOverlay.setScale(starScale)
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
  atmosphereRig.update(renderer, camera)
  renderer.render(scene, camera)
  starOverlay.render(renderer, camera, sunState.altitudeDeg)
}

const setAtmospherePreset = (nextPreset) => {
  atmospherePreset = nextPreset
  applyVisualExposure()
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
}

const adjustExposure = (deltaStops) => {
  exposure = THREE.MathUtils.clamp(
    exposure * 2 ** deltaStops,
    MIN_EXPOSURE,
    MAX_EXPOSURE,
  )
  applyVisualExposure()
}

const adjustStarScale = (scaleFactor) => {
  starScale = THREE.MathUtils.clamp(
    starScale * scaleFactor,
    MIN_STAR_SCALE,
    MAX_STAR_SCALE,
  )
  starOverlay.setScale(starScale)
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
}

canvas.style.cursor = 'grab'
canvas.style.touchAction = 'none'

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
    adjustStarScale(1 / STAR_SCALE_STEP)
    return
  }

  if (event.key === 'k' || event.key === 'K') {
    event.preventDefault()
    adjustStarScale(STAR_SCALE_STEP)
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
  prepare: async () => {
    handleResize()
    renderDisplayFrame()
  },
  renderFrame: async () => {
    handleResize()
    renderDisplayFrame()
  },
  getVideoFrameSource: async () => canvas,
})

globalThis.__ideaOrcaCapture = createIdeaOrcaCapture()

const bootstrap = async () => {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not available in this browser.')
  }

  applyCameraOrientation()
  await renderer.init()
  handleResize()
  await Promise.all([
    atmosphereRig.prime(renderer),
    starOverlay.load('/data/gaia/chunk_0000.bin'),
  ])
  applyVisualExposure()

  window.dispatchEvent(new Event('idea-orca-preview-ready'))

  clock.start()
  renderer.setAnimationLoop(() => {
    const deltaSeconds = Math.min(clock.getDelta(), 0.1)
    updateAltitude(deltaSeconds)
    renderDisplayFrame()
  })
}

bootstrap().catch((error) => {
  console.error(error)
  document.body.innerHTML = `<pre>${error instanceof Error ? error.message : String(error)}</pre>`
})
