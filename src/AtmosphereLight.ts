import { DirectionalLight } from 'three'
import { uniform } from 'three/tsl'

import type { AtmosphereContextNode } from './bruneton/AtmosphereContextNode'

export class AtmosphereLight extends DirectionalLight {
  override readonly type = 'AtmosphereLight'

  atmosphereContext?: AtmosphereContextNode

  // Distance from target along the world sun direction.
  distance: number

  direct = uniform(true)
  indirect = uniform(true)

  constructor(atmosphereContext?: AtmosphereContextNode, distance = 1) {
    super()
    this.atmosphereContext = atmosphereContext
    this.distance = distance
  }

  override updateMatrixWorld(force?: boolean): void {
    this.updatePosition()
    super.updateMatrixWorld(force)
  }

  private updatePosition(): void {
    if (!this.atmosphereContext) {
      return
    }

    this.position
      .copy(this.atmosphereContext.sunDirectionWorld.value)
      .multiplyScalar(this.distance)
      .add(this.target.position)

    super.updateMatrixWorld(true)
    this.target.updateMatrixWorld(true)
  }

  override copy(source: this, recursive?: boolean): this {
    super.copy(source, recursive)
    this.atmosphereContext = source.atmosphereContext
    this.distance = source.distance
    return this
  }
}
