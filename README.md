# three-tsl-atmosphere

Reusable Bruneton-style precomputed atmospheric scattering for `three` WebGPU + TSL.

Includes a high-level rig that wires:
- atmosphere sky
- directional sun light
- hemisphere ambient light
- optional cube environment capture (usable as scene `environment`)

This package extracts and packages the LUT precompute + sky runtime workflow into a standalone module.

## Install

```bash
bun add github:ngwnos/three-tsl-atmosphere#main
```

## Usage (Drop-In Rig)

```ts
import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import {
  createAtmosphereRig,
} from 'three-tsl-atmosphere'

const scene = new THREE.Scene()
const renderer = new WebGPURenderer({ canvas })
await renderer.init()

const atmosphereRig = createAtmosphereRig(scene, {
  sun: {
    altitudeDeg: 30,
    azimuthDeg: 0,
    intensity: 1.2,
  },
  environment: {
    enabled: false, // default (fast dynamic sun)
    mode: 'on-change',
    resolution: 256,
  },
})
await atmosphereRig.prime(renderer)

atmosphereRig.setSunAngles(42, 24)
atmosphereRig.setSunIntensity(2.0)

// each frame / render pass
atmosphereRig.update(renderer, camera)
renderer.render(scene, camera)
```

### Optional Environment Capture Modes

- `environment.enabled: false` (default): no cubemap capture, fastest dynamic sun updates.
- `environment.enabled: true, mode: 'manual'`: baked/static probe (capture on `prime()` by default, or call `requestEnvironmentCapture()` manually).
- `environment.enabled: true, mode: 'on-change'` (or legacy `'auto'`): recapture only when sun/settings change.
- `environment.enabled: true, mode: 'every-frame'`: fully dynamic probe capture (highest cost).

## API

- `createAtmosphereRig(scene, options?)`
- `createAtmosphereSystem(scene, settings?, options?)`
- `DEFAULT_ATMOSPHERE_SETTINGS`
- `sunDirectionFromAngles(altitudeDeg, azimuthDeg, target?)`

## Attribution

Bruneton atmosphere implementation is based on Eric Bruneton's precomputed atmospheric scattering reference implementation.
The copied files retain the original copyright and license header notices.
