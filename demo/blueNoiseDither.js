import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { screenUV, texture, uniform, vec2, vec3 } from 'three/tsl'

const BLUE_NOISE_TILE_SIZE = 128
const DITHER_STRENGTH = 1 / 255

export const loadBlueNoiseTexture = async (url) => {
  const textureLoader = new THREE.TextureLoader()
  const blueNoiseTexture = await textureLoader.loadAsync(url)
  blueNoiseTexture.colorSpace = THREE.NoColorSpace
  blueNoiseTexture.wrapS = THREE.RepeatWrapping
  blueNoiseTexture.wrapT = THREE.RepeatWrapping
  blueNoiseTexture.minFilter = THREE.NearestFilter
  blueNoiseTexture.magFilter = THREE.NearestFilter
  blueNoiseTexture.generateMipmaps = false
  blueNoiseTexture.needsUpdate = true
  return blueNoiseTexture
}

export const createBlueNoiseDitherPass = (sourceTexture, width, height, blueNoiseTexture) => {
  const postScene = new THREE.Scene()
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const noiseScale = uniform(
    new THREE.Vector2(width / BLUE_NOISE_TILE_SIZE, height / BLUE_NOISE_TILE_SIZE),
  )
  const ditherStrength = uniform(DITHER_STRENGTH)

  const material = new MeshBasicNodeMaterial()
  const sourceSample = texture(sourceTexture, vec2(screenUV.x, screenUV.y))
  const blueNoiseSample = blueNoiseTexture
    ? texture(blueNoiseTexture, screenUV.mul(noiseScale)).rgb.sub(vec3(0.5)).mul(ditherStrength)
    : vec3(0)

  material.colorNode = sourceSample.rgb.add(blueNoiseSample)
  material.opacityNode = sourceSample.a
  material.depthWrite = false
  material.depthTest = false

  const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  postQuad.frustumCulled = false
  postScene.add(postQuad)

  return {
    postScene,
    postCamera,
    postQuad,
    resize(nextWidth, nextHeight) {
      noiseScale.value.set(
        nextWidth / BLUE_NOISE_TILE_SIZE,
        nextHeight / BLUE_NOISE_TILE_SIZE,
      )
    },
    setEnabled(enabled) {
      ditherStrength.value = enabled ? DITHER_STRENGTH : 0
    },
    dispose() {
      postScene.remove(postQuad)
      postQuad.geometry.dispose()
      postQuad.material.dispose()
    },
  }
}
