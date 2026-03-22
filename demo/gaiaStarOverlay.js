import * as THREE from 'three'
import { MeshBasicNodeMaterial, StorageBufferAttribute } from 'three/webgpu'
import {
  Fn,
  If,
  Return,
  atomicAdd,
  dot,
  float,
  instanceIndex,
  positionLocal,
  pow,
  smoothstep,
  storage,
  texture,
  uint,
  uvec2,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'

const FLOATS_PER_STAR = 12
const FIXED_POINT_SCALE = 1 << 16
const STAR_SPHERE_RADIUS = 90
const REFERENCE_FOV_DEG = 60
const STAR_EXPOSURE = 1.6
const STAR_MIN_SCALE = 0.55
const STAR_MAX_SCALE = 2.4

const bpRpToRgb = (bpRp) => {
  if (!Number.isFinite(bpRp)) {
    return [1, 1, 1]
  }

  const colorVal = Math.max(-1, Math.min(3, bpRp))

  if (colorVal < -0.2) {
    return [0.4, 0.6, 1]
  }

  if (colorVal < 0.2) {
    const t = (colorVal + 0.2) / 0.4
    return [0.4 + 0.5 * t, 0.6 + 0.35 * t, 1]
  }

  if (colorVal < 0.8) {
    const t = (colorVal - 0.2) / 0.6
    return [0.9 + 0.1 * t, 0.95 + 0.05 * t, 1 - 0.3 * t]
  }

  if (colorVal < 1.5) {
    const t = (colorVal - 0.8) / 0.7
    return [1, 1 - 0.3 * t, 0.7 - 0.5 * t]
  }

  const t = Math.min(1, (colorVal - 1.5) / 1)
  return [1, 0.7 - 0.4 * t, 0.2 - 0.1 * t]
}

const computeFovBoost = (fovDeg) =>
  THREE.MathUtils.clamp(REFERENCE_FOV_DEG / Math.max(10, fovDeg), 0.75, 3.5)

export class GaiaStarOverlay {
  constructor() {
    this.starCount = 0

    this.directionSBA = null
    this.colorSBA = null
    this.magnitudeSBA = null

    this.directionBuf = null
    this.colorBuf = null
    this.magnitudeBuf = null

    this.accRSBA = null
    this.accGSBA = null
    this.accBSBA = null
    this.accRBuf = null
    this.accGBuf = null
    this.accBBuf = null
    this.accSize = 0
    this.accWidth = 0
    this.accHeight = 0

    this.accW = uniform(0, 'uint')
    this.accH = uniform(0, 'uint')
    this.fpScaleU = uniform(FIXED_POINT_SCALE, 'uint')
    this.invFpScale = uniform(1 / FIXED_POINT_SCALE)
    this.viewProjU = uniform(new THREE.Matrix4(), 'mat4')
    this.equatorialToLocalU = uniform(new THREE.Matrix4(), 'mat4')
    this.cameraPositionU = uniform(new THREE.Vector3())
    this.planetCenterU = uniform(new THREE.Vector3())
    this.planetRadiusU = uniform(1)
    this.fovBoostU = uniform(1)
    this.starDistanceU = uniform(STAR_SPHERE_RADIUS)
    this.starExposureU = uniform(STAR_EXPOSURE)
    this.starMinScaleU = uniform(STAR_MIN_SCALE)
    this.starMaxScaleU = uniform(STAR_MAX_SCALE)
    this.minMagnitudeU = uniform(0)
    this.maxMagnitudeU = uniform(1)
    this.transmittanceTextureNode = texture(new THREE.Texture())
    this.occlusionMaskTextureNode = texture(new THREE.Texture())

    this.clearAccumCompute = null
    this.splatCompute = null

    this.overlayScene = null
    this.overlayCamera = null
    this.compositeQuad = null

    this.tmpViewProj = new THREE.Matrix4()
    this.tmpViewRotationOnly = new THREE.Matrix4()
  }

  setExposure(exposure) {
    this.starExposureU.value = STAR_EXPOSURE * Math.max(0, exposure)
  }

  setEquatorialToLocal(matrix4) {
    this.equatorialToLocalU.value.copy(matrix4)
  }

  setScaleRange(minScale, maxScale) {
    const clampedMin = Math.max(0.1, minScale)
    const clampedMax = Math.max(clampedMin, maxScale)
    this.starMinScaleU.value = clampedMin
    this.starMaxScaleU.value = clampedMax
  }

  setPlanet(center, radius) {
    this.planetCenterU.value.copy(center)
    this.planetRadiusU.value = Math.max(0, radius)
  }

  setTransmittanceTexture(textureValue) {
    this.transmittanceTextureNode.value = textureValue ?? new THREE.Texture()
  }

  setOcclusionMaskTexture(textureValue) {
    this.occlusionMaskTextureNode.value = textureValue ?? new THREE.Texture()
  }

  async load(urls, options = {}) {
    const urlList = Array.isArray(urls) ? urls : [urls]
    const expectedStarCount = Number.isFinite(options.expectedStarCount)
      ? Math.max(0, Math.floor(options.expectedStarCount))
      : 0
    const onProgress =
      typeof options.onProgress === 'function' ? options.onProgress : null
    const reportProgress = (loadedChunks, loadedStars, phase = 'loading') => {
      onProgress?.({
        phase,
        loadedChunks,
        totalChunks: urlList.length,
        loadedStars,
        totalStars: expectedStarCount,
      })
    }
    let starCount = expectedStarCount
    reportProgress(0, 0, 'loading')
    if (starCount === 0) {
      for (const url of urlList) {
        const response = await fetch(url)
        if (!response.ok) {
          throw new Error(`Failed to load Gaia chunk: ${response.status} ${response.statusText}`)
        }

        const starData = new Float32Array(await response.arrayBuffer())
        if (starData.length % FLOATS_PER_STAR !== 0) {
          throw new Error(`Unexpected Gaia chunk size for ${url}.`)
        }

        starCount += starData.length / FLOATS_PER_STAR
      }
    }

    const directions = new Float32Array(starCount * 4)
    const colors = new Float32Array(starCount * 4)
    const magnitudes = new Float32Array(starCount)
    let minMagnitude = Number.POSITIVE_INFINITY
    let maxMagnitude = Number.NEGATIVE_INFINITY

    let starIndex = 0
    for (let urlIndex = 0; urlIndex < urlList.length; urlIndex += 1) {
      const url = urlList[urlIndex]
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Failed to load Gaia chunk: ${response.status} ${response.statusText}`)
      }

      const starData = new Float32Array(await response.arrayBuffer())
      if (starData.length % FLOATS_PER_STAR !== 0) {
        throw new Error(`Unexpected Gaia chunk size for ${url}.`)
      }

      const chunkStarCount = starData.length / FLOATS_PER_STAR
      if (starIndex + chunkStarCount > magnitudes.length) {
        throw new Error('Gaia star allocation was smaller than the loaded dataset.')
      }

      for (let chunkIndex = 0; chunkIndex < chunkStarCount; chunkIndex += 1) {
        const offset = chunkIndex * FLOATS_PER_STAR
        const ra = THREE.MathUtils.degToRad(starData[offset + 0])
        const dec = THREE.MathUtils.degToRad(starData[offset + 1])
        const magnitude = starData[offset + 6]
        const bpRp = starData[offset + 7]

        const horizontal = Math.cos(dec)
        const x = Math.sin(ra) * horizontal
        const y = Math.sin(dec)
        const z = Math.cos(ra) * horizontal
        const [r, g, b] = bpRpToRgb(bpRp)
        const directionBase = starIndex * 4

        directions[directionBase + 0] = x
        directions[directionBase + 1] = y
        directions[directionBase + 2] = z
        directions[directionBase + 3] = 1

        colors[directionBase + 0] = r
        colors[directionBase + 1] = g
        colors[directionBase + 2] = b
        colors[directionBase + 3] = 1

        magnitudes[starIndex] = magnitude
        minMagnitude = Math.min(minMagnitude, magnitude)
        maxMagnitude = Math.max(maxMagnitude, magnitude)
        starIndex += 1
      }

      reportProgress(urlIndex + 1, starIndex, 'loading')
    }

    this.starCount = starIndex
    this.directionSBA = new StorageBufferAttribute(directions, 4)
    this.colorSBA = new StorageBufferAttribute(colors, 4)
    this.magnitudeSBA = new StorageBufferAttribute(magnitudes, 1)

    this.directionBuf = storage(this.directionSBA, 'vec4', this.starCount)
    this.colorBuf = storage(this.colorSBA, 'vec4', this.starCount)
    this.magnitudeBuf = storage(this.magnitudeSBA, 'float', this.starCount)
    this.minMagnitudeU.value = Number.isFinite(minMagnitude) ? minMagnitude : 0
    this.maxMagnitudeU.value =
      Number.isFinite(maxMagnitude) && maxMagnitude > this.minMagnitudeU.value
        ? maxMagnitude
        : this.minMagnitudeU.value + 1

    this.directionSBA.needsUpdate = true
    this.colorSBA.needsUpdate = true
    this.magnitudeSBA.needsUpdate = true
    reportProgress(urlList.length, this.starCount, 'ready')
  }

  ensureAccumulator(width, height) {
    if (!this.starCount) return
    if (this.accWidth === width && this.accHeight === height) return

    this.disposeAccumulator()

    this.accWidth = width
    this.accHeight = height
    this.accSize = width * height

    this.accW.value = width
    this.accH.value = height

    this.accRSBA = new StorageBufferAttribute(new Uint32Array(this.accSize), 1, Uint32Array)
    this.accGSBA = new StorageBufferAttribute(new Uint32Array(this.accSize), 1, Uint32Array)
    this.accBSBA = new StorageBufferAttribute(new Uint32Array(this.accSize), 1, Uint32Array)

    this.accRBuf = storage(this.accRSBA, 'uint', this.accSize)
    this.accGBuf = storage(this.accGSBA, 'uint', this.accSize)
    this.accBBuf = storage(this.accBSBA, 'uint', this.accSize)

    this.buildClearCompute()
    this.buildSplatCompute()
    this.createCompositeQuad()
  }

  buildClearCompute() {
    this.clearAccumCompute = Fn(() => {
      const index = instanceIndex.toUint()
      const pixelCount = uint(this.accSize)

      If(index.greaterThanEqual(pixelCount), () => {
        Return()
      })

      this.accRBuf.element(index).assign(uint(0))
      this.accGBuf.element(index).assign(uint(0))
      this.accBBuf.element(index).assign(uint(0))
    })().compute(this.accSize)
  }

  buildSplatCompute() {
    this.splatCompute = Fn(() => {
      const index = instanceIndex.toUint()
      const starCount = uint(this.starCount)

      If(index.greaterThanEqual(starCount), () => {
        Return()
      })

      const accRAtomic = storage(this.accRSBA, 'uint', this.accSize).toAtomic()
      const accGAtomic = storage(this.accGSBA, 'uint', this.accSize).toAtomic()
      const accBAtomic = storage(this.accBSBA, 'uint', this.accSize).toAtomic()

      const direction = this.equatorialToLocalU
        .mul(vec4(this.directionBuf.element(index).xyz, 0))
        .xyz
        .normalize()
      const color = this.colorBuf.element(index).xyz
      const magnitude = this.magnitudeBuf.element(index)
      const cameraToPlanet = this.cameraPositionU.sub(this.planetCenterU).toVar()
      const halfB = dot(cameraToPlanet, direction).toVar()
      const c = dot(cameraToPlanet, cameraToPlanet)
        .sub(this.planetRadiusU.mul(this.planetRadiusU))
        .toVar()
      const discriminant = halfB.mul(halfB).sub(c).toVar()

      If(discriminant.greaterThanEqual(0).and(halfB.lessThan(0)), () => {
        Return()
      })

      // Stars are rendered as an infinite sky sphere: camera translation must not
      // affect their projection, only camera rotation.
      const positionView = direction.mul(this.starDistanceU)
      const clip = this.viewProjU.mul(vec4(positionView, 1))

      If(clip.w.lessThanEqual(0), () => {
        Return()
      })

      const ndc = clip.xyz.div(clip.w)
      const inFrustum = ndc.x.greaterThanEqual(-1)
        .and(ndc.x.lessThanEqual(1))
        .and(ndc.y.greaterThanEqual(-1))
        .and(ndc.y.lessThanEqual(1))
        .and(ndc.z.greaterThanEqual(0))
        .and(ndc.z.lessThanEqual(1))

      If(inFrustum, () => {
        const uv = ndc.xy.mul(0.5).add(0.5)
        const xPx = uv.x.mul(this.accW.toFloat())
        const yPx = uv.y.mul(this.accH.toFloat())

        // Apparent magnitude to relative flux. The remaining scale is a display exposure,
        // not a fake brightness curve.
        const flux = pow(float(10), magnitude.mul(-0.4))
        const contributionScale = flux
          .mul(this.starExposureU)
          .mul(this.fovBoostU)

        const normalizedMagnitude = magnitude
          .sub(this.minMagnitudeU)
          .div(this.maxMagnitudeU.sub(this.minMagnitudeU).max(0.0001))
          .clamp(0, 1)
        const radiusPx = this.starMaxScaleU
          .sub(this.starMaxScaleU.sub(this.starMinScaleU).mul(normalizedMagnitude))
          .clamp(0.1, 8)

        const fp = this.fpScaleU.toFloat()

        const splatKernel = (dx, dy) => {
          const ix = xPx.floor().add(float(dx))
          const iy = yPx.floor().add(float(dy))
          const sampleCenterX = ix.add(0.5)
          const sampleCenterY = iy.add(0.5)
          const deltaX = sampleCenterX.sub(xPx)
          const deltaY = sampleCenterY.sub(yPx)
          const inBounds = ix.greaterThanEqual(0)
            .and(ix.lessThan(this.accW.toFloat()))
            .and(iy.greaterThanEqual(0))
            .and(iy.lessThan(this.accH.toFloat()))

          If(inBounds, () => {
            const distancePx = deltaX.mul(deltaX).add(deltaY.mul(deltaY)).sqrt()

            If(distancePx.lessThanEqual(radiusPx), () => {
              const weight = float(1).sub(smoothstep(radiusPx.mul(0.7), radiusPx, distancePx))
              const pixelIndex = iy.toUint().mul(this.accW).add(ix.toUint())
              const contribution = contributionScale.mul(weight)

              atomicAdd(
                accRAtomic.element(pixelIndex),
                color.x.mul(contribution).mul(fp).toUint(),
              )
              atomicAdd(
                accGAtomic.element(pixelIndex),
                color.y.mul(contribution).mul(fp).toUint(),
              )
              atomicAdd(
                accBAtomic.element(pixelIndex),
                color.z.mul(contribution).mul(fp).toUint(),
              )
            })
          })
        }

        splatKernel(-3, -3)
        splatKernel(-2, -3)
        splatKernel(-1, -3)
        splatKernel(0, -3)
        splatKernel(1, -3)
        splatKernel(2, -3)
        splatKernel(3, -3)
        splatKernel(-3, -2)
        splatKernel(-2, -2)
        splatKernel(-1, -2)
        splatKernel(0, -2)
        splatKernel(1, -2)
        splatKernel(2, -2)
        splatKernel(3, -2)
        splatKernel(-3, -1)
        splatKernel(-2, -1)
        splatKernel(-1, -1)
        splatKernel(0, -1)
        splatKernel(1, -1)
        splatKernel(2, -1)
        splatKernel(3, -1)
        splatKernel(-3, 0)
        splatKernel(-2, 0)
        splatKernel(-1, 0)
        splatKernel(0, 0)
        splatKernel(1, 0)
        splatKernel(2, 0)
        splatKernel(3, 0)
        splatKernel(-3, 1)
        splatKernel(-2, 1)
        splatKernel(-1, 1)
        splatKernel(0, 1)
        splatKernel(1, 1)
        splatKernel(2, 1)
        splatKernel(3, 1)
        splatKernel(-3, 2)
        splatKernel(-2, 2)
        splatKernel(-1, 2)
        splatKernel(0, 2)
        splatKernel(1, 2)
        splatKernel(2, 2)
        splatKernel(3, 2)
        splatKernel(-3, 3)
        splatKernel(-2, 3)
        splatKernel(-1, 3)
        splatKernel(0, 3)
        splatKernel(1, 3)
        splatKernel(2, 3)
        splatKernel(3, 3)
      })
    })().compute(this.starCount)
  }

  createCompositeQuad() {
    this.overlayScene = new THREE.Scene()
    this.overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    const geometry = new THREE.PlaneGeometry(2, 2)
    const material = new MeshBasicNodeMaterial()

    material.colorNode = Fn(() => {
      const uv = positionLocal.xy.mul(0.5).add(0.5)
      const fx = uv.x.mul(this.accW.toFloat()).floor().clamp(0, this.accW.toFloat().sub(1))
      const fy = uv.y.mul(this.accH.toFloat()).floor().clamp(0, this.accH.toFloat().sub(1))
      const fxU = fx.toUint()
      const fyU = fy.toUint()
      const index = fyU.mul(this.accW).add(fxU)
      const pixelCoord = uvec2(fxU, this.accH.sub(uint(1)).sub(fyU))

      const r = float(this.accRBuf.element(index)).mul(this.invFpScale)
      const g = float(this.accGBuf.element(index)).mul(this.invFpScale)
      const b = float(this.accBBuf.element(index)).mul(this.invFpScale)
      const transmittance = this.transmittanceTextureNode.load(pixelCoord).rgb
      const occlusion = float(1)
        .sub(this.occlusionMaskTextureNode.load(pixelCoord).r.clamp(0, 1))
        .toVar()

      return vec4(vec3(r, g, b).mul(transmittance).mul(occlusion), 1)
    })()

    material.depthWrite = false
    material.depthTest = false
    material.transparent = true
    material.blending = THREE.AdditiveBlending
    material.toneMapped = false

    this.compositeQuad = new THREE.Mesh(geometry, material)
    this.compositeQuad.frustumCulled = false
    this.overlayScene.add(this.compositeQuad)
  }

  update(camera, sunAltitudeDeg) {
    camera.updateMatrixWorld(true)
    this.tmpViewRotationOnly.copy(camera.matrixWorldInverse)
    this.tmpViewRotationOnly.setPosition(0, 0, 0)
    this.tmpViewProj.multiplyMatrices(camera.projectionMatrix, this.tmpViewRotationOnly)
    this.viewProjU.value.copy(this.tmpViewProj)
    this.cameraPositionU.value.copy(camera.position)
    this.fovBoostU.value = computeFovBoost(camera.fov)
  }

  render(renderer, camera, sunAltitudeDeg, width = null, height = null) {
    if (!this.starCount) return

    const resolvedWidth = width ?? renderer.domElement.width
    const resolvedHeight = height ?? renderer.domElement.height
    if (resolvedWidth <= 0 || resolvedHeight <= 0) return

    this.ensureAccumulator(resolvedWidth, resolvedHeight)
    this.update(camera, sunAltitudeDeg)

    renderer.compute(this.clearAccumCompute)
    renderer.compute(this.splatCompute)

    if (this.overlayScene && this.overlayCamera) {
      renderer.render(this.overlayScene, this.overlayCamera)
    }
  }

  disposeAccumulator() {
    this.clearAccumCompute = null
    this.splatCompute = null
    this.accRSBA = null
    this.accGSBA = null
    this.accBSBA = null
    this.accRBuf = null
    this.accGBuf = null
    this.accBBuf = null
    this.accSize = 0
    this.accWidth = 0
    this.accHeight = 0

    if (this.compositeQuad) {
      this.compositeQuad.geometry.dispose()
      this.compositeQuad.material.dispose()
      this.compositeQuad = null
    }

    this.overlayScene = null
    this.overlayCamera = null
  }

  dispose() {
    this.disposeAccumulator()
    this.directionSBA = null
    this.colorSBA = null
    this.magnitudeSBA = null
    this.directionBuf = null
    this.colorBuf = null
    this.magnitudeBuf = null
    this.starCount = 0
  }
}
