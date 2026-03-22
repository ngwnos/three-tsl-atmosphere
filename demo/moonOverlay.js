import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  Fn,
  If,
  dot,
  float,
  fwidth,
  max,
  normalize,
  smoothstep,
  sqrt,
  texture,
  uniform,
  uvec2,
  vec2,
  vec3,
  vec4,
  viewportCoordinate,
} from 'three/tsl'

import { computeKeplerOrbitPosition } from './astronomy.js'

const DEFAULT_MAX_MOONS = 16
const DEFAULT_EXPOSURE = 1
const DEFAULT_DISPLAY_DISTANCE = 90
const MOON_VISIBILITY_EPSILON = 1e-5

const projectMoonToPixelRadius = (
  camera,
  viewDirection,
  displayDistance,
  angularRadiusRad,
  width,
  height,
  targetRight = new THREE.Vector3(),
  targetUp = new THREE.Vector3(),
  scratchEdge = new THREE.Vector3(),
) => {
  targetUp.set(0, 1, 0).applyQuaternion(camera.quaternion)
  targetUp.addScaledVector(viewDirection, -targetUp.dot(viewDirection))
  if (targetUp.lengthSq() <= 1e-8) {
    targetUp.set(1, 0, 0).applyQuaternion(camera.quaternion)
    targetUp.addScaledVector(viewDirection, -targetUp.dot(viewDirection))
  }
  targetUp.normalize()
  targetRight.crossVectors(viewDirection, targetUp).normalize()

  const edgeDirection = scratchEdge
    .copy(viewDirection)
    .multiplyScalar(Math.cos(angularRadiusRad))
    .addScaledVector(targetRight, Math.sin(angularRadiusRad))
    .normalize()
  const edgeNdc = camera.position
    .clone()
    .addScaledVector(edgeDirection, displayDistance)
    .project(camera)
  const centerNdc = camera.position
    .clone()
    .addScaledVector(viewDirection, displayDistance)
    .project(camera)

  const deltaXPx = (edgeNdc.x - centerNdc.x) * width * 0.5
  const deltaYPx = (edgeNdc.y - centerNdc.y) * height * 0.5
  return Math.hypot(deltaXPx, deltaYPx)
}

const createMoonSelectionNode = (moonStates, transmittanceTextureNode) =>
  Fn(() => {
    const pixelCoord = viewportCoordinate.toVar()
    const pixelCoordU = uvec2(pixelCoord).toVar()
    const transmittance = transmittanceTextureNode.load(pixelCoordU).rgb.toVar()
    const transmittanceMagnitude = transmittance.x
      .add(transmittance.y)
      .add(transmittance.z)
      .toVar()
    const bestDistance = float(1e20).toVar()
    const bestContribution = vec3(0, 0, 0).toVar()
    const bestMask = float(0).toVar()

    for (const moonState of moonStates) {
      If(moonState.active.greaterThan(0.5), () => {
        const radiusPx = moonState.centerRadiusDistance.z.max(float(1e-4)).toVar()
        const discUv = vec2(
          pixelCoord.x.sub(moonState.centerRadiusDistance.x),
          moonState.centerRadiusDistance.y.sub(pixelCoord.y),
        )
          .div(vec2(radiusPx, radiusPx))
          .toVar()
        const discRadiusSquared = dot(discUv, discUv).toVar()
        const edgeWidth = fwidth(discRadiusSquared).max(float(1e-4)).mul(1.5).toVar()
        const discMask = smoothstep(
          float(1).add(edgeWidth),
          float(1).sub(edgeWidth),
          discRadiusSquared,
        ).toVar()

        If(
          discMask.greaterThan(float(1e-4)).and(
            transmittanceMagnitude.greaterThan(float(MOON_VISIBILITY_EPSILON)),
          ),
          () => {
            If(moonState.centerRadiusDistance.w.lessThan(bestDistance), () => {
              const normalZ = sqrt(float(1).sub(discRadiusSquared).max(float(0))).toVar()
              const normalLocal = vec3(discUv.x, discUv.y, normalZ).toVar()
              const lambert = max(
                dot(normalLocal, normalize(moonState.lightLocal)),
                float(0),
              ).toVar()

              bestDistance.assign(moonState.centerRadiusDistance.w)
              bestContribution.assign(moonState.color.mul(lambert).mul(discMask))
              bestMask.assign(discMask)
            })
          },
        )
      })
    }

    return vec4(bestContribution.mul(transmittance), bestMask)
  })()

