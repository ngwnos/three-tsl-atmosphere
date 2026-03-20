import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { createAtmosphereRig } from 'three-tsl-atmosphere'

const canvas = document.querySelector('#app')
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Missing demo canvas')
}

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
camera.position.set(0, 1.7, 0)
camera.lookAt(0, 1.7, -1)

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

window.addEventListener('resize', handleResize)
globalThis.__ideaOrcaCapture = createIdeaOrcaCapture()

const bootstrap = async () => {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not available in this browser.')
  }

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
