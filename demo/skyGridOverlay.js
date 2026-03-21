import * as THREE from 'three'

const DEFAULT_RADIUS = 89.25
const DEFAULT_ALT_AZ_COLOR = 0x3fd3a6
const DEFAULT_RA_DEC_COLOR = 0xff9b54
const ALT_AZ_ALTITUDE_STEP_DEG = 15
const ALT_AZ_AZIMUTH_STEP_DEG = 15
const RA_DEC_DECLINATION_STEP_DEG = 15
const RA_DEC_RIGHT_ASCENSION_STEP_DEG = 15
const CIRCLE_SEGMENT_STEP_DEG = 4
const ARC_SEGMENT_STEP_DEG = 3

const createGridMaterial = (color) =>
  new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.52,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })

const localDirectionFromAltAz = (altitudeDeg, azimuthDeg, radius) => {
  const altitudeRad = THREE.MathUtils.degToRad(altitudeDeg)
  const azimuthRad = THREE.MathUtils.degToRad(azimuthDeg)
  const horizontal = Math.cos(altitudeRad) * radius
  return new THREE.Vector3(
    Math.sin(azimuthRad) * horizontal,
    Math.sin(altitudeRad) * radius,
    Math.cos(azimuthRad) * horizontal,
  )
}

const equatorialDirectionFromRaDec = (rightAscensionDeg, declinationDeg, radius) => {
  const raRad = THREE.MathUtils.degToRad(rightAscensionDeg)
  const decRad = THREE.MathUtils.degToRad(declinationDeg)
  const horizontal = Math.cos(decRad) * radius
  return new THREE.Vector3(
    Math.sin(raRad) * horizontal,
    Math.sin(decRad) * radius,
    Math.cos(raRad) * horizontal,
  )
}

const pushVisiblePolyline = (target, points, visibilityPredicate) => {
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    if (!visibilityPredicate(start) || !visibilityPredicate(end)) {
      continue
    }
    target.push(start.x, start.y, start.z, end.x, end.y, end.z)
  }
}

const buildAltAzGridGeometry = (radius) => {
  const positions = []
  const isVisible = (point) => point.y >= 0

  for (let altitudeDeg = 0; altitudeDeg < 90; altitudeDeg += ALT_AZ_ALTITUDE_STEP_DEG) {
    const points = []
    for (let azimuthDeg = 0; azimuthDeg <= 360; azimuthDeg += CIRCLE_SEGMENT_STEP_DEG) {
      points.push(localDirectionFromAltAz(altitudeDeg, azimuthDeg, radius))
    }
    pushVisiblePolyline(positions, points, isVisible)
  }

  for (let azimuthDeg = 0; azimuthDeg < 360; azimuthDeg += ALT_AZ_AZIMUTH_STEP_DEG) {
    const points = []
    for (let altitudeDeg = 0; altitudeDeg <= 90; altitudeDeg += ARC_SEGMENT_STEP_DEG) {
      points.push(localDirectionFromAltAz(altitudeDeg, azimuthDeg, radius))
    }
    pushVisiblePolyline(positions, points, isVisible)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geometry
}

const buildRaDecGridGeometry = (radius, equatorialToLocalQuaternion) => {
  const positions = []
  const transformedPoint = new THREE.Vector3()
  const isVisible = (point) => point.y >= 0

  for (
    let declinationDeg = -75;
    declinationDeg <= 75;
    declinationDeg += RA_DEC_DECLINATION_STEP_DEG
  ) {
    const points = []
    for (
      let rightAscensionDeg = 0;
      rightAscensionDeg <= 360;
      rightAscensionDeg += CIRCLE_SEGMENT_STEP_DEG
    ) {
      transformedPoint
        .copy(equatorialDirectionFromRaDec(rightAscensionDeg, declinationDeg, radius))
        .applyQuaternion(equatorialToLocalQuaternion)
      points.push(transformedPoint.clone())
    }
    pushVisiblePolyline(positions, points, isVisible)
  }

  for (
    let rightAscensionDeg = 0;
    rightAscensionDeg < 360;
    rightAscensionDeg += RA_DEC_RIGHT_ASCENSION_STEP_DEG
  ) {
    const points = []
    for (let declinationDeg = -90; declinationDeg <= 90; declinationDeg += ARC_SEGMENT_STEP_DEG) {
      transformedPoint
        .copy(equatorialDirectionFromRaDec(rightAscensionDeg, declinationDeg, radius))
        .applyQuaternion(equatorialToLocalQuaternion)
      points.push(transformedPoint.clone())
    }
    pushVisiblePolyline(positions, points, isVisible)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geometry
}

export class SkyGridOverlay {
  constructor({
    radius = DEFAULT_RADIUS,
    altAzColor = DEFAULT_ALT_AZ_COLOR,
    raDecColor = DEFAULT_RA_DEC_COLOR,
    equatorialToLocalQuaternion = new THREE.Quaternion(),
  } = {}) {
    this.root = new THREE.Group()
    this.root.renderOrder = -90

    this.altAzLines = new THREE.LineSegments(
      buildAltAzGridGeometry(radius),
      createGridMaterial(altAzColor),
    )
    this.altAzLines.renderOrder = -90
    this.altAzLines.frustumCulled = false
    this.root.add(this.altAzLines)

    this.raDecLines = new THREE.LineSegments(
      buildRaDecGridGeometry(radius, equatorialToLocalQuaternion),
      createGridMaterial(raDecColor),
    )
    this.raDecLines.renderOrder = -89
    this.raDecLines.frustumCulled = false
    this.root.add(this.raDecLines)

    this.setAltAzEnabled(false)
    this.setRaDecEnabled(false)
  }

  addToScene(scene) {
    scene.add(this.root)
  }

  setCameraPosition(position) {
    this.root.position.copy(position)
  }

  setAltAzEnabled(enabled) {
    this.altAzLines.visible = enabled
  }

  setRaDecEnabled(enabled) {
    this.raDecLines.visible = enabled
  }

  dispose() {
    this.altAzLines.geometry.dispose()
    this.altAzLines.material.dispose()
    this.raDecLines.geometry.dispose()
    this.raDecLines.material.dispose()
  }
}
