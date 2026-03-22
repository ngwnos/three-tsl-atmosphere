import * as THREE from 'three'

const EQUATORIAL_DIRECTION = new THREE.Vector3()
const LOCAL_DIRECTION = new THREE.Vector3()
const TWO_PI = Math.PI * 2
const J2000_EPOCH_MS = Date.UTC(2000, 0, 1, 12, 0, 0, 0)

const normalizeAngleDeg = (angleDeg) => {
  const wrapped = angleDeg % 360
  return wrapped < 0 ? wrapped + 360 : wrapped
}

const dateToJulianDay = (date) => date.getTime() / 86400000 + 2440587.5

const getJulianCentury = (julianDay) => (julianDay - 2451545.0) / 36525

export const computeGreenwichSiderealAngleDeg = (date) => {
  const julianDay = dateToJulianDay(date)
  const julianCentury = getJulianCentury(julianDay)
  const gmstDeg =
    280.46061837 +
    360.98564736629 * (julianDay - 2451545.0) +
    0.000387933 * julianCentury * julianCentury -
    (julianCentury * julianCentury * julianCentury) / 38710000

  return normalizeAngleDeg(gmstDeg)
}

export const computeLocalSiderealAngleDeg = (date, longitudeDeg) =>
  normalizeAngleDeg(computeGreenwichSiderealAngleDeg(date) + longitudeDeg)

export const makeEquatorialToLocalMatrix = (
  date,
  latitudeDeg,
  longitudeDeg,
  target = new THREE.Matrix4(),
) => {
  const latitudeRad = THREE.MathUtils.degToRad(latitudeDeg)
  const localSiderealRad = THREE.MathUtils.degToRad(
    computeLocalSiderealAngleDeg(date, longitudeDeg),
  )
  const sinLatitude = Math.sin(latitudeRad)
  const cosLatitude = Math.cos(latitudeRad)
  const sinSidereal = Math.sin(localSiderealRad)
  const cosSidereal = Math.cos(localSiderealRad)

  return target.set(
    cosSidereal,
    0,
    -sinSidereal,
    0,
    sinSidereal * cosLatitude,
    sinLatitude,
    cosSidereal * cosLatitude,
    0,
    -sinSidereal * sinLatitude,
    cosLatitude,
    -cosSidereal * sinLatitude,
    0,
    0,
    0,
    0,
    1,
  )
}

export const equatorialDirectionFromRaDec = (rightAscensionDeg, declinationDeg, radius = 1) => {
  const rightAscensionRad = THREE.MathUtils.degToRad(rightAscensionDeg)
  const declinationRad = THREE.MathUtils.degToRad(declinationDeg)
  const horizontal = Math.cos(declinationRad) * radius

  return EQUATORIAL_DIRECTION.set(
    Math.sin(rightAscensionRad) * horizontal,
    Math.sin(declinationRad) * radius,
    Math.cos(rightAscensionRad) * horizontal,
  )
}

export const localDirectionToAltAz = (direction) => ({
  altitudeDeg: THREE.MathUtils.radToDeg(
    Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1)),
  ),
  azimuthDeg: THREE.MathUtils.radToDeg(Math.atan2(direction.x, direction.z)),
})

export const computeSunEquatorialCoordinates = (date) => {
  const julianDay = dateToJulianDay(date)
  const julianCentury = getJulianCentury(julianDay)
  const geomMeanLongitudeDeg = normalizeAngleDeg(
    280.46646 + julianCentury * (36000.76983 + 0.0003032 * julianCentury),
  )
  const geomMeanAnomalyDeg =
    357.52911 + julianCentury * (35999.05029 - 0.0001537 * julianCentury)
  const geomMeanAnomalyRad = THREE.MathUtils.degToRad(geomMeanAnomalyDeg)
  const sunEquationOfCenterDeg =
    Math.sin(geomMeanAnomalyRad) *
      (1.914602 - julianCentury * (0.004817 + 0.000014 * julianCentury)) +
    Math.sin(2 * geomMeanAnomalyRad) * (0.019993 - 0.000101 * julianCentury) +
    Math.sin(3 * geomMeanAnomalyRad) * 0.000289
  const sunTrueLongitudeDeg = geomMeanLongitudeDeg + sunEquationOfCenterDeg
  const omegaDeg = 125.04 - 1934.136 * julianCentury
  const sunApparentLongitudeDeg =
    sunTrueLongitudeDeg -
    0.00569 -
    0.00478 * Math.sin(THREE.MathUtils.degToRad(omegaDeg))
  const meanObliquityDeg =
    23 +
    (26 +
      (21.448 -
        julianCentury *
          (46.815 +
            julianCentury * (0.00059 - julianCentury * 0.001813))) /
        60) /
      60
  const obliquityCorrectionDeg =
    meanObliquityDeg + 0.00256 * Math.cos(THREE.MathUtils.degToRad(omegaDeg))
  const apparentLongitudeRad = THREE.MathUtils.degToRad(sunApparentLongitudeDeg)
  const obliquityCorrectionRad = THREE.MathUtils.degToRad(obliquityCorrectionDeg)
  const rightAscensionDeg = normalizeAngleDeg(
    THREE.MathUtils.radToDeg(
      Math.atan2(
        Math.cos(obliquityCorrectionRad) * Math.sin(apparentLongitudeRad),
        Math.cos(apparentLongitudeRad),
      ),
    ),
  )
  const declinationDeg = THREE.MathUtils.radToDeg(
    Math.asin(
      Math.sin(obliquityCorrectionRad) * Math.sin(apparentLongitudeRad),
    ),
  )

  return {
    rightAscensionDeg,
    declinationDeg,
  }
}

