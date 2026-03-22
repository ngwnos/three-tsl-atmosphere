import * as THREE from 'three'

export const DEFAULT_MOON_HEIGHT_ATLAS_LAYOUT = {
  columns: 4,
  rows: 4,
  tileWidth: 64,
  tileHeight: 32,
}

const clamp01 = (value) => Math.min(1, Math.max(0, value))

const lerp = (a, b, t) => a + (b - a) * t

const smoothstep = (t) => t * t * (3 - 2 * t)

const wrapIndex = (value, modulus) => {
  const wrapped = value % modulus
  return wrapped < 0 ? wrapped + modulus : wrapped
}

const hashGrid = (x, y) => {
  const wrappedX = wrapIndex(x, 4096)
  const wrappedY = wrapIndex(y, 4096)
  const seed =
    Math.imul(wrappedX ^ 0x9e3779b9, 0x85ebca6b) ^
    Math.imul(wrappedY ^ 0xc2b2ae35, 0x27d4eb2f)
  const mixed = (seed ^ (seed >>> 15)) >>> 0
  return mixed / 0xffffffff
}

const periodicValueNoise = (u, v, frequency, periodX, periodY) => {
  const x = u * frequency
  const y = v * frequency
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = smoothstep(x - x0)
  const ty = smoothstep(y - y0)
  const sample = (ix, iy) =>
    hashGrid(wrapIndex(ix, periodX), wrapIndex(iy, periodY))

  const v00 = sample(x0, y0)
  const v10 = sample(x0 + 1, y0)
  const v01 = sample(x0, y0 + 1)
  const v11 = sample(x0 + 1, y0 + 1)
  const nx0 = lerp(v00, v10, tx)
  const nx1 = lerp(v01, v11, tx)
  return lerp(nx0, nx1, ty)
}

const sampleProceduralMoonHeight = (u, v) => {
  let amplitude = 1
  let frequency = 4
  let total = 0
  let weight = 0

  for (let octave = 0; octave < 5; octave += 1) {
    total +=
      (periodicValueNoise(u, v, frequency, frequency, frequency) * 2 - 1) * amplitude
    weight += amplitude
    amplitude *= 0.5
    frequency *= 2
  }

  const ridgeBase = 1 - Math.abs(total / Math.max(1e-6, weight))
  const ridge = ridgeBase * ridgeBase
  const latitudeFade = Math.pow(Math.cos((v - 0.5) * Math.PI), 0.35)
  return clamp01(0.5 + (ridge - 0.45) * 0.85 * latitudeFade)
}

const fillTile = (data, atlasWidth, atlasHeight, tileX, tileY, tileWidth, tileHeight, sampler) => {
  for (let y = 0; y < tileHeight; y += 1) {
    for (let x = 0; x < tileWidth; x += 1) {
      const u = x / Math.max(1, tileWidth - 1)
      const v = y / Math.max(1, tileHeight - 1)
      const value = Math.round(clamp01(sampler(u, v)) * 255)
      const atlasX = tileX * tileWidth + x
      const atlasY = tileY * tileHeight + y
      const pixelIndex = (atlasY * atlasWidth + atlasX) * 4
      data[pixelIndex + 0] = value
      data[pixelIndex + 1] = value
      data[pixelIndex + 2] = value
      data[pixelIndex + 3] = 255
    }
  }
}

export const createGeneratedMoonHeightAtlas = (
  entries,
  layout = DEFAULT_MOON_HEIGHT_ATLAS_LAYOUT,
) => {
  const columns = Math.max(1, Math.floor(layout.columns))
  const rows = Math.max(1, Math.floor(layout.rows))
  const tileWidth = Math.max(2, Math.floor(layout.tileWidth))
  const tileHeight = Math.max(2, Math.floor(layout.tileHeight))
  const atlasWidth = columns * tileWidth
  const atlasHeight = rows * tileHeight
  const data = new Uint8Array(atlasWidth * atlasHeight * 4)
  const rects = new Map()

  entries.slice(0, columns * rows).forEach((entry, index) => {
    const tileX = index % columns
    const tileY = Math.floor(index / columns)
    const sampler = entry?.sampler ?? sampleProceduralMoonHeight
    fillTile(data, atlasWidth, atlasHeight, tileX, tileY, tileWidth, tileHeight, sampler)
    rects.set(entry.id, {
      x: tileX / columns,
      y: tileY / rows,
      width: 1 / columns,
      height: 1 / rows,
      tileWidth,
      tileHeight,
    })
  })

  const texture = new THREE.DataTexture(
    data,
    atlasWidth,
    atlasHeight,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  texture.colorSpace = THREE.NoColorSpace
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.generateMipmaps = false
  texture.needsUpdate = true

  return {
    texture,
    rects,
    texelSize: new THREE.Vector2(1 / atlasWidth, 1 / atlasHeight),
    layout: {
      columns,
      rows,
      tileWidth,
      tileHeight,
      atlasWidth,
      atlasHeight,
    },
  }
}
