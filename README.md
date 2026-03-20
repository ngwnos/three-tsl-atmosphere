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

## Demo

This repo now includes a plain WebGPU demo app under [`demo/`](./demo).

```bash
bun install
bun run build:demo
bun run dev:demo
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
- `environment.enabled: true, mode: 'manual'`: baked/static probe (capture on `prime()` by default, or call `captureEnvironment(renderer, position?)` directly).
- `environment.enabled: true, mode: 'on-change'`: recapture when requested (`requestEnvironmentCapture()`) and on tracked changes (sun/settings).

## API

- `createAtmosphereRig(scene, options?)`
- `createAtmosphereSystem(scene, settings?, options?)`
- `DEFAULT_ATMOSPHERE_SETTINGS`
- `sunDirectionFromAngles(altitudeDeg, azimuthDeg, target?)`
- `AtmosphereLight`
- `AtmosphereLightNode`
- `AtmosphereParameters`
