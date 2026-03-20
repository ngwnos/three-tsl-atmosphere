import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { WebGPURenderer } from 'three/webgpu'
import { createAtmosphereRig } from 'three-tsl-atmosphere'

const canvas = document.querySelector('#app')
const altitudeInput = document.querySelector('#altitude')
const azimuthInput = document.querySelector('#azimuth')
const intensityInput = document.querySelector('#intensity')
const animateInput = document.querySelector('#animate')
const altitudeValue = document.querySelector('#altitude-value')
const azimuthValue = document.querySelector('#azimuth-value')
const intensityValue = document.querySelector('#intensity-value')

if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing demo canvas')
if (!(altitudeInput instanceof HTMLInputElement)) throw new Error('Missing altitude input')
if (!(azimuthInput instanceof HTMLInputElement)) throw new Error('Missing azimuth input')
if (!(intensityInput instanceof HTMLInputElement)) throw new Error('Missing intensity input')
if (!(animateInput instanceof HTMLInputElement)) throw new Error('Missing animate input')
if (!(altitudeValue instanceof HTMLElement)) throw new Error('Missing altitude label')
if (!(azimuthValue instanceof HTMLElement)) throw new Error('Missing azimuth label')
if (!(intensityValue instanceof HTMLElement)) throw new Error('Missing intensity label')

const formatDegrees = (value) => `${Math.round(value)}°`
const formatIntensity = (value) => value.toFixed(1)

const scene = new THREE.Scene()
scene.fog = new THREE.FogExp2(0xb1cad7, 0.014)

const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 500)
camera.position.set(15, 7.5, 16)

const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: false })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.maxDistance = 48
controls.minDistance = 6
controls.target.set(0, 1.5, 0)

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(80, 96),
  new THREE.MeshStandardMaterial({
    color: 0x3e5749,
    roughness: 0.96,
    metalness: 0.03,
  }),
)
ground.rotation.x = -Math.PI / 2
ground.position.y = -0.02
ground.receiveShadow = true
scene.add(ground)

const plinthMaterial = new THREE.MeshStandardMaterial({
  color: 0xc7d6e4,
  roughness: 0.5,
  metalness: 0.06,
})
const towerMaterial = new THREE.MeshStandardMaterial({
  color: 0xcca46b,
  roughness: 0.38,
  metalness: 0.08,
})

const addTower = (x, z, height, radius, material) => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 36), material)
  mesh.position.set(x, height * 0.5, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  scene.add(mesh)
}

addTower(-5.5, -2.4, 2.8, 1.0, plinthMaterial)
addTower(0.0, 0.0, 5.6, 0.75, towerMaterial)
addTower(4.8, 2.1, 3.9, 0.92, plinthMaterial)
addTower(-1.8, 5.7, 2.2, 0.65, towerMaterial)

const ring = new THREE.Mesh(
  new THREE.TorusGeometry(3.2, 0.14, 22, 120),
  new THREE.MeshStandardMaterial({
    color: 0xe8f2ff,
    emissive: 0x284058,
    emissiveIntensity: 0.22,
    roughness: 0.28,
    metalness: 0.62,
  }),
)
ring.position.set(0, 6.3, 0)
ring.rotation.x = Math.PI * 0.5
scene.add(ring)

const atmosphereRig = createAtmosphereRig(scene, {
  sun: {
    altitudeDeg: Number(altitudeInput.value),
    azimuthDeg: Number(azimuthInput.value),
    intensity: Number(intensityInput.value),
  },
  environment: {
    enabled: true,
    mode: 'on-change',
    resolution: 128,
    captureOnPrime: true,
  },
  ambientIntensity: 0.45,
  maxSunIntensity: 12,
})

const syncHud = () => {
  altitudeValue.textContent = formatDegrees(Number(altitudeInput.value))
  azimuthValue.textContent = formatDegrees(Number(azimuthInput.value))
  intensityValue.textContent = formatIntensity(Number(intensityInput.value))
}

const syncSun = () => {
  atmosphereRig.setSun({
    altitudeDeg: Number(altitudeInput.value),
    azimuthDeg: Number(azimuthInput.value),
    intensity: Number(intensityInput.value),
  })
}

altitudeInput.addEventListener('input', () => {
  syncHud()
  syncSun()
})
azimuthInput.addEventListener('input', () => {
  syncHud()
  syncSun()
})
intensityInput.addEventListener('input', () => {
  syncHud()
  syncSun()
})

syncHud()

const handleResize = () => {
  const width = window.innerWidth
  const height = window.innerHeight
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height, false)
}

window.addEventListener('resize', handleResize)

const bootstrap = async () => {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not available in this browser.')
  }

  await renderer.init()
  handleResize()
  await atmosphereRig.prime(renderer)

  const clock = new THREE.Clock()

  renderer.setAnimationLoop(() => {
    const elapsed = clock.getElapsedTime()

    if (animateInput.checked) {
      const animatedAltitude = 18 + Math.sin(elapsed * 0.18) * 24
      const animatedAzimuth = -30 + elapsed * 11
      altitudeInput.value = String(animatedAltitude)
      azimuthInput.value = String((((animatedAzimuth + 180) % 360) + 360) % 360 - 180)
      syncHud()
      syncSun()
    }

    ring.rotation.z += 0.0024
    controls.update()
    atmosphereRig.update(renderer, camera)
    renderer.render(scene, camera)
  })
}

bootstrap().catch((error) => {
  console.error(error)
  const hud = document.querySelector('.hud')
  if (!(hud instanceof HTMLElement)) return
  hud.innerHTML = `
    <div class="hud__title">
      <h1>three-tsl-atmosphere</h1>
      <p>Failed to start the WebGPU demo.</p>
      <p>${error instanceof Error ? error.message : String(error)}</p>
    </div>
  `
})
