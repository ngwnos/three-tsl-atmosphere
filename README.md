# three-tsl-atmosphere

Reusable Bruneton-style precomputed atmospheric scattering for `three` WebGPU + TSL.

This package extracts and packages the LUT precompute + sky runtime workflow into a standalone module.

## Install

```bash
bun add github:ngwnos/three-tsl-atmosphere#main
```

## Usage

```ts
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import {
  createAtmosphereSystem,
  DEFAULT_ATMOSPHERE_SETTINGS,
  sunDirectionFromAngles,
} from 'three-tsl-atmosphere'

const scene = new THREE.Scene()
const renderer = new WebGPURenderer({ canvas })
await renderer.init()

const atmosphere = createAtmosphereSystem(scene, DEFAULT_ATMOSPHERE_SETTINGS)
await atmosphere.prime(renderer)

const sunDirection = sunDirectionFromAngles(45, 30)
atmosphere.setSunDirection(sunDirection)

// each frame / render pass
atmosphere.setCameraPosition(camera.position)
renderer.render(scene, camera)
```

## API

- `createAtmosphereSystem(scene, settings?, options?)`
- `DEFAULT_ATMOSPHERE_SETTINGS`
- `sunDirectionFromAngles(altitudeDeg, azimuthDeg, target?)`

## Attribution

Bruneton atmosphere implementation is based on Eric Bruneton's precomputed atmospheric scattering reference implementation.
The copied files retain the original copyright and license header notices.