const createMoonColorMaterial = (moonStates, transmittanceTextureNode) => {
  const material = new MeshBasicNodeMaterial()
  const moonSelection = createMoonSelectionNode(moonStates, transmittanceTextureNode)
  material.outputNode = Fn(() => {
    const moon = moonSelection.toVar()
    return vec4(moon.rgb, float(1))
  })()
  material.depthTest = false
  material.depthWrite = false
  material.transparent = true
  material.blending = THREE.AdditiveBlending
  material.toneMapped = false
  return material
}

const createMoonMaskMaterial = (moonStates, transmittanceTextureNode) => {
  const material = new MeshBasicNodeMaterial()
  const moonSelection = createMoonSelectionNode(moonStates, transmittanceTextureNode)
  material.outputNode = Fn(() => {
    const moon = moonSelection.toVar()
    return vec4(vec3(moon.a), float(1))
  })()
  material.depthTest = false
  material.depthWrite = false
  material.transparent = false
  material.toneMapped = false
  return material
}

export class MoonOverlay {
  constructor(options = {}) {
    this.maxMoons = Math.max(1, Math.floor(options.maxMoons ?? DEFAULT_MAX_MOONS))
    this.overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this.colorScene = new THREE.Scene()
    this.maskScene = new THREE.Scene()
    this.planetCenter = new THREE.Vector3()
    this.planetRadius = 1
    this.equatorialToLocal = new THREE.Matrix4()
    this.solarIrradiance = new THREE.Vector3(1, 1, 1)
    this.sunWorldPosition = new THREE.Vector3(0, 1, 0)
    this.exposure = DEFAULT_EXPOSURE
    this.sizeScale = 1
    this.displayDistance = Math.max(1, options.displayDistance ?? DEFAULT_DISPLAY_DISTANCE)
    this.moons = []
    this.transmittanceTextureNode = texture(new THREE.Texture())
    this.moonStates = Array.from({ length: this.maxMoons }, () => ({
      active: uniform(0),
      centerRadiusDistance: uniform(new THREE.Vector4(0, 0, 0, 0)),
      color: uniform(new THREE.Vector3(0, 0, 0)),
      lightLocal: uniform(new THREE.Vector3(0, 0, 1)),
    }))

    this.tmpMoonPositionEquatorial = new THREE.Vector3()
    this.tmpMoonPositionLocal = new THREE.Vector3()
    this.tmpMoonPositionWorld = new THREE.Vector3()
    this.tmpViewVector = new THREE.Vector3()
    this.tmpSunDirection = new THREE.Vector3()
    this.tmpViewDirection = new THREE.Vector3()
    this.tmpMoonToCamera = new THREE.Vector3()
    this.tmpMoonColor = new THREE.Color()
    this.tmpMoonColorVector = new THREE.Vector3()
    this.tmpProjectedCenter = new THREE.Vector3()
    this.tmpProjectedWorld = new THREE.Vector3()
    this.tmpRight = new THREE.Vector3()
    this.tmpUp = new THREE.Vector3()
    this.tmpEdge = new THREE.Vector3()

    this.sharedGeometry = new THREE.PlaneGeometry(2, 2)
    this.colorQuad = new THREE.Mesh(
      this.sharedGeometry,
      createMoonColorMaterial(this.moonStates, this.transmittanceTextureNode),
    )
    this.colorQuad.frustumCulled = false
    this.colorScene.add(this.colorQuad)

    this.maskQuad = new THREE.Mesh(
      this.sharedGeometry,
      createMoonMaskMaterial(this.moonStates, this.transmittanceTextureNode),
    )
    this.maskQuad.frustumCulled = false
    this.maskScene.add(this.maskQuad)
  }

  setMoons(moons) {
    this.moons = Array.isArray(moons) ? moons.slice(0, this.maxMoons) : []
  }

  setPlanet(center, radius) {
    this.planetCenter.copy(center)
    this.planetRadius = Math.max(0, radius)
  }

  setEquatorialToLocal(matrix) {
    this.equatorialToLocal.copy(matrix)
  }

  setSunPosition(position) {
    this.sunWorldPosition.copy(position)
  }

  setSolarIrradiance(irradiance) {
    this.solarIrradiance.copy(irradiance)
  }

  setExposure(exposure) {
    this.exposure = Math.max(0, exposure)
  }

  setSizeScale(scale) {
    this.sizeScale = Math.max(0.01, scale)
  }

  setTransmittanceTexture(textureValue) {
    this.transmittanceTextureNode.value = textureValue ?? new THREE.Texture()
  }

