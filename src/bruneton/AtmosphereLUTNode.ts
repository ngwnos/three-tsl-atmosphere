import { Data3DTexture, FloatType, HalfFloatType, Texture } from 'three'
import {
  Node,
  NodeUpdateType,
  RendererUtils,
  type NodeBuilder,
  type NodeFrame,
  type Renderer,
  type Texture3DNode,
  type TextureNode
} from 'three/webgpu'

import { isFloatLinearSupported } from './core/capabilities'
import { outputTexture } from './core/OutputTextureNode'
import { outputTexture3D } from './core/OutputTexture3DNode'
import type { AnyFloatType } from './core/types'

import { requestIdleCallback } from './helpers/requestIdleCallback'
import type {
  AtmosphereLUTTextures,
  AtmosphereLUTTexturesContext
} from './AtmosphereLUTTextures'
import { AtmosphereLUTTexturesWebGPU } from './AtmosphereLUTTexturesWebGPU'
import { AtmosphereParameters } from './AtmosphereParameters'

const { resetRendererState, restoreRendererState } = RendererUtils

async function timeSlice<T>(iterable: Iterable<T>): Promise<T> {
  const iterator = iterable[Symbol.iterator]()
  return await new Promise<T>((resolve, reject) => {
    const callback = (): void => {
      try {
        const { value, done } = iterator.next()
        if (done === true) {
          resolve(value)
        } else {
          requestIdleCallback(callback)
        }
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error())
      }
    }
    requestIdleCallback(callback)
  })
}

let rendererState: RendererUtils.RendererState

function run(renderer: Renderer, task: () => void): boolean {
  rendererState = resetRendererState(renderer, rendererState)
  renderer.setClearColor(0, 0)
  renderer.autoClear = false
  task()
  restoreRendererState(renderer, rendererState)
  return true
}

export type AtmosphereLUTTextureName = 'transmittance' | 'irradiance'
export type AtmosphereLUTTexture3DName =
  | 'scattering'
  | 'singleMieScattering'
  | 'higherOrderScattering'

const emptyTexture = /*#__PURE__*/ new Texture()
const emptyTexture3D = /*#__PURE__*/ new Data3DTexture()

export class AtmosphereLUTNode extends Node {
  static override get type(): string {
    return 'AtmosphereLUTNode'
  }

  parameters: AtmosphereParameters
  textureType?: AnyFloatType

  private textures?: AtmosphereLUTTextures

  private readonly textureNodes = {
    transmittance: outputTexture(this, emptyTexture),
    irradiance: outputTexture(this, emptyTexture),
    scattering: outputTexture3D(this, emptyTexture3D),
    singleMieScattering: outputTexture3D(this, emptyTexture3D),
    higherOrderScattering: outputTexture3D(this, emptyTexture3D)
  }

  private currentVersion?: number
  private updating = false
  private disposeQueue: (() => void) | undefined
  private resolvedTextureType?: AnyFloatType
  private pendingParameters?: AtmosphereParameters

  constructor(
    parameters = new AtmosphereParameters(),
    textureType?: AnyFloatType
  ) {
    super(null)
    this.parameters = parameters
    this.textureType = textureType

    this.updateBeforeType = NodeUpdateType.FRAME
  }

  configure(parameters: AtmosphereParameters): void {
    if (this.updating) {
      this.pendingParameters = parameters
      return
    }

    this.applyParameters(parameters)
    this.needsUpdate = true
  }

  private applyParameters(parameters: AtmosphereParameters): void {
    this.parameters = parameters

    if (this.textures == null || this.resolvedTextureType == null) {
      return
    }

    const nextParameters = parameters.clone()
    nextParameters.transmittancePrecisionLog = this.resolvedTextureType === HalfFloatType
    this.textures.setup(nextParameters, this.resolvedTextureType)

    if (this.textures instanceof AtmosphereLUTTexturesWebGPU) {
      this.textures.invalidateComputeNodes()
    }
  }

