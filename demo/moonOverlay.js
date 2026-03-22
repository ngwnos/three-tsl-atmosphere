import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  dot,
  float,
  fwidth,
  max,
  normalize,
  smoothstep,
  sqrt,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

import { computeKeplerOrbitPosition } from './astronomy.js'

const DEFAULT_MAX_MOONS = 16
const DEFAULT_EXPOSURE = 1
const ZERO_VECTOR = new THREE.Vector3(0, 0, 0)

const createMoonMaterial = () => {
  const moonColor = uniform(new THREE.Vector3(1, 1, 1))
  const lightLocal = uniform(new THREE.Vector3(0, 0, 1))

  const material = new MeshBasicNodeMaterial()
  material.outputNode = (() => {
    const discUv = uv().mul(2).sub(vec2(1, 1)).toVar()
    const discRadiusSquared = dot(discUv, discUv).toVar()
    const edgeWidth = fwidth(discRadiusSquared).max(float(1e-4)).mul(1.5).toVar()
    const discMask = smoothstep(
      float(1).add(edgeWidth),
      float(1).sub(edgeWidth),
      discRadiusSquared,
    ).toVar()
    const normalZ = sqrt(float(1).sub(discRadiusSquared).max(float(0))).toVar()
    const normalLocal = vec3(discUv.x, discUv.y, normalZ).toVar()
    const lambert = max(dot(normalLocal, normalize(lightLocal)), float(0)).toVar()
    return vec4(moonColor.mul(lambert), discMask)
  })()
  material.transparent = true
  material.depthTest = false
  material.depthWrite = false
  material.toneMapped = false

  return {
    material,
    moonColor,
    lightLocal,
  }
}

const segmentIntersectsSphere = (start, end, center, radius) => {
  const direction = end.clone().sub(start)
  const offset = start.clone().sub(center)
  const a = direction.lengthSq()
  const b = 2 * offset.dot(direction)
  const c = offset.lengthSq() - radius * radius
  const discriminant = b * b - 4 * a * c

  if (discriminant < 0 || a <= 1e-8) {
    return false
  }

  const sqrtDiscriminant = Math.sqrt(discriminant)
  const inverseDenominator = 0.5 / a
  const t0 = (-b - sqrtDiscriminant) * inverseDenominator
  const t1 = (-b + sqrtDiscriminant) * inverseDenominator
  return (t0 > 0 && t0 < 1) || (t1 > 0 && t1 < 1)
}

const projectMoonToNdcRadius = (
  camera,
  viewDirection,
  distanceMeters,
  angularRadiusRad,
  centerNdc,
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
    .addScaledVector(edgeDirection, distanceMeters)
    .project(camera)

  return Math.hypot(edgeNdc.x - centerNdc.x, edgeNdc.y - centerNdc.y)
}

