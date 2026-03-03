import { Vector3, type Camera } from 'three'
import { uniform } from 'three/tsl'
import type { NodeBuilder } from 'three/webgpu'

import { AtmosphereContextBaseNode } from './AtmosphereContextBaseNode'
import { AtmosphereLUTNode } from './AtmosphereLUTNode'
import { AtmosphereParameters } from './AtmosphereParameters'

export class AtmosphereContextNode extends AtmosphereContextBaseNode {
  static override get type(): string {
    return 'AtmosphereContextNode'
  }

  lutNode: AtmosphereLUTNode

  planetCenterWorld = uniform(new Vector3()).setName('planetCenterWorld')
  sunDirectionWorld = uniform(new Vector3(0, 1, 0)).setName('sunDirectionWorld')
  worldToUnitScene = uniform(this.parameters.worldToUnit).setName('worldToUnitScene')

  // Static options:
  camera?: Camera
  constrainCamera = true
  showGround = true

  constructor(
    parameters = new AtmosphereParameters(),
    lutNode = new AtmosphereLUTNode(parameters),
  ) {
    super(parameters)
    this.lutNode = lutNode
  }

  static override get(builder: NodeBuilder): AtmosphereContextNode {
    const context = builder.getContext().atmosphere
    if (!(context instanceof AtmosphereContextNode)) {
      throw new Error('AtmosphereContextNode was not found in the builder context.')
    }
    return context
  }

  override dispose(): void {
    this.lutNode.dispose()
    super.dispose()
  }
}