export const computeSunLocalAltAz = (
  date,
  equatorialToLocalMatrix,
) => {
  const { rightAscensionDeg, declinationDeg } = computeSunEquatorialCoordinates(date)
  const localDirection = LOCAL_DIRECTION.copy(
    equatorialDirectionFromRaDec(rightAscensionDeg, declinationDeg, 1),
  ).applyMatrix4(equatorialToLocalMatrix).normalize()

  return {
    ...localDirectionToAltAz(localDirection),
    rightAscensionDeg,
    declinationDeg,
  }
}

const wrapAngleRad = (angleRad) => {
  const wrapped = angleRad % TWO_PI
  return wrapped < 0 ? wrapped + TWO_PI : wrapped
}

const solveKeplerEccentricAnomaly = (meanAnomalyRad, eccentricity) => {
  let eccentricAnomaly = eccentricity < 0.8 ? meanAnomalyRad : Math.PI
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const f = eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomalyRad
    const fPrime = 1 - eccentricity * Math.cos(eccentricAnomaly)
    eccentricAnomaly -= f / Math.max(1e-8, fPrime)
  }
  return eccentricAnomaly
}

export const computeKeplerOrbitPosition = (
  date,
  orbit,
  target = new THREE.Vector3(),
) => {
  const semiMajorAxisM = Math.max(1, orbit.semiMajorAxisM)
  const eccentricity = THREE.MathUtils.clamp(orbit.eccentricity ?? 0, 0, 0.999)
  const inclinationRad = THREE.MathUtils.degToRad(orbit.inclinationDeg ?? 0)
  const ascendingNodeRad = THREE.MathUtils.degToRad(
    orbit.longitudeOfAscendingNodeDeg ?? 0,
  )
  const argumentOfPeriapsisRad = THREE.MathUtils.degToRad(
    orbit.argumentOfPeriapsisDeg ?? 0,
  )
  const meanAnomalyAtEpochRad = THREE.MathUtils.degToRad(
    orbit.meanAnomalyAtEpochDeg ?? 0,
  )
  const referencePlaneTiltRad = THREE.MathUtils.degToRad(
    orbit.referencePlaneTiltDeg ?? 0,
  )
  const epochMs = Number.isFinite(orbit.epochMs) ? orbit.epochMs : J2000_EPOCH_MS
  const orbitalPeriodSeconds = Math.max(1, orbit.orbitalPeriodSeconds)
  const elapsedSeconds = (date.getTime() - epochMs) / 1000
  const meanMotionRadPerSecond = TWO_PI / orbitalPeriodSeconds
  const meanAnomalyRad = wrapAngleRad(
    meanAnomalyAtEpochRad + elapsedSeconds * meanMotionRadPerSecond,
  )
  const eccentricAnomalyRad = solveKeplerEccentricAnomaly(meanAnomalyRad, eccentricity)
  const cosE = Math.cos(eccentricAnomalyRad)
  const sinE = Math.sin(eccentricAnomalyRad)
  const orbitalRadiusM = semiMajorAxisM * (1 - eccentricity * cosE)
  const orbitalPlaneX = semiMajorAxisM * (cosE - eccentricity)
  const orbitalPlaneY =
    semiMajorAxisM * Math.sqrt(Math.max(0, 1 - eccentricity * eccentricity)) * sinE
  const trueAnomalyRad = Math.atan2(orbitalPlaneY, orbitalPlaneX)
  const argumentOfLatitudeRad = argumentOfPeriapsisRad + trueAnomalyRad

  const cosNode = Math.cos(ascendingNodeRad)
  const sinNode = Math.sin(ascendingNodeRad)
  const cosInclination = Math.cos(inclinationRad)
  const sinInclination = Math.sin(inclinationRad)
  const cosArgument = Math.cos(argumentOfLatitudeRad)
  const sinArgument = Math.sin(argumentOfLatitudeRad)

  let xStandard =
    orbitalRadiusM *
    (cosNode * cosArgument - sinNode * sinArgument * cosInclination)
  let yStandard =
    orbitalRadiusM *
    (sinNode * cosArgument + cosNode * sinArgument * cosInclination)
  let zStandard = orbitalRadiusM * sinArgument * sinInclination

  if (referencePlaneTiltRad !== 0) {
    const cosTilt = Math.cos(referencePlaneTiltRad)
    const sinTilt = Math.sin(referencePlaneTiltRad)
    const tiltedY = yStandard * cosTilt - zStandard * sinTilt
    const tiltedZ = yStandard * sinTilt + zStandard * cosTilt
    yStandard = tiltedY
    zStandard = tiltedZ
  }

  return target.set(yStandard, zStandard, xStandard)
}
