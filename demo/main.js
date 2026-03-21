import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import {
  createAtmosphereRig,
  DEFAULT_ATMOSPHERE_SETTINGS,
  DEFAULT_ATMOSPHERE_PHYSICAL_SETTINGS,
} from 'three-tsl-atmosphere'

const canvas = document.querySelector('#app')
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Missing demo canvas')
}

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
const cameraAnchor = new THREE.Vector3(0, 1.7, 0)
const cameraEuler = new THREE.Euler(0, 0, 0, 'YXZ')
const zoomPointer = new THREE.Vector3()
const zoomBeforeDirection = new THREE.Vector3()
const zoomAfterDirection = new THREE.Vector3()
const zoomRotation = new THREE.Quaternion()
const zoomedCameraQuaternion = new THREE.Quaternion()
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
let atmosphereMode = 'artistic'

camera.position.copy(cameraAnchor)

const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: false })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

const atmosphereRig = createAtmosphereRig(scene, {
  skyLayer: 0,
  sun: {
    altitudeDeg: 24,
    azimuthDeg: -35,
    intensity: 6,
  },
  environment: {
    enabled: false,
  },
  ambientIntensity: 0,
})

const applyCameraOrientation = () => {
  camera.position.copy(cameraAnchor)
  cameraEuler.set(pitch, yaw, 0)
  camera.quaternion.setFromEuler(cameraEuler)
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
  atmosphereRig.update(renderer, camera)
  renderer.render(scene, camera)
}

const setAtmosphereMode = (nextMode) => {
  atmosphereMode = nextMode
  atmosphereRig.setAtmosphereSettings(
    nextMode === 'physical'
      ? DEFAULT_ATMOSPHERE_PHYSICAL_SETTINGS
      : DEFAULT_ATMOSPHERE_SETTINGS,
  )
  void atmosphereRig
    .prime(renderer)
    .then(() => {
      renderDisplayFrame()
    })
    .catch((error) => {
      console.error('Failed to re-prime atmosphere mode.', error)
    })
}

const toggleAtmosphereMode = () => {
  setAtmosphereMode(atmosphereMode === 'physical' ? 'artistic' : 'physical')
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

window.addEventListener('blur', stopDragging)
window.addEventListener('resize', handleResize)
window.addEventListener('keydown', (event) => {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.key !== '1'
  ) {
    return
  }

  event.preventDefault()
  toggleAtmosphereMode()
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
  await atmosphereRig.prime(renderer)

  window.dispatchEvent(new Event('idea-orca-preview-ready'))

  renderer.setAnimationLoop(() => {
    renderDisplayFrame()
  })
}

bootstrap().catch((error) => {
  console.error(error)
  document.body.innerHTML = `<pre>${error instanceof Error ? error.message : String(error)}</pre>`
})