  private ensureInitialized(renderer: Renderer): void {
    if (this.textures == null) {
      this.textures = new AtmosphereLUTTexturesWebGPU()

      const {
        transmittance,
        irradiance,
        scattering,
        singleMieScattering,
        higherOrderScattering
      } = this.textureNodes
      transmittance.value = this.textures.get('transmittance')
      irradiance.value = this.textures.get('irradiance')
      scattering.value = this.textures.get('scattering')
      singleMieScattering.value = this.textures.get('singleMieScattering')
      higherOrderScattering.value = this.textures.get('higherOrderScattering')
    }

    const textureType = isFloatLinearSupported(renderer)
      ? (this.textureType ?? FloatType)
      : HalfFloatType

    if (this.resolvedTextureType !== textureType) {
      this.resolvedTextureType = textureType
    }

    const parameters = this.parameters.clone()
    parameters.transmittancePrecisionLog = textureType === HalfFloatType
    this.textures.setup(parameters, textureType)
  }

  getTextureNode(name: AtmosphereLUTTextureName): TextureNode
  getTextureNode(name: AtmosphereLUTTexture3DName): Texture3DNode
  getTextureNode(
    name: AtmosphereLUTTextureName | AtmosphereLUTTexture3DName
  ): TextureNode | Texture3DNode {
    return this.textureNodes[name]
  }

  private *performCompute(
    renderer: Renderer,
    context: AtmosphereLUTTexturesContext
  ): Iterable<boolean> {
    const { textures } = this
    if (textures == null) {
      throw new Error('AtmosphereLUTNode textures were not initialized.')
    }

    // Compute the transmittance, and store it in transmittanceTexture.
    yield run(renderer, () => {
      textures.computeTransmittance(renderer, context)
    })

    // Compute the direct irradiance, store it in deltaIrradiance and,
    // depending on "additive", either initialize irradianceTexture with zeros
    // or leave it unchanged (we don't want the direct irradiance in
    // irradianceTexture, but only the irradiance from the sky).
    yield run(renderer, () => {
      textures.computeDirectIrradiance(renderer, context)
    })

    // Compute the rayleigh and mie single scattering, store them in
    // deltaRayleighScattering and deltaMieScattering, and either store them or
    // accumulate them in scatteringTexture and optional
    // mieScatteringTexture.
    yield run(renderer, () => {
      textures.computeSingleScattering(renderer, context)
    })

    // Compute the 2nd, 3rd and 4th order of scattering, in sequence.
    for (let scatteringOrder = 2; scatteringOrder <= 4; ++scatteringOrder) {
      // Compute the scattering density, and store it in deltaScatteringDensity.
      yield run(renderer, () => {
        textures.computeScatteringDensity(renderer, context, scatteringOrder)
      })
      // Compute the indirect irradiance, store it in deltaIrradiance and
      // accumulate it in irradianceTexture.
      yield run(renderer, () => {
        textures.computeIndirectIrradiance(renderer, context, scatteringOrder)
      })
      // Compute the multiple scattering, store it in deltaMultipleScattering,
      // and accumulate it in scatteringTexture.
      yield run(renderer, () => {
        textures.computeMultipleScattering(renderer, context)
      })
    }
  }

  async updateTextures(renderer: Renderer): Promise<void> {
    this.ensureInitialized(renderer)
    if (this.textures == null) {
      throw new Error('AtmosphereLUTNode textures were not initialized.')
    }

    this.updating = true
    try {
      while (true) {
        if (this.textures instanceof AtmosphereLUTTexturesWebGPU) {
          // Compute nodes capture the context's intermediate storage textures,
          // and the context is disposed at the end of each run. Recreate compute
          // nodes per run so recomputes work reliably.
          this.textures.invalidateComputeNodes()
        }

        const context = this.textures.createContext()
        try {
          await timeSlice(this.performCompute(renderer, context))
        } finally {
          context.dispose()
          this.disposeQueue?.()
        }

        const pending = this.pendingParameters
        if (!pending) {
          break
        }
        this.pendingParameters = undefined
        this.applyParameters(pending)
      }
    } finally {
      this.updating = false
    }
  }

  override updateBefore({ renderer }: NodeFrame): void {
    if (renderer == null || this.version === this.currentVersion) {
      return
    }
    this.currentVersion = this.version

    // TODO: Race condition
    this.updateTextures(renderer).catch((error: unknown) => {
      throw error instanceof Error ? error : new Error()
    })
  }

  override setup(builder: NodeBuilder): unknown {
    this.ensureInitialized(builder.renderer)
    return super.setup(builder)
  }

  override dispose(): void {
    if (this.updating) {
      this.disposeQueue = () => {
        this.dispose()
        this.disposeQueue = undefined
      }
      return
    }

    this.textures?.dispose()
    super.dispose()
  }
}