  updateMoonState(moonState, moon, camera, date, width, height) {
    computeKeplerOrbitPosition(date, moon.orbit, this.tmpMoonPositionEquatorial)
    this.tmpMoonPositionLocal
      .copy(this.tmpMoonPositionEquatorial)
      .applyMatrix4(this.equatorialToLocal)
    this.tmpMoonPositionWorld.copy(this.planetCenter).add(this.tmpMoonPositionLocal)

    this.tmpViewVector.copy(this.tmpMoonPositionWorld).sub(camera.position)
    const distanceMeters = this.tmpViewVector.length()
    if (distanceMeters <= Math.max(1, moon.radiusM)) {
      moonState.active.value = 0
      return
    }

    this.tmpViewDirection.copy(this.tmpViewVector).divideScalar(distanceMeters)
    this.tmpProjectedWorld
      .copy(camera.position)
      .addScaledVector(this.tmpViewDirection, this.displayDistance)
    this.tmpProjectedCenter.copy(this.tmpProjectedWorld).project(camera)

    if (this.tmpProjectedCenter.z <= 0 || this.tmpProjectedCenter.z >= 1) {
      moonState.active.value = 0
      return
    }

    const angularRadiusRad = Math.asin(
      THREE.MathUtils.clamp((moon.radiusM * this.sizeScale) / distanceMeters, 1e-8, 0.999999),
    )
    const radiusPx = projectMoonToPixelRadius(
      camera,
      this.tmpViewDirection,
      this.displayDistance,
      angularRadiusRad,
      width,
      height,
      this.tmpRight,
      this.tmpUp,
      this.tmpEdge,
    )
    if (!Number.isFinite(radiusPx) || radiusPx <= 1e-4) {
      moonState.active.value = 0
      return
    }

    const centerXPx = (this.tmpProjectedCenter.x * 0.5 + 0.5) * width
    const centerYPx = (0.5 - this.tmpProjectedCenter.y * 0.5) * height
    if (
      centerXPx + radiusPx < 0 ||
      centerXPx - radiusPx > width ||
      centerYPx + radiusPx < 0 ||
      centerYPx - radiusPx > height
    ) {
      moonState.active.value = 0
      return
    }

    this.tmpMoonColor
      .set(moon.reflectanceColor ?? 0xffffff)
      .multiplyScalar(Math.max(0, moon.albedo ?? 0.12))
    this.tmpMoonColorVector.set(
      (this.tmpMoonColor.r * this.solarIrradiance.x * this.exposure) / Math.PI,
      (this.tmpMoonColor.g * this.solarIrradiance.y * this.exposure) / Math.PI,
      (this.tmpMoonColor.b * this.solarIrradiance.z * this.exposure) / Math.PI,
    )

    const moonToSun = this.tmpSunDirection
      .copy(this.sunWorldPosition)
      .sub(this.tmpMoonPositionWorld)
      .normalize()
    const moonToCamera = this.tmpMoonToCamera.copy(this.tmpViewDirection).negate()
    const upProjection = moonToSun.dot(this.tmpUp)
    const rightProjection = moonToSun.dot(this.tmpRight)
    const forwardProjection = moonToSun.dot(moonToCamera)

    moonState.active.value = 1
    moonState.centerRadiusDistance.value.set(centerXPx, centerYPx, radiusPx, distanceMeters)
    moonState.color.value.copy(this.tmpMoonColorVector)
    moonState.lightLocal.value.set(rightProjection, upProjection, forwardProjection)
  }

  update(camera, date, width, height) {
    camera.updateMatrixWorld(true)
    for (let index = 0; index < this.maxMoons; index += 1) {
      const moonState = this.moonStates[index]
      const moon = this.moons[index]
      if (!moon) {
        moonState.active.value = 0
        continue
      }
      this.updateMoonState(moonState, moon, camera, date, width, height)
    }
  }

  renderContribution(renderer) {
    if (this.moons.length === 0) {
      return
    }

    renderer.render(this.colorScene, this.overlayCamera)
  }

  renderMask(renderer) {
    if (this.moons.length === 0) {
      return
    }

    renderer.render(this.maskScene, this.overlayCamera)
  }

  dispose() {
    this.colorQuad.material.dispose()
    this.maskQuad.material.dispose()
    this.colorScene.remove(this.colorQuad)
    this.maskScene.remove(this.maskQuad)
    this.sharedGeometry.dispose()
  }
}
