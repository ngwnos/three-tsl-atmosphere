import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { createAtmosphereRig } from 'three-tsl-atmosphere'

const canvas = document.querySelector('#app')
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Missing demo canvas')
}

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
const cameraAnchor = new THREE.Vector3(0, 1.7, 0)
const cameraEuler = new THREE.Euler(0, 0, 0, 'YXZ')
const LOOK_SENSITIVITY = 0.004
const MAX_PITCH = Math.PI * 0.48
let dragging = false
let activePointerId = null
let yaw = 0
let pitch = 0
let lastPointerX = 0
let lastPointerY = 0

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

const stopDragging = () => {
  if (dragging && activePointerId !== null && canvas.hasPointerCapture(activePointerId)) {
    canvas.releasePointerCapture(activePointerId)
  }
  dragging = false
  activePointerId = null
  canvas.style.cursor = 'grab'
}

const updateLook = (deltaX, deltaY) => {
  yaw -= deltaX * LOOK_SENSITIVITY
  pitch = THREE.MathUtils.clamp(pitch - deltaY * LOOK_SENSITIVITY, -MAX_PITCH, MAX_PITCH)
  applyCameraOrientation()
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

window.addEventListener('blur', stopDragging)
window.addEventListener('resize', handleResize)

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