export class MoonOverlay {
  constructor(options = {}) {
    this.maxMoons = Math.max(1, Math.floor(options.maxMoons ?? DEFAULT_MAX_MOONS))
    this.overlayScene = new THREE.Scene()
    this.overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this.planetCenter = new THREE.Vector3()
    this.planetRadius = 1
    this.equatorialToLocal = new THREE.Matrix4()
    this.solarIrradiance = new THREE.Vector3(1, 1, 1)
    this.sunDirection = new THREE.Vector3(0, 1, 0)
    this.exposure = DEFAULT_EXPOSURE
    this.moons = []
    this.moonQuads = []

    this.tmpMoonPositionEquatorial = new THREE.Vector3()
    this.tmpMoonPositionLocal = new THREE.Vector3()
    this.tmpMoonPositionWorld = new THREE.Vector3()
    this.tmpViewVector = new THREE.Vector3()
    this.tmpSunDirection = new THREE.Vector3()
    this.tmpViewDirection = new THREE.Vector3()
    this.tmpMoonColor = new THREE.Color()
    this.tmpMoonColorVector = new THREE.Vector3()
    this.tmpProjectedCenter = new THREE.Vector3()
    this.tmpRight = new THREE.Vector3()
    this.tmpUp = new THREE.Vector3()
    this.tmpEdge = new THREE.Vector3()

    this.sharedGeometry = new THREE.PlaneGeometry(1, 1)

    for (let index = 0; index < this.maxMoons; index += 1) {
      const materialState = createMoonMaterial()
      const quad = new THREE.Mesh(this.sharedGeometry, materialState.material)
      quad.visible = false
      quad.frustumCulled = false
      this.overlayScene.add(quad)
      this.moonQuads.push({
        quad,
        moonColor: materialState.moonColor,
        lightLocal: materialState.lightLocal,
      })
    }
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

  setSunDirection(direction) {
    this.sunDirection.copy(direction).normalize()
  }

  setSolarIrradiance(irradiance) {
    this.solarIrradiance.copy(irradiance)
  }

  setExposure(exposure) {
    this.exposure = Math.max(0, exposure)
  }

  updateMoonQuad(quadState, moon, camera, date) {
    computeKeplerOrbitPosition(date, moon.orbit, this.tmpMoonPositionEquatorial)
    this.tmpMoonPositionLocal
      .copy(this.tmpMoonPositionEquatorial)
      .applyMatrix4(this.equatorialToLocal)
    this.tmpMoonPositionWorld.copy(this.planetCenter).add(this.tmpMoonPositionLocal)

    if (
      segmentIntersectsSphere(
        camera.position,
        this.tmpMoonPositionWorld,
        this.planetCenter,
        this.planetRadius,
      )
    ) {
      quadState.quad.visible = false
      return
    }

    this.tmpViewVector.copy(this.tmpMoonPositionWorld).sub(camera.position)
    const distanceMeters = this.tmpViewVector.length()
    if (distanceMeters <= Math.max(1, moon.radiusM)) {
      quadState.quad.visible = false
      return
    }

    this.tmpViewDirection.copy(this.tmpViewVector).divideScalar(distanceMeters)
    this.tmpProjectedCenter.copy(this.tmpMoonPositionWorld).project(camera)

    if (
      this.tmpProjectedCenter.z <= 0 ||
      this.tmpProjectedCenter.z >= 1 ||
      this.tmpProjectedCenter.x < -1.2 ||
      this.tmpProjectedCenter.x > 1.2 ||
      this.tmpProjectedCenter.y < -1.2 ||
      this.tmpProjectedCenter.y > 1.2
    ) {
      quadState.quad.visible = false
      return
    }

    const angularRadiusRad = Math.asin(
      THREE.MathUtils.clamp(moon.radiusM / distanceMeters, 1e-8, 0.999999),
    )
    const radiusNdc = projectMoonToNdcRadius(
      camera,
      this.tmpViewDirection,
      distanceMeters,
      angularRadiusRad,
      this.tmpProjectedCenter,
      this.tmpRight,
      this.tmpUp,
      this.tmpEdge,
    )
    if (!Number.isFinite(radiusNdc) || radiusNdc <= 1e-6) {
      quadState.quad.visible = false
      return
    }

    this.tmpMoonColor
      .set(moon.reflectanceColor ?? 0xffffff)
      .multiplyScalar(Math.max(0, moon.albedo ?? 0.12))
    this.tmpMoonColorVector.set(
      this.tmpMoonColor.r * this.solarIrradiance.x * this.exposure / Math.PI,
      this.tmpMoonColor.g * this.solarIrradiance.y * this.exposure / Math.PI,
      this.tmpMoonColor.b * this.solarIrradiance.z * this.exposure / Math.PI,
    )

    const sunDirectionLocal = this.tmpSunDirection.copy(this.sunDirection)
    const upProjection = sunDirectionLocal.dot(this.tmpUp)
    const rightProjection = sunDirectionLocal.dot(this.tmpRight)
    const forwardProjection = sunDirectionLocal.dot(this.tmpViewDirection)

    quadState.moonColor.value.copy(this.tmpMoonColorVector)
    quadState.lightLocal.value.set(rightProjection, upProjection, forwardProjection)

    quadState.quad.visible = true
    quadState.quad.position.set(this.tmpProjectedCenter.x, this.tmpProjectedCenter.y, 0)
    quadState.quad.scale.set(radiusNdc * 2, radiusNdc * 2, 1)
  }

  update(camera, date) {
    camera.updateMatrixWorld(true)
    for (let index = 0; index < this.maxMoons; index += 1) {
      const quadState = this.moonQuads[index]
      const moon = this.moons[index]
      if (!moon) {
        quadState.quad.visible = false
        continue
      }
      this.updateMoonQuad(quadState, moon, camera, date)
    }
  }

  render(renderer, camera, date) {
    if (this.moons.length === 0) {
      return
    }

    this.update(camera, date)
    renderer.render(this.overlayScene, this.overlayCamera)
  }

  dispose() {
    for (const quadState of this.moonQuads) {
      quadState.quad.material.dispose()
      this.overlayScene.remove(quadState.quad)
    }
    this.sharedGeometry.dispose()
  }
}
