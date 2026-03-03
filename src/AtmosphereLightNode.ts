import type { DirectLightData, LightingContext } from 'three/src/nodes/TSL.js'
import {
  cameraViewMatrix,
  Fn,
  normalWorld,
  positionWorld,
  select,
  vec4,
} from 'three/tsl'
import { AnalyticLightNode, type NodeBuilder } from 'three/webgpu'

import type { AtmosphereLight } from './AtmosphereLight'
import { getTransmittanceToSun } from './bruneton/common'
import { getSkyIlluminance } from './bruneton/runtime'

export class AtmosphereLightNode extends AnalyticLightNode<AtmosphereLight> {
  static override get type(): string {
    return 'AtmosphereLightNode'
  }

  override setupDirect(builder: NodeBuilder): DirectLightData | undefined {
    if (!this.light) {
      return
    }
    const { atmosphereContext } = this.light
    if (!atmosphereContext) {
      return
    }

    const { direct, indirect } = this.light
    const {
      worldToUnitScene,
      planetCenterWorld,
      solarIrradiance,
      sunRadianceToLuminance,
      luminanceScale,
      sunDirectionWorld,
    } = atmosphereContext

    const positionUnit = positionWorld.sub(planetCenterWorld).mul(worldToUnitScene).toVar()
    const normalUnit = normalWorld

    const skyIlluminance = Fn((contextBuilder) => {
      contextBuilder.getContext().atmosphere = atmosphereContext
      return getSkyIlluminance(positionUnit, normalUnit, sunDirectionWorld).mul(
        select(indirect, 1, 0),
      )
    })()

    const lightingContext = builder.getContext() as unknown as LightingContext
    lightingContext.irradiance.addAssign(skyIlluminance)

    const sunDirectionView = cameraViewMatrix.mul(vec4(sunDirectionWorld, 0)).xyz

    const radius = positionUnit.length().toVar()
    const cosSun = positionUnit.dot(sunDirectionWorld).div(radius)
    const sunTransmittance = Fn((contextBuilder) => {
      contextBuilder.getContext().atmosphere = atmosphereContext
      return getTransmittanceToSun(
        atmosphereContext.lutNode.getTextureNode('transmittance'),
        radius,
        cosSun,
      )
    })()

    const sunLuminance = solarIrradiance
      .mul(sunTransmittance)
      .mul(sunRadianceToLuminance.mul(luminanceScale))
      .mul(select(direct, 1, 0))

    return {
      lightDirection: sunDirectionView,
      lightColor: sunLuminance.mul(this.colorNode),
    }
  }
}
