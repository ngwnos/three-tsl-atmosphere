// src/atmosphereSystem.ts
import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  cos as cos2,
  Fn as Fn4,
  If as If5,
  cameraPosition,
  dot,
  fwidth,
  float as float4,
  getViewPosition,
  normalize,
  positionWorld,
  screenUV,
  select as select4,
  smoothstep as smoothstep3,
  sqrt as sqrt4,
  uniform as uniform4,
  vec3 as vec36,
  vec4 as vec45
} from "three/tsl";

// src/bruneton/AtmosphereContextNode.ts
import { Vector3 as Vector33 } from "three";
import { uniform as uniform3 } from "three/tsl";

// src/bruneton/AtmosphereContextBaseNode.ts
import { float, vec3 } from "three/tsl";
import { Node as ThreeNode } from "three/webgpu";

// src/bruneton/AtmosphereParameters.ts
import { Vector2, Vector3 } from "three";
var radians = (degrees) => degrees * Math.PI / 180;
var hashBuffer = new ArrayBuffer(8);
var hashView = new DataView(hashBuffer);
function hash(...values) {
  let h = 2166136261;
  for (const value of values) {
    hashView.setFloat64(0, value, true);
    h ^= hashView.getUint32(0, true);
    h = Math.imul(h, 16777619);
    h ^= hashView.getUint32(4, true);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
var DensityProfileLayer = class _DensityProfileLayer {
  width;
  expTerm;
  expScale;
  linearTerm;
  constantTerm;
  constructor(width = 0, expTerm = 0, expScale = 0, linearTerm = 0, constantTerm = 0) {
    this.width = width;
    this.expTerm = expTerm;
    this.expScale = expScale;
    this.linearTerm = linearTerm;
    this.constantTerm = constantTerm;
  }
  copy(other) {
    this.width = other.width;
    this.expTerm = other.expTerm;
    this.expScale = other.expScale;
    this.linearTerm = other.linearTerm;
    this.constantTerm = other.constantTerm;
    return this;
  }
  hash() {
    return hash(
      this.width,
      this.expTerm,
      this.expScale,
      this.linearTerm,
      this.constantTerm
    );
  }
  clone() {
    return new _DensityProfileLayer().copy(this);
  }
};
var DensityProfile = class _DensityProfile {
  layers;
  constructor(layers) {
    this.layers = layers;
  }
  copy(other) {
    this.layers = [other.layers[0].clone(), other.layers[1].clone()];
    return this;
  }
  hash() {
    return hash(this.layers[0].hash(), this.layers[1].hash());
  }
  clone() {
    return new _DensityProfile([this.layers[0].clone(), this.layers[1].clone()]);
  }
};
var luminanceCoefficients = /* @__PURE__ */ new Vector3(0.2126, 0.7152, 0.0722);
var AtmosphereParameters = class _AtmosphereParameters {
  worldToUnit = 1e-3;
  // The solar irradiance at the top of the atmosphere.
  solarIrradiance = new Vector3(1.474, 1.8504, 1.91198);
  // The sun's angular radius.
  sunAngularRadius = 4675e-6;
  // The distance between the planet center and the bottom of the atmosphere.
  bottomRadius = 636e4;
  // The distance between the planet center and the top of the atmosphere.
  topRadius = 642e4;
  // The density profile of air molecules.
  rayleighDensity = new DensityProfile([
    new DensityProfileLayer(),
    new DensityProfileLayer(0, 1, -1 / 8e3)
  ]);
  // The scattering coefficient of air molecules at the altitude where their
  // density is maximum.
  rayleighScattering = new Vector3(5802e-9, 13558e-9, 331e-7);
  // The density profile of aerosols.
  mieDensity = new DensityProfile([
    new DensityProfileLayer(),
    new DensityProfileLayer(0, 1, -1 / 1200)
  ]);
  // The scattering coefficient of aerosols at the altitude where their density
  // is maximum.
  mieScattering = new Vector3().setScalar(3996e-9);
  // The extinction coefficient of aerosols at the altitude where their density
  // is maximum.
  mieExtinction = new Vector3().setScalar(444e-8);
  // The anisotropy parameter for the Cornette-Shanks phase function.
  miePhaseFunctionG = 0.8;
  // The density profile of air molecules that absorb light (e.g. ozone).
  absorptionDensity = new DensityProfile([
    new DensityProfileLayer(25e3, 0, 0, 1 / 15e3, -2 / 3),
    new DensityProfileLayer(0, 0, 0, -1 / 15e3, 8 / 3)
  ]);
  // The extinction coefficient of molecules that absorb light (e.g. ozone) at
  // the altitude where their density is maximum.
  absorptionExtinction = new Vector3(65e-8, 1881e-9, 85e-9);
  // The average albedo of the ground.
  // https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html
  groundAlbedo = new Vector3().setScalar(0.3);
  // The cosine of the maximum sun zenith angle for which atmospheric scattering
  // must be precomputed (for maximum precision, use the smallest sun zenith
  // angle yielding negligible sky light radiance values).
  minCosSun = Math.cos(radians(102));
  sunRadianceToLuminance = new Vector3(98242.786222, 69954.398112, 66475.012354);
  skyRadianceToLuminance = new Vector3(114974.91644, 71305.954816, 65310.548555);
  luminanceScale = 1 / luminanceCoefficients.dot(this.sunRadianceToLuminance);
  // Whether to store the optical depth instead of the transmittance in the
  // transmittance textures. Linear filtering on logarithmic numbers yields
  // non-linear interpolations so that sampling will be performed manually, thus
  // this should be enabled only in the precomputation stage.
  transmittancePrecisionLog = false;
  // Whether to store the single Mie scattering in the alpha channel of the
  // scattering texture, reducing the memory footprint on the GPU.
  combinedScatteringTextures = true;
  // Whether to generate and use a separate texture for higher-order scattering
  // (n >= 2) for a better approximation of the multi-scattering occlusion.
  higherOrderScatteringTexture = true;
  // Texture sizes:
  transmittanceTextureSize = new Vector2(512, 128);
  irradianceTextureSize = new Vector2(128, 32);
  scatteringTextureRadiusSize = 64;
  scatteringTextureCosViewSize = 128;
  scatteringTextureCosSunSize = 64;
  scatteringTextureCosViewSunSize = 8;
  scatteringTextureSize = new Vector3(
    this.scatteringTextureCosViewSunSize * this.scatteringTextureCosSunSize,
    this.scatteringTextureCosViewSize,
    this.scatteringTextureRadiusSize
  );
  copy(other) {
    this.worldToUnit = other.worldToUnit;
    this.solarIrradiance.copy(other.solarIrradiance);
    this.sunAngularRadius = other.sunAngularRadius;
    this.bottomRadius = other.bottomRadius;
    this.topRadius = other.topRadius;
    this.rayleighDensity.copy(other.rayleighDensity);
    this.rayleighScattering.copy(other.rayleighScattering);
    this.mieDensity.copy(other.mieDensity);
    this.mieScattering.copy(other.mieScattering);
    this.mieExtinction.copy(other.mieExtinction);
    this.miePhaseFunctionG = other.miePhaseFunctionG;
    this.absorptionDensity.copy(other.absorptionDensity);
    this.absorptionExtinction.copy(other.absorptionExtinction);
    this.groundAlbedo.copy(other.groundAlbedo);
    this.minCosSun = other.minCosSun;
    this.sunRadianceToLuminance.copy(other.sunRadianceToLuminance);
    this.skyRadianceToLuminance.copy(other.skyRadianceToLuminance);
    this.luminanceScale = other.luminanceScale;
    this.transmittancePrecisionLog = other.transmittancePrecisionLog;
    this.combinedScatteringTextures = other.combinedScatteringTextures;
    this.higherOrderScatteringTexture = other.higherOrderScatteringTexture;
    this.transmittanceTextureSize.copy(other.transmittanceTextureSize);
    this.irradianceTextureSize.copy(other.irradianceTextureSize);
    this.scatteringTextureRadiusSize = other.scatteringTextureRadiusSize;
    this.scatteringTextureCosViewSize = other.scatteringTextureCosViewSize;
    this.scatteringTextureCosSunSize = other.scatteringTextureCosSunSize;
    this.scatteringTextureCosViewSunSize = other.scatteringTextureCosViewSunSize;
    this.scatteringTextureSize.copy(other.scatteringTextureSize);
    return this;
  }
  hash() {
    return hash(
      this.worldToUnit,
      ...this.solarIrradiance,
      this.sunAngularRadius,
      this.bottomRadius,
      this.topRadius,
      this.rayleighDensity.hash(),
      ...this.rayleighScattering,
      this.mieDensity.hash(),
      ...this.mieScattering,
      ...this.mieExtinction,
      this.miePhaseFunctionG,
      this.absorptionDensity.hash(),
      ...this.absorptionExtinction,
      ...this.groundAlbedo,
      this.minCosSun,
      ...this.sunRadianceToLuminance,
      ...this.skyRadianceToLuminance,
      this.luminanceScale,
      +this.transmittancePrecisionLog,
      +this.combinedScatteringTextures,
      +this.higherOrderScatteringTexture,
      ...this.transmittanceTextureSize,
      ...this.irradianceTextureSize,
      this.scatteringTextureRadiusSize,
      this.scatteringTextureCosViewSize,
      this.scatteringTextureCosSunSize,
      this.scatteringTextureCosViewSunSize,
      ...this.scatteringTextureSize
    );
  }
  clone() {
    return new _AtmosphereParameters().copy(this);
  }
};

// src/bruneton/AtmosphereContextBaseNode.ts
function densityProfileLayerNodes(layer, worldToUnit) {
  const { width, expTerm, expScale, linearTerm, constantTerm } = layer;
  return {
    width: float(width * worldToUnit),
    expTerm: float(expTerm),
    expScale: float(expScale / worldToUnit),
    linearTerm: float(linearTerm / worldToUnit),
    constantTerm: float(constantTerm)
  };
}
function densityProfileNodes(profile, worldToUnit) {
  return {
    layers: [
      densityProfileLayerNodes(profile.layers[0], worldToUnit),
      densityProfileLayerNodes(profile.layers[1], worldToUnit)
    ]
  };
}
var AtmosphereContextBaseNode = class _AtmosphereContextBaseNode extends ThreeNode {
  static get type() {
    return "AtmosphereContextBaseNode";
  }
  parameters;
  worldToUnit;
  solarIrradiance;
  sunAngularRadius;
  bottomRadius;
  topRadius;
  rayleighDensity;
  rayleighScattering;
  mieDensity;
  mieScattering;
  mieExtinction;
  miePhaseFunctionG;
  absorptionDensity;
  absorptionExtinction;
  groundAlbedo;
  minCosSun;
  sunRadianceToLuminance;
  skyRadianceToLuminance;
  luminanceScale;
  constructor(parameters = new AtmosphereParameters()) {
    super(null);
    this.parameters = parameters;
    this.applyParameters(parameters);
  }
  applyParameters(parameters) {
    this.parameters = parameters;
    const {
      worldToUnit,
      solarIrradiance,
      sunAngularRadius,
      bottomRadius,
      topRadius,
      rayleighDensity,
      rayleighScattering,
      mieDensity,
      mieScattering,
      mieExtinction,
      miePhaseFunctionG,
      absorptionDensity,
      absorptionExtinction,
      groundAlbedo,
      minCosSun,
      sunRadianceToLuminance,
      skyRadianceToLuminance,
      luminanceScale
    } = parameters;
    this.worldToUnit = float(worldToUnit);
    this.solarIrradiance = vec3(solarIrradiance);
    this.sunAngularRadius = float(sunAngularRadius);
    this.bottomRadius = float(bottomRadius * worldToUnit);
    this.topRadius = float(topRadius * worldToUnit);
    this.rayleighDensity = densityProfileNodes(rayleighDensity, worldToUnit);
    this.rayleighScattering = vec3(
      rayleighScattering.x / worldToUnit,
      rayleighScattering.y / worldToUnit,
      rayleighScattering.z / worldToUnit
    );
    this.mieDensity = densityProfileNodes(mieDensity, worldToUnit);
    this.mieScattering = vec3(
      mieScattering.x / worldToUnit,
      mieScattering.y / worldToUnit,
      mieScattering.z / worldToUnit
    );
    this.mieExtinction = vec3(
      mieExtinction.x / worldToUnit,
      mieExtinction.y / worldToUnit,
      mieExtinction.z / worldToUnit
    );
    this.miePhaseFunctionG = float(miePhaseFunctionG);
    this.absorptionDensity = densityProfileNodes(absorptionDensity, worldToUnit);
    this.absorptionExtinction = vec3(
      absorptionExtinction.x / worldToUnit,
      absorptionExtinction.y / worldToUnit,
      absorptionExtinction.z / worldToUnit
    );
    this.groundAlbedo = vec3(groundAlbedo);
    this.minCosSun = float(minCosSun);
    this.sunRadianceToLuminance = vec3(sunRadianceToLuminance);
    this.skyRadianceToLuminance = vec3(skyRadianceToLuminance);
    this.luminanceScale = float(luminanceScale);
  }
  customCacheKey() {
    return this.parameters.hash();
  }
  static get(builder) {
    const context = builder.getContext().atmosphere;
    if (!(context instanceof _AtmosphereContextBaseNode)) {
      throw new Error(
        "AtmosphereContextBaseNode was not found in the builder context."
      );
    }
    return context;
  }
};

// src/bruneton/AtmosphereLUTNode.ts
import { Data3DTexture as Data3DTexture2, FloatType, HalfFloatType, Texture } from "three";
import {
  Node,
  NodeUpdateType,
  RendererUtils
} from "three/webgpu";

// src/bruneton/core/capabilities.ts
import { WebGLRenderer } from "three";
function isFloatLinearSupported(renderer) {
  return renderer instanceof WebGLRenderer ? renderer.getContext().getExtension("OES_texture_float_linear") != null : renderer.backend.hasFeature?.("float32-filterable") ?? false;
}

// src/bruneton/core/OutputTextureNode.ts
import { TextureNode } from "three/webgpu";
var OutputTextureNode = class extends TextureNode {
  static get type() {
    return "OutputTextureNode";
  }
  owner;
  constructor(owner, texture2) {
    super(texture2);
    this.owner = owner;
    this.updateMatrix = false;
  }
  setup(builder) {
    this.owner.build(builder);
    return super.setup(builder);
  }
  clone() {
    return new this.constructor(this.owner, this.value);
  }
};
var outputTexture = (...args) => new OutputTextureNode(...args);

// src/bruneton/core/OutputTexture3DNode.ts
import { Texture3DNode } from "three/webgpu";
var OutputTexture3DNode = class extends Texture3DNode {
  static get type() {
    return "OutputTexture3DNode";
  }
  owner;
  constructor(owner, texture2) {
    super(texture2);
    this.owner = owner;
    this.updateMatrix = false;
  }
  setup(builder) {
    this.owner.build(builder);
    return super.setup(builder);
  }
  clone() {
    return new this.constructor(this.owner, this.value);
  }
};
var outputTexture3D = (...args) => new OutputTexture3DNode(...args);

// src/bruneton/helpers/requestIdleCallback.ts
var requestIdleCallback = typeof window !== "undefined" && window.requestIdleCallback != null ? window.requestIdleCallback : function requestIdleCallback2(callback, options = {}) {
  const relaxation = 1;
  const timeout = options.timeout ?? relaxation;
  const start = performance.now();
  return setTimeout(() => {
    callback({
      get didTimeout() {
        return options.timeout != null ? false : performance.now() - start - relaxation > timeout;
      },
      timeRemaining() {
        return Math.max(0, relaxation + (performance.now() - start));
      }
    });
  }, relaxation);
};
var cancelIdleCallback = typeof window !== "undefined" && window.cancelIdleCallback != null ? window.cancelIdleCallback : function cancelIdleCallback2(id) {
  clearTimeout(id);
};

// src/bruneton/AtmosphereLUTTexturesWebGPU.ts
import {
  Box3,
  Data3DTexture,
  DataTexture,
  LinearFilter,
  NoColorSpace
} from "three";
import {
  exp as exp3,
  Fn as Fn3,
  globalId,
  If as If3,
  int,
  Return,
  texture,
  textureLoad,
  texture3D,
  textureStore,
  uniform as uniform2,
  uvec2,
  uvec3,
  vec2 as vec23,
  vec3 as vec34,
  vec4 as vec43
} from "three/tsl";
import {
  Storage3DTexture,
  StorageTexture
} from "three/webgpu";

// src/bruneton/core/types.ts
function reinterpretType(value) {
  void value;
}

// src/bruneton/AtmosphereLUTTextures.ts
import { Matrix3, Vector3 as Vector32 } from "three";
import { uniform } from "three/tsl";
var AtmosphereLUTTexturesContext = class extends AtmosphereContextBaseNode {
  textureType;
  lambdas = uniform(new Vector32(680, 550, 440));
  luminanceFromRadiance = uniform(new Matrix3());
  constructor(parameters, textureType) {
    super(parameters);
    this.textureType = textureType;
  }
};
var AtmosphereLUTTextures = class {
  parameters;
  textureType;
  setup(parameters, textureType) {
    this.parameters = parameters;
    this.textureType = textureType;
  }
  dispose() {
  }
};

// src/bruneton/common.ts
import {
  clamp,
  div,
  exp,
  float as float2,
  floor,
  fract,
  If,
  max,
  min,
  mix,
  mul,
  PI,
  select,
  smoothstep,
  sqrt,
  vec2,
  vec3 as vec32,
  vec4
} from "three/tsl";

// src/bruneton/core/FnLayout.ts
import { Fn } from "three/tsl";
function transformType(type) {
  if (typeof type === "string") {
    return type;
  }
  if (type.layout.name == null) {
    throw new Error("Struct name is required.");
  }
  return type.layout.name;
}
function FnLayout({
  typeOnly = false,
  ...layout
}) {
  const fnCallback = (callback) => callback;
  return typeOnly ? (callback) => Fn(fnCallback(callback)) : (callback) => Fn(fnCallback(callback)).setLayout({
    ...layout,
    type: transformType(layout.type),
    inputs: layout.inputs?.map((input) => ({
      ...input,
      type: transformType(input.type)
    })) ?? []
  });
}

// src/bruneton/dimensional.ts
var Length = "float";
var Dimensionless = "float";
var Area = "float";
var InverseSolidAngle = "float";
var AbstractSpectrum = "vec3";
var DimensionlessSpectrum = "vec3";
var IrradianceSpectrum = "vec3";
var RadianceSpectrum = "vec3";
var RadianceDensitySpectrum = "vec3";
var Position = "vec3";
var Direction = "vec3";
var Luminance3 = "vec3";
var Illuminance3 = "vec3";
var TransmittanceTexture = "texture";
var AbstractScatteringTexture = "texture3D";
var ReducedScatteringTexture = "texture3D";
var ScatteringTexture = "texture3D";
var ScatteringDensityTexture = "texture3D";
var IrradianceTexture = "texture";

// src/bruneton/common.ts
var clampCosine = /* @__PURE__ */ FnLayout({
  name: "clampCosine",
  type: Dimensionless,
  inputs: [{ name: "cosine", type: Dimensionless }]
})(([cosine]) => {
  return clamp(cosine, -1, 1);
});
var clampDistance = /* @__PURE__ */ FnLayout({
  name: "clampDistance",
  type: Dimensionless,
  inputs: [{ name: "cosine", type: Dimensionless }]
})(([distance]) => {
  return max(distance, 0);
});
var clampRadius = /* @__PURE__ */ FnLayout({
  name: "clampRadius",
  type: Length,
  inputs: [{ name: "radius", type: Length }]
})(([radius], builder) => {
  const context = AtmosphereContextBaseNode.get(builder);
  const { topRadius, bottomRadius } = context;
  return clamp(radius, bottomRadius, topRadius);
});
var sqrtSafe = /* @__PURE__ */ FnLayout({
  name: "sqrtSafe",
  type: Dimensionless,
  inputs: [{ name: "area", type: Area }]
})(([area]) => {
  return sqrt(max(area, 0));
});
var distanceToTopAtmosphereBoundary = /* @__PURE__ */ FnLayout({
  name: "distanceToTopAtmosphereBoundary",
  type: Length,
  inputs: [
    { name: "radius", type: Length },
    { name: "cosView", type: Dimensionless }
  ]
})(([radius, cosView], builder) => {
  const context = AtmosphereContextBaseNode.get(builder);
  const { topRadius } = context;
  const discriminant = radius.pow2().mul(cosView.pow2().sub(1)).add(topRadius.pow2());
  return clampDistance(radius.negate().mul(cosView).add(sqrtSafe(discriminant)));
});
var distanceToBottomAtmosphereBoundary = /* @__PURE__ */ FnLayout({
  name: "distanceToBottomAtmosphereBoundary",
  type: Length,
  inputs: [
    { name: "radius", type: Length },
    { name: "cosView", type: Dimensionless }
  ]
})(([radius, cosView], builder) => {
  const context = AtmosphereContextBaseNode.get(builder);
  const { bottomRadius } = context;
  const discriminant = radius.pow2().mul(cosView.pow2().sub(1)).add(bottomRadius.pow2());
  return clampDistance(radius.negate().mul(cosView).sub(sqrtSafe(discriminant)));
});
var rayIntersectsGround = /* @__PURE__ */ FnLayout({
  name: "rayIntersectsGround",
  type: "bool",
  inputs: [
    { name: "radius", type: Length },
    { name: "cosView", type: Dimensionless }
  ]
})(([radius, cosView], builder) => {
  const context = AtmosphereContextBaseNode.get(builder);
  const { bottomRadius } = context;
  return cosView.lessThan(0).and(
    radius.pow2().mul(cosView.pow2().sub(1)).add(bottomRadius.pow2()).greaterThanEqual(0)
  );
});
var getTextureCoordFromUnitRange = /* @__PURE__ */ FnLayout({
  name: "getTextureCoordFromUnitRange",
  type: "float",
  inputs: [
    { name: "unit", type: "float" },
    { name: "textureSize", type: "float" }
  ]
})(([unit, textureSize]) => {
  return div(0.5, textureSize).add(
    unit.mul(textureSize.reciprocal().oneMinus())
  );
});
var getTransmittanceTextureUV = /* @__PURE__ */ FnLayout({
  name: "getTransmittanceTextureUV",
  type: "vec2",
  inputs: [
    { name: "radius", type: Length },
    { name: "cosView", type: Dimensionless }
  ]
})(([radius, cosView], builder) => {
  const context = AtmosphereContextBaseNode.get(builder);
  const { parameters, topRadius, bottomRadius } = context;
  const H = sqrt(topRadius.pow2().sub(bottomRadius.pow2())).toVar();
  const distanceToHorizon = sqrtSafe(
    radius.pow2().sub(bottomRadius.pow2())
  ).toVar();
  const distanceToTop = distanceToTopAtmosphereBoundary(radius, cosView);
  const minDistance = topRadius.sub(radius).toVar();
  const maxDistance = distanceToHorizon.add(H);
  const cosViewUnit = distanceToTop.remap(minDistance, maxDistance);
  const radiusUnit = distanceToHorizon.div(H);
  return vec2(
    getTextureCoordFromUnitRange(
      cosViewUnit,
      parameters.transmittanceTextureSize.x
    ),
    getTextureCoordFromUnitRange(
      radiusUnit,
      parameters.transmittanceTextureSize.y
    )
  );
});
var getTransmittanceToTopAtmosphereBoundary = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // TODO: Fn layout doesn't support texture type
  name: "getTransmittanceToTopAtmosphereBoundary",
  type: DimensionlessSpectrum,
  inputs: [
    { name: "transmittanceTexture", type: TransmittanceTexture },
    { name: "radius", type: Length },
    { name: "cosView", type: Dimensionless }
  ]
})(([transmittanceTexture, radius, cosView], builder) => {
  const { parameters } = AtmosphereContextBaseNode.get(builder);
  const uv = getTransmittanceTextureUV(radius, cosView);
  if (parameters.transmittancePrecisionLog) {
    const size = vec2(parameters.transmittanceTextureSize);
    const texelSize = vec32(size.reciprocal(), 0).toConst();
    const coord = uv.mul(size).sub(0.5).toVar();
    const i = floor(coord).add(0.5).mul(texelSize.xy).toVar();
    const f = fract(coord).toVar();
    const t1 = exp(transmittanceTexture.sample(i).negate());
    const t2 = exp(transmittanceTexture.sample(i.add(texelSize.xz)).negate());
    const t3 = exp(transmittanceTexture.sample(i.add(texelSize.zy)).negate());
    const t4 = exp(transmittanceTexture.sample(i.add(texelSize.xy)).negate());
    return mix(mix(t1, t2, f.x), mix(t3, t4, f.x), f.y).rgb;
  } else {
    return transmittanceTexture.sample(uv).rgb;
  }
});
var getTransmittance = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // TODO: Fn layout doesn't support texture type
  name: "getTransmittance",
  type: DimensionlessSpectrum,
  inputs: [
    { name: "transmittanceTexture", type: TransmittanceTexture },
    { name: "radius", type: Length },
    { name: "cosView", type: Dimensionless },
    { name: "rayLength", type: Length },
    { name: "viewRayIntersectsGround", type: "bool" }
  ]
})(([
  transmittanceTexture,
  radius,
  cosView,
  rayLength,
  viewRayIntersectsGround
]) => {
  const radiusEnd = clampRadius(
    sqrt(
      rayLength.pow2().add(mul(2, radius, cosView, rayLength)).add(radius.pow2())
    )
  ).toVar();
  const cosViewEnd = clampCosine(
    radius.mul(cosView).add(rayLength).div(radiusEnd)
  ).toVar();
  const transmittance = vec32().toVar();
  If(viewRayIntersectsGround, () => {
    transmittance.assign(
      min(
        getTransmittanceToTopAtmosphereBoundary(
          transmittanceTexture,
          radiusEnd,
          cosViewEnd.negate()
        ).div(
          getTransmittanceToTopAtmosphereBoundary(
            transmittanceTexture,
            radius,
            cosView.negate()
          )
        ),
        vec32(1)
      )
    );
  }).Else(() => {
    transmittance.assign(
      min(
        getTransmittanceToTopAtmosphereBoundary(
          transmittanceTexture,
          radius,
          cosView
        ).div(
          getTransmittanceToTopAtmosphereBoundary(
            transmittanceTexture,
            radiusEnd,
            cosViewEnd
          )
        ),
        vec32(1)
      )
    );
  });
  return transmittance;
});
var getTransmittanceToSun = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // TODO: Fn layout doesn't support texture type
  name: "getTransmittanceToSun",
  type: DimensionlessSpectrum,
  inputs: [
    { name: "transmittanceTexture", type: TransmittanceTexture },
    { name: "radius", type: Length },
    { name: "cosView", type: Dimensionless }
  ]
})(([transmittanceTexture, radius, cosSun], builder) => {
  const context = AtmosphereContextBaseNode.get(builder);
  const { sunAngularRadius, bottomRadius } = context;
  const sinHorizon = bottomRadius.div(radius).toVar();
  const cosHorizon = sqrt(max(sinHorizon.pow2().oneMinus(), 0)).negate();
  return getTransmittanceToTopAtmosphereBoundary(
    transmittanceTexture,
    radius,
    cosSun
  ).mul(
    smoothstep(
      sinHorizon.negate().mul(sunAngularRadius),
      sinHorizon.mul(sunAngularRadius),
      cosSun.sub(cosHorizon)
    )
  );
});
var rayleighPhaseFunction = /* @__PURE__ */ FnLayout({
  name: "rayleighPhaseFunction",
  type: InverseSolidAngle,
  inputs: [{ name: "cosViewSun", type: Dimensionless }]
})(([cosViewSun]) => {
  const k = div(3, mul(16, PI));
  return k.mul(cosViewSun.pow2().add(1));
});
var miePhaseFunction = /* @__PURE__ */ FnLayout({
  name: "miePhaseFunction",
  type: InverseSolidAngle,
  inputs: [
    { name: "g", type: Dimensionless },
    { name: "cosViewSun", type: Dimensionless }
  ]
})(([g, cosViewSun]) => {
  const k = div(3, PI.mul(8)).mul(g.pow2().oneMinus()).div(g.pow2().add(2));
  return k.mul(cosViewSun.pow2().add(1)).div(g.pow2().sub(g.mul(2).mul(cosViewSun)).add(1).pow(1.5));
});
var getScatteringTextureCoord = /* @__PURE__ */ FnLayout({
  name: "getScatteringTextureCoord",
  type: "vec4",
  inputs: [
    { name: "radius", type: Length },
    { name: "cosView", type: Dimensionless },
    { name: "cosSun", type: Dimensionless },
    { name: "cosViewSun", type: Dimensionless },
    { name: "viewRayIntersectsGround", type: "bool" }
  ]
})(([radius, cosView, cosSun, cosViewSun, viewRayIntersectsGround], builder) => {
  const context = AtmosphereContextBaseNode.get(builder);
  const { parameters, topRadius, bottomRadius, minCosSun } = context;
  const H = sqrt(topRadius.pow2().sub(bottomRadius.pow2())).toVar();
  const distanceToHorizon = sqrtSafe(
    radius.pow2().sub(bottomRadius.pow2())
  ).toVar();
  const radiusCoord = getTextureCoordFromUnitRange(
    distanceToHorizon.div(H),
    parameters.scatteringTextureRadiusSize
  );
  const radiusCosView = radius.mul(cosView).toVar();
  const discriminant = radiusCosView.pow2().sub(radius.pow2()).add(bottomRadius.pow2()).toVar();
  const cosViewCoord = float2().toVar();
  If(viewRayIntersectsGround, () => {
    const distance = radiusCosView.negate().sub(sqrtSafe(discriminant));
    const minDistance2 = radius.sub(bottomRadius).toVar();
    const maxDistance2 = distanceToHorizon;
    cosViewCoord.assign(
      getTextureCoordFromUnitRange(
        select(
          maxDistance2.equal(minDistance2),
          0,
          distance.remap(minDistance2, maxDistance2)
        ),
        parameters.scatteringTextureCosViewSize / 2
      ).oneMinus().mul(0.5)
    );
  }).Else(() => {
    const distance = radiusCosView.negate().add(sqrtSafe(discriminant.add(H.pow2())));
    const minDistance2 = topRadius.sub(radius).toVar();
    const maxDistance2 = distanceToHorizon.add(H);
    cosViewCoord.assign(
      getTextureCoordFromUnitRange(
        distance.remap(minDistance2, maxDistance2),
        parameters.scatteringTextureCosViewSize / 2
      ).add(1).mul(0.5)
    );
  });
  const minDistance = topRadius.sub(bottomRadius).toVar();
  const maxDistance = H;
  const d = distanceToTopAtmosphereBoundary(bottomRadius, cosSun);
  const a = d.remap(minDistance, maxDistance).toVar();
  const D = distanceToTopAtmosphereBoundary(bottomRadius, minCosSun);
  const A = D.remap(minDistance, maxDistance);
  const cosSunCoord = getTextureCoordFromUnitRange(
    max(a.div(A).oneMinus(), 0).div(a.add(1)),
    parameters.scatteringTextureCosSunSize
  );
  const cosViewSunCoord = cosViewSun.add(1).mul(0.5);
  return vec4(cosViewSunCoord, cosSunCoord, cosViewCoord, radiusCoord);
});
var getScattering = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // TODO: Fn layout doesn't support texture type
  name: "getScattering",
  type: AbstractSpectrum,
  inputs: [
    { name: "scatteringTexture", type: AbstractScatteringTexture },
    { name: "radius", type: Length },
    { name: "cosView", type: Dimensionless },
    { name: "cosSun", type: Dimensionless },
    { name: "cosViewSun", type: Dimensionless },
    { name: "viewRayIntersectsGround", type: "bool" }
  ]
})(([
  scatteringTexture,
  radius,
  cosView,
  cosSun,
  cosViewSun,
  viewRayIntersectsGround
], builder) => {
  const { parameters } = AtmosphereContextBaseNode.get(builder);
  const coord = getScatteringTextureCoord(
    radius,
    cosView,
    cosSun,
    cosViewSun,
    viewRayIntersectsGround
  ).toVar();
  const texCoordX = coord.x.mul(parameters.scatteringTextureCosViewSunSize - 1).toVar();
  const texX = floor(texCoordX).toVar();
  const lerp = texCoordX.sub(texX).toVar();
  const coord0 = vec32(
    texX.add(coord.y).div(parameters.scatteringTextureCosViewSunSize),
    coord.z,
    coord.w
  );
  const coord1 = vec32(
    texX.add(1).add(coord.y).div(parameters.scatteringTextureCosViewSunSize),
    coord.z,
    coord.w
  );
  return scatteringTexture.sample(coord0).mul(lerp.oneMinus()).add(scatteringTexture.sample(coord1).mul(lerp)).rgb;
});
var getIrradianceTextureUV = /* @__PURE__ */ FnLayout({
  name: "getIrradianceTextureUV",
  type: "vec2",
  inputs: [
    { name: "radius", type: Length },
    { name: "cosSun", type: Dimensionless }
  ]
})(([radius, cosSun], builder) => {
  const context = AtmosphereContextBaseNode.get(builder);
  const { parameters, topRadius, bottomRadius } = context;
  const radiusUnit = radius.remap(bottomRadius, topRadius);
  const cosSunUnit = cosSun.mul(0.5).add(0.5);
  return vec2(
    getTextureCoordFromUnitRange(
      cosSunUnit,
      parameters.irradianceTextureSize.x
    ),
    getTextureCoordFromUnitRange(radiusUnit, parameters.irradianceTextureSize.y)
  );
});
var getIrradiance = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // TODO: Fn layout doesn't support texture type
  name: "getIrradiance",
  type: IrradianceSpectrum,
  inputs: [
    { name: "irradianceTexture", type: IrradianceTexture },
    { name: "radius", type: Length },
    { name: "cosSun", type: Dimensionless }
  ]
})(([irradianceTexture, radius, cosSun]) => {
  const uv = getIrradianceTextureUV(radius, cosSun);
  return irradianceTexture.sample(uv).rgb;
});

// src/bruneton/precompute.ts
import {
  add,
  bool,
  clamp as clamp2,
  cos,
  equal,
  exp as exp2,
  float as float3,
  floor as floor2,
  If as If2,
  Loop,
  max as max2,
  min as min2,
  mul as mul2,
  PI as PI2,
  select as select2,
  sin,
  sqrt as sqrt2,
  struct,
  vec2 as vec22,
  vec3 as vec33,
  vec4 as vec42
} from "three/tsl";

// src/bruneton/core/FnVar.ts
import { Fn as Fn2 } from "three/tsl";
function FnVar(callback) {
  return Fn2((args, builder) => {
    const result = callback(...args);
    return typeof result === "function" ? result(builder) : result;
  });
}

// src/bruneton/precompute.ts
var getLayerDensity = /* @__PURE__ */ FnVar(
  (layer, altitude) => {
    return layer.expTerm.mul(exp2(layer.expScale.mul(altitude))).add(layer.linearTerm.mul(altitude)).add(layer.constantTerm).saturate();
  }
);
var getProfileDensity = /* @__PURE__ */ FnVar(
  (profile, altitude) => {
    return select2(
      altitude.lessThan(profile.layers[0].width),
      getLayerDensity(profile.layers[0], altitude),
      getLayerDensity(profile.layers[1], altitude)
    );
  }
);
var computeOpticalDepthToTopAtmosphereBoundary = /* @__PURE__ */ FnVar(
  (profile, radius, cosView) => (builder) => {
    const context = AtmosphereContextBaseNode.get(builder);
    const { bottomRadius } = context;
    const sampleCount = 500;
    const stepSize = distanceToTopAtmosphereBoundary(radius, cosView).div(sampleCount).toVar();
    const opticalDepth = float3(0).toVar();
    Loop({ start: 0, end: sampleCount, condition: "<=" }, ({ i }) => {
      const rayLength = float3(i).mul(stepSize).toVar();
      const r = sqrt2(
        add(
          rayLength.pow2(),
          mul2(2, radius, cosView, rayLength),
          radius.pow2()
        )
      ).toVar();
      const y = getProfileDensity(profile, r.sub(bottomRadius));
      const weight = select2(equal(i, 0).or(equal(i, sampleCount)), 0.5, 1);
      opticalDepth.addAssign(y.mul(weight).mul(stepSize));
    });
    return opticalDepth;
  }
);
var computeTransmittanceToTopAtmosphereBoundary = /* @__PURE__ */ FnLayout({
  name: "computeTransmittanceToTopAtmosphereBoundary",
  type: DimensionlessSpectrum,
  inputs: [
    { name: "radius", type: Length },
    { name: "cosView", type: Dimensionless }
  ]
})(([radius, cosView], builder) => {
  const context = AtmosphereContextBaseNode.get(builder);
  const {
    parameters,
    rayleighDensity,
    rayleighScattering,
    mieDensity,
    mieExtinction,
    absorptionDensity,
    absorptionExtinction
  } = context;
  const opticalDepth = add(
    rayleighScattering.mul(
      computeOpticalDepthToTopAtmosphereBoundary(
        rayleighDensity,
        radius,
        cosView
      )
    ),
    mieExtinction.mul(
      computeOpticalDepthToTopAtmosphereBoundary(mieDensity, radius, cosView)
    ),
    absorptionExtinction.mul(
      computeOpticalDepthToTopAtmosphereBoundary(
        absorptionDensity,
        radius,
        cosView
      )
    )
  ).toVar();
  if (parameters.transmittancePrecisionLog) {
    return opticalDepth;
  } else {
    return exp2(opticalDepth.negate());
  }
});
var getUnitRangeFromTextureCoord = /* @__PURE__ */ FnLayout({
  name: "getUnitRangeFromTextureCoord",
  type: "float",
  inputs: [
    { name: "coord", type: "float" },
    { name: "textureSize", type: "float" }
  ]
})(([coord, textureSize]) => {
  const texelSize = textureSize.reciprocal();
  return coord.sub(texelSize.mul(0.5)).div(texelSize.oneMinus());
});
var transmittanceParamsStruct = /* @__PURE__ */ struct(
  {
    radius: Length,
    cosView: Dimensionless
  },
  "transmittanceParams"
);
var getParamsFromTransmittanceTextureUV = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // BUG: Fails with the struct return type in WebGL
  name: "getParamsFromTransmittanceTextureUV",
  type: transmittanceParamsStruct,
  inputs: [{ name: "uv", type: "vec2" }]
})(([uv], builder) => {
  const context = AtmosphereContextBaseNode.get(builder);
  const { parameters, topRadius, bottomRadius } = context;
  const cosViewUnit = getUnitRangeFromTextureCoord(
    uv.x,
    parameters.transmittanceTextureSize.x
  );
  const radiusUnit = getUnitRangeFromTextureCoord(
    uv.y,
    parameters.transmittanceTextureSize.y
  );
  const H = sqrt2(topRadius.pow2().sub(bottomRadius.pow2())).toVar();
  const distanceToHorizon = H.mul(radiusUnit).toVar();
  const radius = sqrt2(distanceToHorizon.pow2().add(bottomRadius.pow2()));
  const minDistance = topRadius.sub(radius).toVar();
  const maxDistance = distanceToHorizon.add(H);
  const distance = minDistance.add(cosViewUnit.mul(maxDistance.sub(minDistance))).toVar();
  const cosView = select2(
    distance.equal(0),
    1,
    H.pow2().sub(distanceToHorizon.pow2()).sub(distance.pow2()).div(mul2(2, radius, distance))
  );
  return transmittanceParamsStruct(radius, cosView);
});
var computeTransmittanceToTopAtmosphereBoundaryTexture = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // BUG: Fails with undefined struct type in WebGL
  name: "computeTransmittanceToTopAtmosphereBoundaryTexture",
  type: DimensionlessSpectrum,
  inputs: [{ name: "fragCoord", type: "vec2" }]
})(([fragCoord], builder) => {
  const { parameters } = AtmosphereContextBaseNode.get(builder);
  const transmittanceParams = getParamsFromTransmittanceTextureUV(
    fragCoord.div(vec22(parameters.transmittanceTextureSize))
  ).toVar();
  return computeTransmittanceToTopAtmosphereBoundary(
    transmittanceParams.get("radius"),
    transmittanceParams.get("cosView")
  );
});
var singleScatteringStruct = /* @__PURE__ */ struct(
  {
    rayleigh: DimensionlessSpectrum,
    mie: DimensionlessSpectrum
  },
  "singleScattering"
);
var computeSingleScatteringIntegrand = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // TODO: Fn layout doesn't support texture type
  name: "computeSingleScatteringIntegrand",
  type: singleScatteringStruct,
  inputs: [
    { name: "transmittanceTexture", type: TransmittanceTexture },
    { name: "radius", type: Length },
    { name: "cosView", type: Dimensionless },
    { name: "cosSun", type: Dimensionless },
    { name: "cosViewSun", type: Dimensionless },
    { name: "rayLength", type: Length },
    { name: "viewRayIntersectsGround", type: "bool" }
  ]
})(([
  transmittanceTexture,
  radius,
  cosView,
  cosSun,
  cosViewSun,
  rayLength,
  viewRayIntersectsGround
], builder) => {
  const context = AtmosphereContextBaseNode.get(builder);
  const { bottomRadius, rayleighDensity, mieDensity } = context;
  const radiusEnd = clampRadius(
    sqrt2(
      rayLength.pow2().add(mul2(2, radius, cosView, rayLength)).add(radius.pow2())
    )
  ).toVar();
  const cosSunEnd = clampCosine(
    radius.mul(cosSun).add(rayLength.mul(cosViewSun)).div(radiusEnd)
  );
  const transmittance = getTransmittance(
    transmittanceTexture,
    radius,
    cosView,
    rayLength,
    viewRayIntersectsGround
  ).mul(getTransmittanceToSun(transmittanceTexture, radiusEnd, cosSunEnd)).toVar();
  const rayleigh = transmittance.mul(
    getProfileDensity(rayleighDensity, radiusEnd.sub(bottomRadius))
  );
  const mie = transmittance.mul(
    getProfileDensity(mieDensity, radiusEnd.sub(bottomRadius))
  );
  return singleScatteringStruct(rayleigh, mie);
});
var distanceToNearestAtmosphereBoundary = /* @__PURE__ */ FnLayout({
  name: "distanceToNearestAtmosphereBoundary",
  type: Length,
  inputs: [
    { name: "radius", type: Length },
    { name: "cosView", type: Dimensionless },
    { name: "viewRayIntersectsGround", type: "bool" }
  ]
})(([radius, cosView, viewRayIntersectsGround]) => {
  const result = float3().toVar();
  If2(viewRayIntersectsGround, () => {
    result.assign(distanceToBottomAtmosphereBoundary(radius, cosView));
  }).Else(() => {
    result.assign(distanceToTopAtmosphereBoundary(radius, cosView));
  });
  return result;
});
var computeSingleScattering = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // TODO: Fn layout doesn't support texture type
  name: "computeSingleScattering",
  type: singleScatteringStruct,
  inputs: [
    { name: "transmittanceTexture", type: TransmittanceTexture },
    { name: "radius", type: Length },
    { name: "cosView", type: Dimensionless },
    { name: "cosSun", type: Dimensionless },
    { name: "cosViewSun", type: Dimensionless },
    { name: "viewRayIntersectsGround", type: "bool" }
  ]
})(([
  transmittanceTexture,
  radius,
  cosView,
  cosSun,
  cosViewSun,
  viewRayIntersectsGround
], builder) => {
  const context = AtmosphereContextBaseNode.get(builder);
  const { solarIrradiance, rayleighScattering, mieScattering } = context;
  const sampleCount = 50;
  const stepSize = distanceToNearestAtmosphereBoundary(
    radius,
    cosView,
    viewRayIntersectsGround
  ).div(sampleCount).toVar();
  const rayleighSum = vec33(0).toVar();
  const mieSum = vec33(0).toVar();
  Loop({ start: 0, end: sampleCount, condition: "<=" }, ({ i }) => {
    const rayLength = float3(i).mul(stepSize).toVar();
    const deltaRayleighMie = computeSingleScatteringIntegrand(
      transmittanceTexture,
      radius,
      cosView,
      cosSun,
      cosViewSun,
      rayLength,
      viewRayIntersectsGround
    ).toVar();
    const deltaRayleigh = deltaRayleighMie.get("rayleigh");
    const deltaMie = deltaRayleighMie.get("mie");
    const weight = select2(equal(i, 0).or(equal(i, sampleCount)), 0.5, 1);
    rayleighSum.addAssign(deltaRayleigh.mul(weight));
    mieSum.addAssign(deltaMie.mul(weight));
  });
  const rayleigh = mul2(
    rayleighSum,
    stepSize,
    solarIrradiance,
    rayleighScattering
  );
  const mie = mul2(mieSum, stepSize, solarIrradiance, mieScattering);
  return singleScatteringStruct(rayleigh, mie);
});
var scatteringParamsStruct = /* @__PURE__ */ struct(
  {
    radius: Length,
    cosView: Dimensionless,
    cosSun: Dimensionless,
    cosViewSun: Dimensionless,
    viewRayIntersectsGround: "bool"
  },
  "scatteringParams"
);
var getParamsFromScatteringTextureCoord = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // BUG: Fails with the struct return type in WebGL
  name: "getParamsFromScatteringTextureCoord",
  type: scatteringParamsStruct,
  inputs: [{ name: "coord", type: "vec4" }]
})(([coord], builder) => {
  const context = AtmosphereContextBaseNode.get(builder);
  const { parameters, bottomRadius, topRadius, minCosSun } = context;
  const H = sqrt2(topRadius.pow2().sub(bottomRadius.pow2())).toVar();
  const distanceToHorizon = H.mul(
    getUnitRangeFromTextureCoord(
      coord.w,
      parameters.scatteringTextureRadiusSize
    )
  ).toVar();
  const radius = sqrt2(distanceToHorizon.pow2().add(bottomRadius.pow2()));
  const cosView = float3().toVar();
  const viewRayIntersectsGround = bool().toVar();
  If2(coord.z.lessThan(0.5), () => {
    const minDistance2 = radius.sub(bottomRadius).toVar();
    const maxDistance2 = distanceToHorizon;
    const distance2 = minDistance2.add(
      maxDistance2.sub(minDistance2).mul(
        getUnitRangeFromTextureCoord(
          coord.z.mul(2).oneMinus(),
          parameters.scatteringTextureCosViewSize / 2
        )
      )
    ).toVar();
    cosView.assign(
      select2(
        distance2.equal(0),
        -1,
        clampCosine(
          distanceToHorizon.pow2().add(distance2.pow2()).negate().div(mul2(2, radius, distance2))
        )
      )
    );
    viewRayIntersectsGround.assign(bool(true));
  }).Else(() => {
    const minDistance2 = topRadius.sub(radius).toVar();
    const maxDistance2 = distanceToHorizon.add(H);
    const distance2 = minDistance2.add(
      maxDistance2.sub(minDistance2).mul(
        getUnitRangeFromTextureCoord(
          coord.z.mul(2).sub(1),
          parameters.scatteringTextureCosViewSize / 2
        )
      )
    ).toVar();
    cosView.assign(
      select2(
        distance2.equal(0),
        1,
        clampCosine(
          H.pow2().sub(distanceToHorizon.pow2()).sub(distance2.pow2()).div(mul2(2, radius, distance2))
        )
      )
    );
    viewRayIntersectsGround.assign(bool(false));
  });
  const cosSunUnit = getUnitRangeFromTextureCoord(
    coord.y,
    parameters.scatteringTextureCosSunSize
  ).toVar();
  const minDistance = topRadius.sub(bottomRadius).toVar();
  const maxDistance = H;
  const D = distanceToTopAtmosphereBoundary(bottomRadius, minCosSun);
  const A = D.remap(minDistance, maxDistance).toVar();
  const a = A.sub(cosSunUnit.mul(A)).div(cosSunUnit.mul(A).add(1));
  const distance = minDistance.add(min2(a, A).mul(maxDistance.sub(minDistance))).toVar();
  const cosSun = select2(
    distance.equal(0),
    1,
    clampCosine(
      H.pow2().sub(distance.pow2()).div(mul2(2, bottomRadius, distance))
    )
  );
  const cosViewSun = clampCosine(coord.x.mul(2).sub(1));
  return scatteringParamsStruct(
    radius,
    cosView,
    cosSun,
    cosViewSun,
    viewRayIntersectsGround
  );
});
var getParamsFromScatteringTextureFragCoord = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // BUG: Fails with the struct return type in WebGL
  name: "getParamsFromScatteringTextureFragCoord",
  type: scatteringParamsStruct,
  inputs: [{ name: "fragCoord", type: "vec3" }]
})(([fragCoord], builder) => {
  const { parameters } = AtmosphereContextBaseNode.get(builder);
  const fragCoordCosViewSun = floor2(
    fragCoord.x.div(parameters.scatteringTextureCosSunSize)
  );
  const fragCoordCosSun = fragCoord.x.mod(
    parameters.scatteringTextureCosSunSize
  );
  const size = vec42(
    parameters.scatteringTextureCosViewSunSize - 1,
    parameters.scatteringTextureCosSunSize,
    parameters.scatteringTextureCosViewSize,
    parameters.scatteringTextureRadiusSize
  );
  const coord = vec42(
    fragCoordCosViewSun,
    fragCoordCosSun,
    fragCoord.y,
    fragCoord.z
  ).div(size);
  const scatteringParams = getParamsFromScatteringTextureCoord(coord).toVar();
  const radius = scatteringParams.get("radius");
  const cosView = scatteringParams.get("cosView");
  const cosSun = scatteringParams.get("cosSun");
  const cosViewSun = scatteringParams.get("cosViewSun");
  const viewRayIntersectsGround = scatteringParams.get(
    "viewRayIntersectsGround"
  );
  cosViewSun.assign(
    clamp2(
      cosViewSun,
      cosView.mul(cosSun).sub(sqrt2(cosView.pow2().oneMinus().mul(cosSun.pow2().oneMinus()))),
      cosView.mul(cosSun).add(sqrt2(cosView.pow2().oneMinus().mul(cosSun.pow2().oneMinus())))
    )
  );
  return scatteringParamsStruct(
    radius,
    cosView,
    cosSun,
    cosViewSun,
    viewRayIntersectsGround
  );
});
var computeSingleScatteringTexture = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // TODO: Fn layout doesn't support texture type
  name: "computeSingleScatteringTexture",
  type: singleScatteringStruct,
  inputs: [
    { name: "transmittanceTexture", type: TransmittanceTexture },
    { name: "fragCoord", type: "vec3" }
  ]
})(([transmittanceTexture, fragCoord]) => {
  const scatteringParams = getParamsFromScatteringTextureFragCoord(fragCoord).toVar();
  const radius = scatteringParams.get("radius");
  const cosView = scatteringParams.get("cosView");
  const cosSun = scatteringParams.get("cosSun");
  const cosViewSun = scatteringParams.get("cosViewSun");
  const viewRayIntersectsGround = scatteringParams.get(
    "viewRayIntersectsGround"
  );
  return computeSingleScattering(
    transmittanceTexture,
    radius,
    cosView,
    cosSun,
    cosViewSun,
    viewRayIntersectsGround
  );
});
var getScatteringForOrder = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // TODO: Fn layout doesn't support texture type
  name: "getScatteringForOrder",
  type: RadianceSpectrum,
  inputs: [
    { name: "singleRayleighScatteringTexture", type: ReducedScatteringTexture },
    { name: "singleMieScatteringTexture", type: ReducedScatteringTexture },
    { name: "multipleScatteringTexture", type: ScatteringTexture },
    { name: "radius", type: Length },
    { name: "cosView", type: Dimensionless },
    { name: "cosSun", type: Dimensionless },
    { name: "cosViewSun", type: Dimensionless },
    { name: "viewRayIntersectsGround", type: "bool" },
    { name: "scatteringOrder", type: "int" }
  ]
})(([
  singleRayleighScatteringTexture,
  singleMieScatteringTexture,
  multipleScatteringTexture,
  radius,
  cosView,
  cosSun,
  cosViewSun,
  viewRayIntersectsGround,
  scatteringOrder
], builder) => {
  const context = AtmosphereContextBaseNode.get(builder);
  const { miePhaseFunctionG } = context;
  const result = vec33().toVar();
  If2(scatteringOrder.equal(1), () => {
    const rayleigh = getScattering(
      singleRayleighScatteringTexture,
      radius,
      cosView,
      cosSun,
      cosViewSun,
      viewRayIntersectsGround
    );
    const mie = getScattering(
      singleMieScatteringTexture,
      radius,
      cosView,
      cosSun,
      cosViewSun,
      viewRayIntersectsGround
    );
    result.assign(
      add(
        rayleigh.mul(rayleighPhaseFunction(cosViewSun)),
        mie.mul(miePhaseFunction(miePhaseFunctionG, cosViewSun))
      )
    );
  }).Else(() => {
    result.assign(
      getScattering(
        multipleScatteringTexture,
        radius,
        cosView,
        cosSun,
        cosViewSun,
        viewRayIntersectsGround
      )
    );
  });
  return result;
});
var computeScatteringDensity = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // TODO: Fn layout doesn't support texture type
  name: "computeScatteringDensity",
  type: RadianceDensitySpectrum,
  inputs: [
    { name: "transmittanceTexture", type: TransmittanceTexture },
    { name: "singleRayleighScatteringTexture", type: ReducedScatteringTexture },
    { name: "singleMieScatteringTexture", type: ReducedScatteringTexture },
    { name: "multipleScatteringTexture", type: ScatteringTexture },
    { name: "irradianceTexture", type: IrradianceTexture },
    { name: "radius", type: Length },
    { name: "cosView", type: Dimensionless },
    { name: "cosSun", type: Dimensionless },
    { name: "cosViewSun", type: Dimensionless },
    { name: "scatteringOrder", type: "int" }
  ]
})(([
  transmittanceTexture,
  singleRayleighScatteringTexture,
  singleMieScatteringTexture,
  multipleScatteringTexture,
  irradianceTexture,
  radius,
  cosView,
  cosSun,
  cosViewSun,
  scatteringOrder
], builder) => {
  const context = AtmosphereContextBaseNode.get(builder);
  const {
    bottomRadius,
    rayleighDensity,
    rayleighScattering,
    mieDensity,
    mieScattering,
    miePhaseFunctionG
  } = context;
  const zenithDirection = vec33(0, 0, 1);
  const omega = vec33(sqrt2(cosView.pow2().oneMinus()), 0, cosView).toVar();
  const sunDirectionX = select2(
    omega.x.equal(0),
    0,
    cosViewSun.sub(cosView.mul(cosSun)).div(omega.x)
  ).toVar();
  const sunDirectionY = sqrt2(
    max2(sunDirectionX.pow2().add(cosSun.pow2()).oneMinus(), 0)
  );
  const omegaSun = vec33(sunDirectionX, sunDirectionY, cosSun).toVar();
  const sampleCount = 16;
  const deltaPhi = Math.PI / sampleCount;
  const deltaTheta = Math.PI / sampleCount;
  const radiance = vec33(0).toVar();
  Loop({ start: 0, end: sampleCount, name: "l" }, ({ l }) => {
    const theta = float3(l).add(0.5).mul(deltaTheta).toVar();
    const cosTheta = cos(theta).toVar();
    const sinTheta = sin(theta).toVar();
    const omegaRayIntersectsGround = rayIntersectsGround(
      radius,
      cosTheta
    ).toVar();
    const distanceToGround = float3(0).toVar();
    const transmittanceToGround = vec33(0).toVar();
    const groundAlbedo = vec33(0).toVar();
    If2(omegaRayIntersectsGround, () => {
      distanceToGround.assign(
        distanceToBottomAtmosphereBoundary(radius, cosTheta)
      );
      transmittanceToGround.assign(
        getTransmittance(
          transmittanceTexture,
          radius,
          cosTheta,
          distanceToGround,
          bool(true)
        )
      );
      groundAlbedo.assign(context.groundAlbedo);
    });
    Loop({ start: 0, end: mul2(sampleCount, 2), name: "m" }, ({ m }) => {
      const phi = float3(m).add(0.5).mul(deltaPhi).toVar();
      const omegaI = vec33(
        cos(phi).mul(sinTheta),
        sin(phi).mul(sinTheta),
        cosTheta
      ).toVar();
      const deltaOmegaI = sin(theta).mul(deltaTheta).mul(deltaPhi).toVar();
      const cosViewSun1 = omegaSun.dot(omegaI);
      const incidentRadiance = getScatteringForOrder(
        singleRayleighScatteringTexture,
        singleMieScatteringTexture,
        multipleScatteringTexture,
        radius,
        omegaI.z,
        cosSun,
        cosViewSun1,
        omegaRayIntersectsGround,
        scatteringOrder.sub(1)
      ).toVar();
      const groundNormal = zenithDirection.mul(radius).add(omegaI.mul(distanceToGround)).normalize();
      const groundIrradiance = getIrradiance(
        irradianceTexture,
        bottomRadius,
        groundNormal.dot(omegaSun)
      );
      incidentRadiance.addAssign(
        transmittanceToGround.mul(groundAlbedo).div(PI2).mul(groundIrradiance)
      );
      const cosViewSun2 = omega.dot(omegaI).toVar();
      const rayleighDensityValue = getProfileDensity(
        rayleighDensity,
        radius.sub(bottomRadius)
      );
      const mieDensityValue = getProfileDensity(
        mieDensity,
        radius.sub(bottomRadius)
      );
      radiance.addAssign(
        incidentRadiance.mul(
          add(
            mul2(
              rayleighScattering,
              rayleighDensityValue,
              rayleighPhaseFunction(cosViewSun2)
            ),
            mul2(
              mieScattering,
              mieDensityValue,
              miePhaseFunction(miePhaseFunctionG, cosViewSun2)
            )
          ),
          deltaOmegaI
        )
      );
    });
  });
  return radiance;
});
var computeMultipleScattering = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // TODO: Fn layout doesn't support texture type
  name: "computeMultipleScattering",
  type: RadianceSpectrum,
  inputs: [
    { name: "transmittanceTexture", type: TransmittanceTexture },
    { name: "scatteringDensityTexture", type: ScatteringDensityTexture },
    { name: "radius", type: Length },
    { name: "cosView", type: Dimensionless },
    { name: "cosSun", type: Dimensionless },
    { name: "cosViewSun", type: Dimensionless },
    { name: "viewRayIntersectsGround", type: "bool" }
  ]
})(([
  transmittanceTexture,
  scatteringDensityTexture,
  radius,
  cosView,
  cosSun,
  cosViewSun,
  viewRayIntersectsGround
]) => {
  const sampleCount = 50;
  const stepSize = distanceToNearestAtmosphereBoundary(
    radius,
    cosView,
    viewRayIntersectsGround
  ).div(sampleCount).toVar();
  const radianceSum = vec33(0).toVar();
  Loop({ start: 0, end: sampleCount, condition: "<=" }, ({ i }) => {
    const rayLength = float3(i).mul(stepSize).toVar();
    const radiusI = clampRadius(
      sqrt2(
        rayLength.pow2().add(mul2(2, radius, cosView, rayLength)).add(radius.pow2())
      )
    );
    const cosViewI = clampCosine(
      radius.mul(cosView).add(rayLength).div(radiusI)
    );
    const cosSunI = clampCosine(
      radius.mul(cosSun).add(rayLength.mul(cosViewSun)).div(radiusI)
    );
    const radiance = getScattering(
      scatteringDensityTexture,
      radiusI,
      cosViewI,
      cosSunI,
      cosViewSun,
      viewRayIntersectsGround
    ).mul(
      getTransmittance(
        transmittanceTexture,
        radius,
        cosView,
        rayLength,
        viewRayIntersectsGround
      )
    ).mul(stepSize);
    const weight = select2(equal(i, 0).or(equal(i, sampleCount)), 0.5, 1);
    radianceSum.addAssign(radiance.mul(weight));
  });
  return radianceSum;
});
var computeScatteringDensityTexture = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // TODO: Fn layout doesn't support texture type
  name: "computeScatteringDensityTexture",
  type: RadianceDensitySpectrum,
  inputs: [
    { name: "transmittanceTexture", type: TransmittanceTexture },
    { name: "singleRayleighScatteringTexture", type: ReducedScatteringTexture },
    { name: "singleMieScatteringTexture", type: ReducedScatteringTexture },
    { name: "multipleScatteringTexture", type: ScatteringTexture },
    { name: "irradianceTexture", type: IrradianceTexture },
    { name: "fragCoord", type: "vec3" },
    { name: "scatteringOrder", type: "int" }
  ]
})(([
  transmittanceTexture,
  singleRayleighScatteringTexture,
  singleMieScatteringTexture,
  multipleScatteringTexture,
  irradianceTexture,
  fragCoord,
  scatteringOrder
]) => {
  const scatteringParams = getParamsFromScatteringTextureFragCoord(fragCoord).toVar();
  const radius = scatteringParams.get("radius");
  const cosView = scatteringParams.get("cosView");
  const cosSun = scatteringParams.get("cosSun");
  const cosViewSun = scatteringParams.get("cosViewSun");
  return computeScatteringDensity(
    transmittanceTexture,
    singleRayleighScatteringTexture,
    singleMieScatteringTexture,
    multipleScatteringTexture,
    irradianceTexture,
    radius,
    cosView,
    cosSun,
    cosViewSun,
    scatteringOrder
  );
});
var multipleScatteringStruct = /* @__PURE__ */ struct(
  {
    radiance: RadianceSpectrum,
    cosViewSun: Dimensionless
  },
  "multipleScattering"
);
var computeMultipleScatteringTexture = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // TODO: Fn layout doesn't support texture type
  name: "computeMultipleScatteringTexture",
  type: multipleScatteringStruct,
  inputs: [
    { name: "transmittanceTexture", type: TransmittanceTexture },
    { name: "scatteringDensityTexture", type: ScatteringDensityTexture },
    { name: "fragCoord", type: "vec3" }
  ]
})(([transmittanceTexture, scatteringDensityTexture, fragCoord]) => {
  const scatteringParams = getParamsFromScatteringTextureFragCoord(fragCoord).toVar();
  const radius = scatteringParams.get("radius");
  const cosView = scatteringParams.get("cosView");
  const cosSun = scatteringParams.get("cosSun");
  const cosViewSun = scatteringParams.get("cosViewSun");
  const viewRayIntersectsGround = scatteringParams.get(
    "viewRayIntersectsGround"
  );
  const radiance = computeMultipleScattering(
    transmittanceTexture,
    scatteringDensityTexture,
    radius,
    cosView,
    cosSun,
    cosViewSun,
    viewRayIntersectsGround
  );
  return multipleScatteringStruct(radiance, cosViewSun);
});
var computeDirectIrradiance = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // TODO: Fn layout doesn't support texture type
  name: "computeDirectIrradiance",
  type: IrradianceSpectrum,
  inputs: [
    { name: "transmittanceTexture", type: TransmittanceTexture },
    { name: "radius", type: Length },
    { name: "cosSun", type: Dimensionless }
  ]
})(([transmittanceTexture, radius, cosSun], builder) => {
  const context = AtmosphereContextBaseNode.get(builder);
  const { solarIrradiance, sunAngularRadius } = context;
  const alpha = sunAngularRadius;
  const averageCosineFactor = select2(
    cosSun.lessThan(alpha.negate()),
    0,
    select2(
      cosSun.greaterThan(alpha),
      cosSun,
      cosSun.add(alpha).pow2().div(alpha.mul(4))
    )
  );
  return solarIrradiance.mul(
    getTransmittanceToTopAtmosphereBoundary(
      transmittanceTexture,
      radius,
      cosSun
    )
  ).mul(averageCosineFactor);
});
var computeIndirectIrradiance = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // TODO: Fn layout doesn't support texture type
  name: "computeIndirectIrradiance",
  type: IrradianceSpectrum,
  inputs: [
    { name: "singleRayleighScatteringTexture", type: ReducedScatteringTexture },
    { name: "singleMieScatteringTexture", type: ReducedScatteringTexture },
    { name: "multipleScatteringTexture", type: ScatteringTexture },
    { name: "radius", type: Length },
    { name: "cosSun", type: Dimensionless },
    { name: "scatteringOrder", type: "int" }
  ]
})(([
  singleRayleighScatteringTexture,
  singleMieScatteringTexture,
  multipleScatteringTexture,
  radius,
  cosSun,
  scatteringOrder
]) => {
  const sampleCount = 32;
  const deltaPhi = Math.PI / sampleCount;
  const deltaTheta = Math.PI / sampleCount;
  const result = vec33(0).toVar();
  const omegaSun = vec33(sqrt2(cosSun.pow2().oneMinus()), 0, cosSun).toVar();
  Loop({ start: 0, end: sampleCount / 2, name: "j" }, ({ j }) => {
    const theta = float3(j).add(0.5).mul(deltaTheta).toVar();
    Loop({ start: 0, end: sampleCount * 2 }, ({ i }) => {
      const phi = float3(i).add(0.5).mul(deltaPhi).toVar();
      const omega = vec33(
        cos(phi).mul(sin(theta)),
        sin(phi).mul(sin(theta)),
        cos(theta)
      ).toVar();
      const deltaOmega = sin(theta).mul(deltaTheta * deltaPhi);
      const cosViewSun = omega.dot(omegaSun);
      result.addAssign(
        getScatteringForOrder(
          singleRayleighScatteringTexture,
          singleMieScatteringTexture,
          multipleScatteringTexture,
          radius,
          omega.z,
          cosSun,
          cosViewSun,
          bool(false),
          scatteringOrder
        ).mul(omega.z).mul(deltaOmega)
      );
    });
  });
  return result;
});
var irradianceParamsStruct = /* @__PURE__ */ struct(
  {
    radius: Length,
    cosSun: Dimensionless
  },
  "irradianceParams"
);
var getParamsFromIrradianceTextureUV = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // BUG: Fails with the struct return type in WebGL
  name: "getParamsFromIrradianceTextureUV",
  type: irradianceParamsStruct,
  inputs: [{ name: "uv", type: "vec2" }]
})(([uv], builder) => {
  const context = AtmosphereContextBaseNode.get(builder);
  const { parameters, topRadius, bottomRadius } = context;
  const cosSunUnit = getUnitRangeFromTextureCoord(
    uv.x,
    parameters.irradianceTextureSize.x
  );
  const radiusUnit = getUnitRangeFromTextureCoord(
    uv.y,
    parameters.irradianceTextureSize.y
  );
  const radius = bottomRadius.add(radiusUnit.mul(topRadius.sub(bottomRadius)));
  const cosSun = clampCosine(cosSunUnit.mul(2).sub(1));
  return irradianceParamsStruct(radius, cosSun);
});
var computeDirectIrradianceTexture = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // TODO: Fn layout doesn't support texture type
  name: "computeDirectIrradianceTexture",
  type: IrradianceSpectrum,
  inputs: [
    { name: "transmittanceTexture", type: TransmittanceTexture },
    { name: "fragCoord", type: "vec2" }
  ]
})(([transmittanceTexture, fragCoord], builder) => {
  const { parameters } = AtmosphereContextBaseNode.get(builder);
  const irradianceParams = getParamsFromIrradianceTextureUV(
    fragCoord.div(vec22(parameters.irradianceTextureSize))
  ).toVar();
  const radius = irradianceParams.get("radius");
  const cosSun = irradianceParams.get("cosSun");
  return computeDirectIrradiance(transmittanceTexture, radius, cosSun);
});
var computeIndirectIrradianceTexture = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // TODO: Fn layout doesn't support texture type
  name: "computeIndirectIrradianceTexture",
  type: IrradianceSpectrum,
  inputs: [
    { name: "singleRayleighScatteringTexture", type: ReducedScatteringTexture },
    { name: "singleMieScatteringTexture", type: ReducedScatteringTexture },
    { name: "multipleScatteringTexture", type: ScatteringTexture },
    { name: "fragCoord", type: "vec2" },
    { name: "scatteringOrder", type: "int" }
  ]
})(([
  singleRayleighScatteringTexture,
  singleMieScatteringTexture,
  multipleScatteringTexture,
  fragCoord,
  scatteringOrder
], builder) => {
  const { parameters } = AtmosphereContextBaseNode.get(builder);
  const irradianceParams = getParamsFromIrradianceTextureUV(
    fragCoord.div(vec22(parameters.irradianceTextureSize))
  ).toVar();
  const radius = irradianceParams.get("radius");
  const cosSun = irradianceParams.get("cosSun");
  return computeIndirectIrradiance(
    singleRayleighScatteringTexture,
    singleMieScatteringTexture,
    multipleScatteringTexture,
    radius,
    cosSun,
    scatteringOrder
  );
});

// src/bruneton/AtmosphereLUTTexturesWebGPU.ts
function createStorageTexture(name) {
  const texture2 = new StorageTexture(1, 1);
  texture2.minFilter = LinearFilter;
  texture2.magFilter = LinearFilter;
  texture2.colorSpace = NoColorSpace;
  texture2.generateMipmaps = false;
  texture2.name = name;
  return texture2;
}
function createStorage3DTexture(name) {
  const texture2 = new Storage3DTexture(1, 1, 1);
  texture2.minFilter = LinearFilter;
  texture2.magFilter = LinearFilter;
  texture2.colorSpace = NoColorSpace;
  texture2.generateMipmaps = false;
  texture2.name = name;
  return texture2;
}
function createReadTexture(name) {
  const texture2 = new DataTexture();
  texture2.minFilter = LinearFilter;
  texture2.magFilter = LinearFilter;
  texture2.colorSpace = NoColorSpace;
  texture2.generateMipmaps = false;
  texture2.name = name;
  return texture2;
}
function createRead3DTexture(name) {
  const texture2 = new Data3DTexture(null, 1, 1, 1);
  texture2.minFilter = LinearFilter;
  texture2.magFilter = LinearFilter;
  texture2.colorSpace = NoColorSpace;
  texture2.generateMipmaps = false;
  texture2.name = name;
  return texture2;
}
function setupStorageTexture(texture2, textureType, size) {
  texture2.type = textureType;
  reinterpretType(texture2.image);
  texture2.image.width = size.x;
  texture2.image.height = size.y;
}
function setupReadTexture(texture2, textureType, size) {
  texture2.type = textureType;
  reinterpretType(texture2.image);
  texture2.image.width = size.x;
  texture2.image.height = size.y;
  texture2.source.dataReady = false;
  texture2.needsUpdate = true;
}
function setupStorage3DTexture(texture2, textureType, size) {
  texture2.type = textureType;
  reinterpretType(texture2.image);
  texture2.image.width = size.x;
  texture2.image.height = size.y;
  texture2.image.depth = size.z;
}
function setupRead3DTexture(texture2, textureType, size) {
  texture2.type = textureType;
  reinterpretType(texture2.image);
  texture2.image.width = size.x;
  texture2.image.height = size.y;
  texture2.image.depth = size.z;
  texture2.source.dataReady = false;
  texture2.needsUpdate = true;
}
var AtmosphereLUTTexturesContextWebGPU = class extends AtmosphereLUTTexturesContext {
  opticalDepth = createStorageTexture("opticalDepth");
  deltaIrradiance = createStorageTexture("deltaIrradiance");
  deltaRayleighScattering = createStorage3DTexture("deltaRayleighScattering");
  deltaMieScattering = createStorage3DTexture("deltaMieScattering");
  deltaScatteringDensity = createStorage3DTexture("deltaScatteringDensity");
  irradianceRead = createReadTexture("irradianceRead");
  scatteringRead = createRead3DTexture("scatteringRead");
  higherOrderScatteringRead = createRead3DTexture("higherOrderScatteringRead");
  // deltaMultipleScattering is only needed to compute scattering order 3 or
  // more, while deltaRayleighScattering and deltaMieScattering are only needed
  // to compute double scattering. Therefore, to save memory, we can store
  // deltaRayleighScattering and deltaMultipleScattering in the same GPU
  // texture.
  deltaMultipleScattering = this.deltaRayleighScattering;
  constructor(parameters, textureType) {
    super(parameters, textureType);
    if (parameters.transmittancePrecisionLog) {
      setupStorageTexture(
        this.opticalDepth,
        textureType,
        parameters.transmittanceTextureSize
      );
    }
    setupStorageTexture(
      this.deltaIrradiance,
      textureType,
      parameters.irradianceTextureSize
    );
    setupStorage3DTexture(
      this.deltaRayleighScattering,
      textureType,
      parameters.scatteringTextureSize
    );
    setupStorage3DTexture(
      this.deltaMieScattering,
      textureType,
      parameters.scatteringTextureSize
    );
    setupStorage3DTexture(
      this.deltaScatteringDensity,
      textureType,
      parameters.scatteringTextureSize
    );
    setupReadTexture(
      this.irradianceRead,
      textureType,
      parameters.irradianceTextureSize
    );
    setupRead3DTexture(
      this.scatteringRead,
      textureType,
      parameters.scatteringTextureSize
    );
    setupRead3DTexture(
      this.higherOrderScatteringRead,
      textureType,
      parameters.scatteringTextureSize
    );
  }
  dispose() {
    this.opticalDepth.dispose();
    this.deltaIrradiance.dispose();
    this.deltaRayleighScattering.dispose();
    this.deltaMieScattering.dispose();
    this.deltaScatteringDensity.dispose();
    this.irradianceRead.dispose();
    this.scatteringRead.dispose();
    this.higherOrderScatteringRead.dispose();
    super.dispose();
  }
};
var boxScratch = /* @__PURE__ */ new Box3();
var AtmosphereLUTTexturesWebGPU = class extends AtmosphereLUTTextures {
  transmittance = createStorageTexture("transmittance");
  irradiance = createStorageTexture("irradiance");
  scattering = createStorage3DTexture("scattering");
  singleMieScattering = createStorage3DTexture(
    "singleMieScattering"
  );
  higherOrderScattering = createStorage3DTexture(
    "higherOrderScattering"
  );
  transmittanceNode;
  directIrradianceNode;
  singleScatteringNode;
  scatteringDensityNode;
  indirectIrradianceNode;
  multipleScatteringNode;
  scatteringOrder = uniform2(0);
  invalidateComputeNodes() {
    this.transmittanceNode = void 0;
    this.directIrradianceNode = void 0;
    this.singleScatteringNode = void 0;
    this.scatteringDensityNode = void 0;
    this.indirectIrradianceNode = void 0;
    this.multipleScatteringNode = void 0;
  }
  get(name) {
    return this[name];
  }
  createContext() {
    if (this.parameters == null || this.textureType == null) {
      throw new Error(
        "AtmosphereLUTTexturesWebGPU must be setup() before createContext()."
      );
    }
    return new AtmosphereLUTTexturesContextWebGPU(
      this.parameters,
      this.textureType
    );
  }
  computeTransmittance(renderer, context) {
    const { parameters, opticalDepth } = context;
    const { x: width, y: height } = parameters.transmittanceTextureSize;
    this.transmittanceNode ??= Fn3(() => {
      const size = uvec2(width, height);
      If3(globalId.xy.greaterThanEqual(size).any(), () => {
        Return();
      });
      const transmittance = computeTransmittanceToTopAtmosphereBoundaryTexture(
        vec23(globalId.xy).add(0.5)
      );
      if (parameters.transmittancePrecisionLog) {
        textureStore(
          this.transmittance,
          globalId.xy,
          exp3(transmittance.negate())
        );
        textureStore(opticalDepth, globalId.xy, transmittance);
      } else {
        textureStore(this.transmittance, globalId.xy, transmittance);
      }
    })().context({ atmosphere: context }).compute(
      // @ts-expect-error "count" can be dimensional
      [Math.ceil(width / 8), Math.ceil(height / 8), 1],
      [8, 8, 1]
    ).setName("transmittance");
    void renderer.compute(this.transmittanceNode);
  }
  computeDirectIrradiance(renderer, context) {
    const { parameters, deltaIrradiance, opticalDepth } = context;
    const { x: width, y: height } = parameters.irradianceTextureSize;
    this.directIrradianceNode ??= Fn3(() => {
      const size = uvec2(width, height);
      If3(globalId.xy.greaterThanEqual(size).any(), () => {
        Return();
      });
      const irradiance = computeDirectIrradianceTexture(
        texture(
          parameters.transmittancePrecisionLog ? opticalDepth : this.transmittance
        ),
        vec23(globalId.xy).add(0.5)
      );
      textureStore(this.irradiance, globalId.xy, vec43(vec34(0), 1));
      textureStore(deltaIrradiance, globalId.xy, vec43(irradiance, 1));
    })().context({ atmosphere: context }).compute(
      // @ts-expect-error "count" can be dimensional
      [Math.ceil(width / 8), Math.ceil(height / 8), 1],
      [8, 8, 1]
    ).setName("directIrradiance");
    void renderer.compute(this.directIrradianceNode);
  }
  computeSingleScattering(renderer, context) {
    const {
      parameters,
      luminanceFromRadiance,
      deltaRayleighScattering,
      deltaMieScattering,
      opticalDepth
    } = context;
    const { x: width, y: height, z: depth } = parameters.scatteringTextureSize;
    this.singleScatteringNode ??= Fn3(() => {
      const size = uvec3(width, height, depth);
      If3(globalId.greaterThanEqual(size).any(), () => {
        Return();
      });
      const singleScattering = computeSingleScatteringTexture(
        texture(
          parameters.transmittancePrecisionLog ? opticalDepth : this.transmittance
        ),
        vec34(globalId).add(0.5)
      );
      const rayleigh = singleScattering.get("rayleigh");
      const mie = singleScattering.get("mie");
      textureStore(
        this.scattering,
        globalId,
        vec43(
          rayleigh.mul(luminanceFromRadiance),
          mie.mul(luminanceFromRadiance).r
        )
      );
      textureStore(deltaRayleighScattering, globalId, vec43(rayleigh, 1));
      textureStore(
        deltaMieScattering,
        globalId,
        vec43(mie.mul(luminanceFromRadiance), 1)
      );
    })().context({ atmosphere: context }).compute(
      // @ts-expect-error "count" can be dimensional
      [Math.ceil(width / 4), Math.ceil(height / 4), Math.ceil(depth / 4)],
      [4, 4, 4]
    ).setName("singleScattering");
    void renderer.compute(this.singleScatteringNode);
    if (!parameters.combinedScatteringTextures) {
      renderer.copyTextureToTexture(
        deltaMieScattering,
        this.singleMieScattering,
        boxScratch.set(
          boxScratch.min.setScalar(0),
          parameters.scatteringTextureSize
        )
      );
    }
  }
  computeScatteringDensity(renderer, context, scatteringOrder) {
    const {
      parameters,
      deltaIrradiance,
      deltaRayleighScattering,
      deltaMieScattering,
      deltaScatteringDensity,
      deltaMultipleScattering,
      opticalDepth
    } = context;
    const { x: width, y: height, z: depth } = parameters.scatteringTextureSize;
    this.scatteringDensityNode ??= Fn3(() => {
      const size = uvec3(width, height, depth);
      If3(globalId.greaterThanEqual(size).any(), () => {
        Return();
      });
      const radiance = computeScatteringDensityTexture(
        texture(
          parameters.transmittancePrecisionLog ? opticalDepth : this.transmittance
        ),
        texture3D(deltaRayleighScattering),
        texture3D(deltaMieScattering),
        texture3D(deltaMultipleScattering),
        texture(deltaIrradiance),
        vec34(globalId).add(0.5),
        int(this.scatteringOrder)
      );
      textureStore(deltaScatteringDensity, globalId, radiance);
    })().context({ atmosphere: context }).compute(
      // @ts-expect-error "count" can be dimensional
      [Math.ceil(width / 4), Math.ceil(height / 4), Math.ceil(depth / 4)],
      [4, 4, 4]
    ).setName("scatteringDensity");
    this.scatteringOrder.value = scatteringOrder;
    void renderer.compute(this.scatteringDensityNode);
  }
  computeIndirectIrradiance(renderer, context, scatteringOrder) {
    const {
      parameters,
      luminanceFromRadiance,
      deltaIrradiance,
      deltaRayleighScattering,
      deltaMieScattering,
      deltaMultipleScattering,
      irradianceRead
    } = context;
    const { x: width, y: height } = parameters.irradianceTextureSize;
    renderer.initTexture(irradianceRead);
    renderer.copyTextureToTexture(this.irradiance, irradianceRead);
    this.indirectIrradianceNode ??= Fn3(() => {
      const size = uvec2(width, height);
      If3(globalId.xy.greaterThanEqual(size).any(), () => {
        Return();
      });
      const irradiance = computeIndirectIrradianceTexture(
        texture3D(deltaRayleighScattering),
        texture3D(deltaMieScattering),
        texture3D(deltaMultipleScattering),
        vec23(globalId.xy).add(0.5),
        int(this.scatteringOrder.sub(1))
      );
      textureStore(
        this.irradiance,
        globalId.xy,
        textureLoad(irradianceRead, globalId.xy, int(0)).add(
          irradiance.mul(luminanceFromRadiance)
        )
      );
      textureStore(deltaIrradiance, globalId.xy, irradiance);
    })().context({ atmosphere: context }).compute(
      // @ts-expect-error "count" can be dimensional
      [Math.ceil(width / 8), Math.ceil(height / 8), 1],
      [8, 8, 1]
    ).setName("indirectIrradiance");
    this.scatteringOrder.value = scatteringOrder;
    void renderer.compute(this.indirectIrradianceNode);
  }
  computeMultipleScattering(renderer, context) {
    const {
      parameters,
      luminanceFromRadiance,
      deltaScatteringDensity,
      deltaMultipleScattering,
      opticalDepth,
      scatteringRead,
      higherOrderScatteringRead
    } = context;
    const { x: width, y: height, z: depth } = parameters.scatteringTextureSize;
    renderer.initTexture(scatteringRead);
    renderer.initTexture(higherOrderScatteringRead);
    renderer.copyTextureToTexture(
      this.scattering,
      scatteringRead,
      boxScratch.set(
        boxScratch.min.setScalar(0),
        parameters.scatteringTextureSize
      )
    );
    renderer.copyTextureToTexture(
      this.higherOrderScattering,
      higherOrderScatteringRead,
      boxScratch.set(
        boxScratch.min.setScalar(0),
        parameters.scatteringTextureSize
      )
    );
    this.multipleScatteringNode ??= Fn3(() => {
      const size = uvec3(width, height, depth);
      If3(globalId.greaterThanEqual(size).any(), () => {
        Return();
      });
      const multipleScattering = computeMultipleScatteringTexture(
        texture(
          parameters.transmittancePrecisionLog ? opticalDepth : this.transmittance
        ),
        texture3D(deltaScatteringDensity),
        vec34(globalId).add(0.5)
      );
      const radiance = multipleScattering.get("radiance");
      const cosViewSun = multipleScattering.get("cosViewSun");
      const luminance = radiance.mul(luminanceFromRadiance).div(rayleighPhaseFunction(cosViewSun));
      textureStore(
        this.scattering,
        globalId,
        texture3D(scatteringRead, vec34(globalId), int(0)).setSampler(false).add(vec43(luminance, 0))
      );
      textureStore(deltaMultipleScattering, globalId, vec43(radiance, 1));
      if (parameters.higherOrderScatteringTexture) {
        textureStore(
          this.higherOrderScattering,
          globalId,
          texture3D(higherOrderScatteringRead, vec34(globalId), int(0)).setSampler(false).add(vec43(luminance, 1))
        );
      }
    })().context({ atmosphere: context }).compute(
      // @ts-expect-error "count" can be dimensional
      [Math.ceil(width / 4), Math.ceil(height / 4), Math.ceil(depth / 4)],
      [4, 4, 4]
    ).setName("multipleScattering");
    void renderer.compute(this.multipleScatteringNode);
  }
  setup(parameters, textureType) {
    setupStorageTexture(
      this.transmittance,
      textureType,
      parameters.transmittanceTextureSize
    );
    setupStorageTexture(
      this.irradiance,
      textureType,
      parameters.irradianceTextureSize
    );
    setupStorage3DTexture(
      this.scattering,
      textureType,
      parameters.scatteringTextureSize
    );
    if (!parameters.combinedScatteringTextures) {
      setupStorage3DTexture(
        this.singleMieScattering,
        textureType,
        parameters.scatteringTextureSize
      );
    }
    if (parameters.higherOrderScatteringTexture) {
      setupStorage3DTexture(
        this.higherOrderScattering,
        textureType,
        parameters.scatteringTextureSize
      );
    }
    super.setup(parameters, textureType);
  }
  dispose() {
    this.transmittance.dispose();
    this.irradiance.dispose();
    this.scattering.dispose();
    this.singleMieScattering.dispose();
    this.higherOrderScattering.dispose();
    super.dispose();
  }
};

// src/bruneton/AtmosphereLUTNode.ts
var { resetRendererState, restoreRendererState } = RendererUtils;
async function timeSlice(iterable) {
  const iterator = iterable[Symbol.iterator]();
  return await new Promise((resolve, reject) => {
    const callback = () => {
      try {
        const { value, done } = iterator.next();
        if (done === true) {
          resolve(value);
        } else {
          requestIdleCallback(callback);
        }
      } catch (error) {
        reject(error instanceof Error ? error : new Error());
      }
    };
    requestIdleCallback(callback);
  });
}
var rendererState;
function run(renderer, task) {
  rendererState = resetRendererState(renderer, rendererState);
  renderer.setClearColor(0, 0);
  renderer.autoClear = false;
  task();
  restoreRendererState(renderer, rendererState);
  return true;
}
var emptyTexture = /* @__PURE__ */ new Texture();
var emptyTexture3D = /* @__PURE__ */ new Data3DTexture2();
var AtmosphereLUTNode = class extends Node {
  static get type() {
    return "AtmosphereLUTNode";
  }
  parameters;
  textureType;
  textures;
  textureNodes = {
    transmittance: outputTexture(this, emptyTexture),
    irradiance: outputTexture(this, emptyTexture),
    scattering: outputTexture3D(this, emptyTexture3D),
    singleMieScattering: outputTexture3D(this, emptyTexture3D),
    higherOrderScattering: outputTexture3D(this, emptyTexture3D)
  };
  currentVersion;
  updating = false;
  disposeQueue;
  resolvedTextureType;
  pendingParameters;
  constructor(parameters = new AtmosphereParameters(), textureType) {
    super(null);
    this.parameters = parameters;
    this.textureType = textureType;
    this.updateBeforeType = NodeUpdateType.FRAME;
  }
  configure(parameters) {
    if (this.updating) {
      this.pendingParameters = parameters;
      return;
    }
    this.applyParameters(parameters);
    this.needsUpdate = true;
  }
  applyParameters(parameters) {
    this.parameters = parameters;
    if (this.textures == null || this.resolvedTextureType == null) {
      return;
    }
    const nextParameters = parameters.clone();
    nextParameters.transmittancePrecisionLog = this.resolvedTextureType === HalfFloatType;
    this.textures.setup(nextParameters, this.resolvedTextureType);
    if (this.textures instanceof AtmosphereLUTTexturesWebGPU) {
      this.textures.invalidateComputeNodes();
    }
  }
  ensureInitialized(renderer) {
    if (this.textures == null) {
      this.textures = new AtmosphereLUTTexturesWebGPU();
      const {
        transmittance,
        irradiance,
        scattering,
        singleMieScattering,
        higherOrderScattering
      } = this.textureNodes;
      transmittance.value = this.textures.get("transmittance");
      irradiance.value = this.textures.get("irradiance");
      scattering.value = this.textures.get("scattering");
      singleMieScattering.value = this.textures.get("singleMieScattering");
      higherOrderScattering.value = this.textures.get("higherOrderScattering");
    }
    const textureType = isFloatLinearSupported(renderer) ? this.textureType ?? FloatType : HalfFloatType;
    if (this.resolvedTextureType !== textureType) {
      this.resolvedTextureType = textureType;
    }
    const parameters = this.parameters.clone();
    parameters.transmittancePrecisionLog = textureType === HalfFloatType;
    this.textures.setup(parameters, textureType);
  }
  getTextureNode(name) {
    return this.textureNodes[name];
  }
  *performCompute(renderer, context) {
    const { textures } = this;
    if (textures == null) {
      throw new Error("AtmosphereLUTNode textures were not initialized.");
    }
    yield run(renderer, () => {
      textures.computeTransmittance(renderer, context);
    });
    yield run(renderer, () => {
      textures.computeDirectIrradiance(renderer, context);
    });
    yield run(renderer, () => {
      textures.computeSingleScattering(renderer, context);
    });
    for (let scatteringOrder = 2; scatteringOrder <= 4; ++scatteringOrder) {
      yield run(renderer, () => {
        textures.computeScatteringDensity(renderer, context, scatteringOrder);
      });
      yield run(renderer, () => {
        textures.computeIndirectIrradiance(renderer, context, scatteringOrder);
      });
      yield run(renderer, () => {
        textures.computeMultipleScattering(renderer, context);
      });
    }
  }
  async updateTextures(renderer) {
    this.ensureInitialized(renderer);
    if (this.textures == null) {
      throw new Error("AtmosphereLUTNode textures were not initialized.");
    }
    this.updating = true;
    try {
      while (true) {
        if (this.textures instanceof AtmosphereLUTTexturesWebGPU) {
          this.textures.invalidateComputeNodes();
        }
        const context = this.textures.createContext();
        try {
          await timeSlice(this.performCompute(renderer, context));
        } finally {
          context.dispose();
          this.disposeQueue?.();
        }
        const pending = this.pendingParameters;
        if (!pending) {
          break;
        }
        this.pendingParameters = void 0;
        this.applyParameters(pending);
      }
    } finally {
      this.updating = false;
    }
  }
  updateBefore({ renderer }) {
    if (renderer == null || this.version === this.currentVersion) {
      return;
    }
    this.currentVersion = this.version;
    this.updateTextures(renderer).catch((error) => {
      throw error instanceof Error ? error : new Error();
    });
  }
  setup(builder) {
    this.ensureInitialized(builder.renderer);
    return super.setup(builder);
  }
  dispose() {
    if (this.updating) {
      this.disposeQueue = () => {
        this.dispose();
        this.disposeQueue = void 0;
      };
      return;
    }
    this.textures?.dispose();
    super.dispose();
  }
};

// src/bruneton/AtmosphereContextNode.ts
var AtmosphereContextNode = class _AtmosphereContextNode extends AtmosphereContextBaseNode {
  static get type() {
    return "AtmosphereContextNode";
  }
  lutNode;
  planetCenterWorld = uniform3(new Vector33()).setName("planetCenterWorld");
  sunDirectionWorld = uniform3(new Vector33(0, 1, 0)).setName("sunDirectionWorld");
  worldToUnitScene = uniform3(this.parameters.worldToUnit).setName("worldToUnitScene");
  // Static options:
  camera;
  constrainCamera = true;
  showGround = true;
  constructor(parameters = new AtmosphereParameters(), lutNode = new AtmosphereLUTNode(parameters)) {
    super(parameters);
    this.lutNode = lutNode;
  }
  static get(builder) {
    const context = builder.getContext().atmosphere;
    if (!(context instanceof _AtmosphereContextNode)) {
      throw new Error("AtmosphereContextNode was not found in the builder context.");
    }
    return context;
  }
  dispose() {
    this.lutNode.dispose();
    super.dispose();
  }
};

// src/bruneton/runtime.ts
import {
  add as add2,
  bool as bool2,
  floor as floor3,
  If as If4,
  max as max3,
  mul as mul3,
  not,
  PI as PI3,
  PI2 as PI22,
  select as select3,
  smoothstep as smoothstep2,
  sqrt as sqrt3,
  struct as struct2,
  vec2 as vec24,
  vec3 as vec35,
  vec4 as vec44
} from "three/tsl";
var getExtrapolatedSingleMieScattering = /* @__PURE__ */ FnLayout({
  name: "getExtrapolatedSingleMieScattering",
  type: IrradianceSpectrum,
  inputs: [{ name: "scattering", type: "vec4" }]
})(([scattering], builder) => {
  const context = AtmosphereContextBaseNode.get(builder);
  const { rayleighScattering, mieScattering } = context;
  const singleMieScattering = vec35(0).toVar();
  If4(scattering.r.greaterThanEqual(1e-5), () => {
    singleMieScattering.assign(
      scattering.rgb.mul(scattering.a).div(scattering.r).mul(rayleighScattering.r.div(mieScattering.r)).mul(mieScattering.div(rayleighScattering))
    );
  });
  return singleMieScattering;
});
var combinedScatteringStruct = /* @__PURE__ */ struct2(
  {
    scattering: IrradianceSpectrum,
    singleMieScattering: IrradianceSpectrum
  },
  "combinedScattering"
);
var getCombinedScattering = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // TODO: Fn layout doesn't support texture type
  name: "getCombinedScattering",
  type: combinedScatteringStruct,
  inputs: [
    { name: "scatteringTexture", type: ReducedScatteringTexture },
    { name: "singleMieScatteringTexture", type: ReducedScatteringTexture },
    { name: "radius", type: Length },
    { name: "cosView", type: Dimensionless },
    { name: "cosSun", type: Dimensionless },
    { name: "cosViewSun", type: Dimensionless },
    { name: "viewRayIntersectsGround", type: "bool" }
  ]
})(([
  scatteringTexture,
  singleMieScatteringTexture,
  radius,
  cosView,
  cosSun,
  cosViewSun,
  viewRayIntersectsGround
], builder) => {
  const { parameters } = AtmosphereContextBaseNode.get(builder);
  const coord = getScatteringTextureCoord(
    radius,
    cosView,
    cosSun,
    cosViewSun,
    viewRayIntersectsGround
  ).toVar();
  const texCoordX = coord.x.mul(parameters.scatteringTextureCosViewSunSize - 1).toVar();
  const texX = floor3(texCoordX).toVar();
  const lerp = texCoordX.sub(texX).toVar();
  const coord0 = vec35(
    texX.add(coord.y).div(parameters.scatteringTextureCosViewSunSize),
    coord.z,
    coord.w
  ).toVar();
  const coord1 = vec35(
    texX.add(1).add(coord.y).div(parameters.scatteringTextureCosViewSunSize),
    coord.z,
    coord.w
  ).toVar();
  const scattering = vec35().toVar();
  const singleMieScattering = vec35().toVar();
  if (parameters.combinedScatteringTextures) {
    const combinedScattering = add2(
      scatteringTexture.sample(coord0).mul(lerp.oneMinus()),
      scatteringTexture.sample(coord1).mul(lerp)
    ).toVar();
    scattering.assign(combinedScattering.rgb);
    singleMieScattering.assign(
      getExtrapolatedSingleMieScattering(combinedScattering)
    );
  } else {
    scattering.assign(
      add2(
        scatteringTexture.sample(coord0).mul(lerp.oneMinus()),
        scatteringTexture.sample(coord1).mul(lerp)
      ).rgb
    );
    singleMieScattering.assign(
      add2(
        singleMieScatteringTexture.sample(coord0).mul(lerp.oneMinus()),
        singleMieScatteringTexture.sample(coord1).mul(lerp)
      ).rgb
    );
  }
  return combinedScatteringStruct(scattering, singleMieScattering);
});
var radianceTransferStruct = /* @__PURE__ */ struct2(
  {
    radiance: RadianceSpectrum,
    transmittance: DimensionlessSpectrum
  },
  "radianceTransfer"
);
var getSkyRadiance = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // TODO: Fn layout doesn't support texture type
  name: "getSkyRadiance",
  type: radianceTransferStruct,
  inputs: [
    { name: "transmittanceTexture", type: TransmittanceTexture },
    { name: "scatteringTexture", type: ReducedScatteringTexture },
    { name: "singleMieScatteringTexture", type: ReducedScatteringTexture },
    { name: "higherOrderScatteringTexture", type: ReducedScatteringTexture },
    { name: "camera", type: Position },
    { name: "viewRay", type: Direction },
    { name: "shadowLength", type: Length },
    { name: "sunDirection", type: Direction }
  ]
})(([
  transmittanceTexture,
  scatteringTexture,
  singleMieScatteringTexture,
  higherOrderScatteringTexture,
  camera,
  viewRay,
  shadowLength,
  sunDirection
], builder) => {
  const context = AtmosphereContextNode.get(builder);
  const { parameters, topRadius, bottomRadius, miePhaseFunctionG } = context;
  const radius = camera.length().toVar();
  const movedCamera = camera.toVar();
  if (context.constrainCamera) {
    If4(radius.lessThan(bottomRadius), () => {
      radius.assign(bottomRadius);
      movedCamera.assign(camera.normalize().mul(radius));
    });
  }
  const radiusCosView = movedCamera.dot(viewRay).toVar();
  const discriminant = radiusCosView.pow2().sub(radius.pow2()).add(topRadius.pow2()).toVar();
  const distanceToTop = radiusCosView.negate().sub(sqrtSafe(discriminant)).toVar();
  If4(discriminant.greaterThanEqual(0).and(distanceToTop.greaterThan(0)), () => {
    movedCamera.assign(movedCamera.add(viewRay.mul(distanceToTop)));
    radius.assign(topRadius);
    radiusCosView.addAssign(distanceToTop);
  });
  const radiance = vec35(0).toVar();
  const transmittance = vec35(1).toVar();
  If4(radius.lessThanEqual(topRadius), () => {
    const cosView = radiusCosView.div(radius).toVar();
    const cosSun = movedCamera.dot(sunDirection).div(radius).toVar();
    const cosViewSun = viewRay.dot(sunDirection).toVar();
    const viewRayIntersectsGround = rayIntersectsGround(radius, cosView).toVar();
    const scatteringRayIntersectsGround = context.showGround ? viewRayIntersectsGround : bool2(false);
    transmittance.assign(
      select3(
        viewRayIntersectsGround,
        vec35(0),
        getTransmittanceToTopAtmosphereBoundary(
          transmittanceTexture,
          radius,
          cosView
        )
      )
    );
    const scattering = vec35().toVar();
    const singleMieScattering = vec35().toVar();
    If4(shadowLength.equal(0), () => {
      const combinedScattering = getCombinedScattering(
        scatteringTexture,
        singleMieScatteringTexture,
        radius,
        cosView,
        cosSun,
        cosViewSun,
        scatteringRayIntersectsGround
      ).toVar();
      scattering.assign(combinedScattering.get("scattering"));
      singleMieScattering.assign(combinedScattering.get("singleMieScattering"));
    }).Else(() => {
      const radiusP = clampRadius(
        sqrt3(
          shadowLength.pow2().add(mul3(2, radius, cosView, shadowLength)).add(radius.pow2())
        )
      ).toVar();
      const cosViewP = radius.mul(cosView).add(shadowLength).div(radiusP).toVar();
      const cosSunP = radius.mul(cosSun).add(shadowLength.mul(cosViewSun)).div(radiusP).toVar();
      const combinedScattering = getCombinedScattering(
        scatteringTexture,
        singleMieScatteringTexture,
        radiusP,
        cosViewP,
        cosSunP,
        cosViewSun,
        scatteringRayIntersectsGround
      ).toVar();
      scattering.assign(combinedScattering.get("scattering"));
      singleMieScattering.assign(combinedScattering.get("singleMieScattering"));
      const shadowTransmittance = getTransmittance(
        transmittanceTexture,
        radius,
        cosView,
        shadowLength,
        scatteringRayIntersectsGround
      ).toVar();
      if (parameters.higherOrderScatteringTexture) {
        const higherOrderScattering = getScattering(
          higherOrderScatteringTexture,
          radiusP,
          cosViewP,
          cosSunP,
          cosViewSun,
          scatteringRayIntersectsGround
        ).toVar();
        scattering.assign(
          scattering.sub(higherOrderScattering).mul(shadowTransmittance).add(higherOrderScattering)
        );
      } else {
        scattering.assign(scattering.mul(shadowTransmittance));
      }
      singleMieScattering.assign(singleMieScattering.mul(shadowTransmittance));
    });
    radiance.assign(
      scattering.mul(rayleighPhaseFunction(cosViewSun)).add(
        singleMieScattering.mul(
          miePhaseFunction(miePhaseFunctionG, cosViewSun)
        )
      )
    );
  });
  return radianceTransferStruct(radiance, transmittance);
});
var getSkyIrradiance = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // TODO: Fn layout doesn't support texture type
  name: "getSkyIrradiance",
  type: IrradianceSpectrum,
  inputs: [
    { name: "irradianceTexture", type: IrradianceTexture },
    { name: "point", type: Position },
    { name: "normal", type: Direction },
    { name: "sunDirection", type: Direction }
  ]
})(([irradianceTexture, point, normal, sunDirection]) => {
  const radius = point.length().toVar();
  const cosSun = point.dot(sunDirection).div(radius).toVar();
  return getIrradiance(irradianceTexture, radius, cosSun).mul(
    normal.dot(point).div(radius).add(1).mul(0.5)
  );
});
var getSolarLuminance = /* @__PURE__ */ FnLayout({
  name: "getSolarLuminance",
  type: Luminance3
})(
  // @ts-expect-error TODO
  (_, builder) => {
    const context = AtmosphereContextBaseNode.get(builder);
    const {
      solarIrradiance,
      sunAngularRadius,
      sunRadianceToLuminance,
      luminanceScale
    } = context;
    return solarIrradiance.div(PI3.mul(sunAngularRadius.pow2())).mul(sunRadianceToLuminance.mul(luminanceScale));
  }
);
var luminanceTransferStruct = /* @__PURE__ */ struct2(
  {
    luminance: Luminance3,
    transmittance: DimensionlessSpectrum
  },
  "luminanceTransfer"
);
var getSkyLuminance = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // TODO: Cannot resolve sampler uniforms
  name: "getSkyLuminance",
  type: luminanceTransferStruct,
  inputs: [
    { name: "camera", type: Position },
    { name: "viewRay", type: Direction },
    { name: "shadowLength", type: Length },
    { name: "sunDirection", type: Direction }
  ]
})(([camera, viewRay, shadowLength, sunDirection], builder) => {
  const context = AtmosphereContextNode.get(builder);
  const { lutNode, skyRadianceToLuminance, luminanceScale } = context;
  const radianceTransfer = getSkyRadiance(
    lutNode.getTextureNode("transmittance"),
    lutNode.getTextureNode("scattering"),
    lutNode.getTextureNode("singleMieScattering"),
    lutNode.getTextureNode("higherOrderScattering"),
    camera,
    viewRay,
    shadowLength,
    sunDirection
  );
  const luminance = radianceTransfer.get("radiance").mul(skyRadianceToLuminance.mul(luminanceScale));
  return luminanceTransferStruct(
    luminance,
    radianceTransfer.get("transmittance")
  );
});
var getSkyIlluminance = /* @__PURE__ */ FnLayout({
  typeOnly: true,
  // TODO: Cannot resolve sampler uniforms
  name: "getSkyIlluminance",
  type: Illuminance3,
  inputs: [
    { name: "point", type: Position },
    { name: "normal", type: Direction },
    { name: "sunDirection", type: Direction }
  ]
})(([point, normal, sunDirection], builder) => {
  const context = AtmosphereContextNode.get(builder);
  const { lutNode, skyRadianceToLuminance, luminanceScale } = context;
  const sunSkyIrradiance = getSkyIrradiance(
    lutNode.getTextureNode("irradiance"),
    point,
    normal,
    sunDirection
  );
  return sunSkyIrradiance.mul(skyRadianceToLuminance.mul(luminanceScale));
});

// src/atmosphereSystem.ts
var DEFAULT_ATMOSPHERE_SETTINGS = {
  skyIntensity: 1.2,
  skyTintR: 1,
  skyTintG: 1,
  skyTintB: 1,
  groundOpacity: 1,
  sunDiscIntensity: 1.4,
  sunDiscColorR: 1,
  sunDiscColorG: 0.9686274509803922,
  sunDiscColorB: 0.8901960784313725,
  sunDiscInnerScale: 0.85,
  sunDiscOuterScale: 1.8,
  planetRadiusM: 636e4,
  atmosphereHeightM: 6e4,
  rayleighScaleHeightM: 8e3,
  mieScaleHeightM: 1200,
  miePhaseG: 0.8,
  rayleighScatteringMultiplier: 1,
  mieScatteringMultiplier: 1,
  mieExtinctionMultiplier: 1,
  absorptionExtinctionMultiplier: 1,
  groundAlbedo: 0.3,
  starRadiusM: 6957e5,
  planetStarDistanceM: 149597870700,
  starEffectiveTemperatureK: 5772
};
var DEFAULT_WORLD_UNITS_PER_METER = 1;
var DEFAULT_SKY_DOME_RADIUS_METERS = 50;
var DEFAULT_REPRIME_DEBOUNCE_MS = 160;
var DEFAULT_PRESENTATION_MODE = "sky-dome";
var PLANCK_CONSTANT = 662607015e-42;
var SPEED_OF_LIGHT = 299792458;
var BOLTZMANN_CONSTANT = 1380649e-29;
var SOLAR_SAMPLE_WAVELENGTHS_M = [68e-8, 55e-8, 44e-8];
var clamp01 = (value) => Math.min(1, Math.max(0, value));
var clampNonNegative = (value) => Math.max(0, value);
var clampPositive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
var normalizeAtmosphereSettings = (settings) => ({
  ...DEFAULT_ATMOSPHERE_SETTINGS,
  ...settings
});
var computeBlackbodySpectralRadiancePerMeter = (wavelengthM, temperatureK) => {
  const exponent = PLANCK_CONSTANT * SPEED_OF_LIGHT / (wavelengthM * BOLTZMANN_CONSTANT * temperatureK);
  if (!Number.isFinite(exponent) || exponent > 700) {
    return 0;
  }
  const numerator = 2 * PLANCK_CONSTANT * SPEED_OF_LIGHT ** 2;
  const denominator = wavelengthM ** 5 * (Math.exp(exponent) - 1);
  return denominator > 0 ? numerator / denominator : 0;
};
var deriveSolarIrradiance = (settings, target = new THREE.Vector3()) => {
  const starRadiusM = clampPositive(
    settings.starRadiusM,
    DEFAULT_ATMOSPHERE_SETTINGS.starRadiusM
  );
  const planetStarDistanceM = clampPositive(
    settings.planetStarDistanceM,
    DEFAULT_ATMOSPHERE_SETTINGS.planetStarDistanceM
  );
  const starEffectiveTemperatureK = clampPositive(
    settings.starEffectiveTemperatureK,
    DEFAULT_ATMOSPHERE_SETTINGS.starEffectiveTemperatureK
  );
  const angularRadiusRatio = THREE.MathUtils.clamp(starRadiusM / planetStarDistanceM, 1e-8, 0.999999);
  const solidAngle = Math.PI * angularRadiusRatio ** 2;
  const values = SOLAR_SAMPLE_WAVELENGTHS_M.map((wavelengthM) => {
    const radiancePerMeter = computeBlackbodySpectralRadiancePerMeter(
      wavelengthM,
      starEffectiveTemperatureK
    );
    return radiancePerMeter * solidAngle * 1e-9;
  });
  return target.set(values[0], values[1], values[2]);
};
var deriveSunAngularRadius = (settings) => {
  const starRadiusM = clampPositive(
    settings.starRadiusM,
    DEFAULT_ATMOSPHERE_SETTINGS.starRadiusM
  );
  const planetStarDistanceM = clampPositive(
    settings.planetStarDistanceM,
    DEFAULT_ATMOSPHERE_SETTINGS.planetStarDistanceM
  );
  return Math.asin(THREE.MathUtils.clamp(starRadiusM / planetStarDistanceM, 1e-8, 0.999999));
};
var lutKey = (settings) => {
  const values = [
    settings.planetRadiusM,
    settings.atmosphereHeightM,
    settings.starRadiusM,
    settings.planetStarDistanceM,
    settings.starEffectiveTemperatureK,
    settings.rayleighScaleHeightM,
    settings.mieScaleHeightM,
    settings.miePhaseG,
    settings.rayleighScatteringMultiplier,
    settings.mieScatteringMultiplier,
    settings.mieExtinctionMultiplier,
    settings.absorptionExtinctionMultiplier,
    settings.groundAlbedo
  ];
  return values.map((value) => value.toFixed(6)).join("|");
};
var sunDirectionFromAngles = (altitudeDeg, azimuthDeg, target = new THREE.Vector3()) => {
  const altitudeRadians = THREE.MathUtils.degToRad(altitudeDeg);
  const azimuthRadians = THREE.MathUtils.degToRad(azimuthDeg);
  const horizontal = Math.cos(altitudeRadians);
  const x = Math.sin(azimuthRadians) * horizontal;
  const y = Math.sin(altitudeRadians);
  const z = Math.cos(azimuthRadians) * horizontal;
  return target.set(x, y, z).normalize();
};
var createAtmosphereSystem = (scene, initialSettings = DEFAULT_ATMOSPHERE_SETTINGS, options = {}) => {
  const worldUnitsPerMeter = Number.isFinite(options.worldUnitsPerMeter) && (options.worldUnitsPerMeter ?? 0) > 0 ? options.worldUnitsPerMeter : DEFAULT_WORLD_UNITS_PER_METER;
  const metersPerWorldUnit = 1 / worldUnitsPerMeter;
  const skyDomeRadiusMeters = Number.isFinite(options.skyDomeRadiusMeters) && (options.skyDomeRadiusMeters ?? 0) > 0 ? options.skyDomeRadiusMeters : DEFAULT_SKY_DOME_RADIUS_METERS;
  const reprimeDebounceMs = Number.isFinite(options.reprimeDebounceMs) && (options.reprimeDebounceMs ?? 0) >= 0 ? options.reprimeDebounceMs : DEFAULT_REPRIME_DEBOUNCE_MS;
  const presentationMode = options.presentationMode ?? DEFAULT_PRESENTATION_MODE;
  let settings = normalizeAtmosphereSettings(initialSettings);
  const parameters = new AtmosphereParameters();
  const baseRayleigh = parameters.rayleighScattering.clone();
  const baseMieScattering = parameters.mieScattering.clone();
  const baseMieExtinction = parameters.mieExtinction.clone();
  const baseAbsorptionExtinction = parameters.absorptionExtinction.clone();
  const lutNode = new AtmosphereLUTNode(parameters);
  let atmosphereContext = new AtmosphereContextNode(parameters, lutNode);
  atmosphereContext.worldToUnitScene.value = parameters.worldToUnit * metersPerWorldUnit;
  const noGroundAtmosphereContext = new AtmosphereContextNode(parameters, lutNode);
  noGroundAtmosphereContext.showGround = false;
  noGroundAtmosphereContext.constrainCamera = atmosphereContext.constrainCamera;
  noGroundAtmosphereContext.planetCenterWorld = atmosphereContext.planetCenterWorld;
  noGroundAtmosphereContext.sunDirectionWorld = atmosphereContext.sunDirectionWorld;
  noGroundAtmosphereContext.worldToUnitScene = atmosphereContext.worldToUnitScene;
  const skyIntensity = uniform4(settings.skyIntensity);
  const skyTint = uniform4(new THREE.Vector3(settings.skyTintR, settings.skyTintG, settings.skyTintB));
  const groundOpacity = uniform4(settings.groundOpacity);
  const sunDiscIntensity = uniform4(settings.sunDiscIntensity);
  const sunDiscColor = uniform4(
    new THREE.Vector3(settings.sunDiscColorR, settings.sunDiscColorG, settings.sunDiscColorB)
  );
  const sunDiscAngularRadius = uniform4(parameters.sunAngularRadius);
  const screenCameraProjectionMatrixInverse = uniform4(new THREE.Matrix4());
  const screenCameraMatrixWorld = uniform4(new THREE.Matrix4());
  const screenCameraWorldPosition = uniform4(new THREE.Vector3());
  const screenCameraIsOrthographic = uniform4(false);
  const geometry = new THREE.SphereGeometry(skyDomeRadiusMeters * worldUnitsPerMeter, 64, 32);
  const buildSkyTransferNode = (cameraUnitNode, worldViewDirNode, worldSunDirNode, contextNode) => Fn4(() => getSkyLuminance(cameraUnitNode, worldViewDirNode, float4(0), worldSunDirNode))().context({
    atmosphere: contextNode
  });
  const buildSkyLuminanceNode = (cameraWorldPositionNode, worldViewDirNode, softenPlanetMask) => Fn4(() => {
    const worldViewDir = normalize(worldViewDirNode).toVar();
    const worldSunDir = normalize(atmosphereContext.sunDirectionWorld).toVar();
    const cameraUnit = cameraWorldPositionNode.sub(atmosphereContext.planetCenterWorld).mul(atmosphereContext.worldToUnitScene).toVar();
    const cameraRadius = cameraUnit.length().toVar();
    const clampedGroundOpacity = groundOpacity.clamp(0, 1).toVar();
    const throughGroundFactor = float4(1).sub(clampedGroundOpacity).toVar();
    const skyTransfer = buildSkyTransferNode(
      cameraUnit,
      worldViewDir,
      worldSunDir,
      atmosphereContext
    ).toVar();
    const skyTransferNoGround = buildSkyTransferNode(
      cameraUnit,
      worldViewDir,
      worldSunDir,
      noGroundAtmosphereContext
    ).toVar();
    const skyLuminance = skyTransfer.get("luminance").mul(clampedGroundOpacity).add(skyTransferNoGround.get("luminance").mul(throughGroundFactor)).mul(skyIntensity).mul(skyTint).toVar();
    const skyTransmittance = skyTransfer.get("transmittance").mul(clampedGroundOpacity).add(skyTransferNoGround.get("transmittance").mul(throughGroundFactor)).toVar();
    const sunChordThreshold = cos2(sunDiscAngularRadius).oneMinus().mul(2).toVar();
    const sunChordVector = worldViewDir.sub(worldSunDir).toVar();
    const sunChordLength = dot(sunChordVector, sunChordVector).toVar();
    const sunFilterWidth = fwidth(sunChordLength).toVar();
    const sunDisc = smoothstep3(
      sunChordThreshold,
      sunChordThreshold.sub(sunFilterWidth),
      sunChordLength
    ).mul(sunDiscIntensity).toVar();
    const sunDiscLuminance = getSolarLuminance().mul(vec36(sunDiscColor)).mul(sunDisc).mul(skyTransmittance).toVar();
    if (!softenPlanetMask) {
      return skyLuminance.add(sunDiscLuminance);
    }
    const cameraDotView = dot(cameraUnit, worldViewDir).toVar();
    const closestApproach = sqrt4(
      cameraRadius.pow2().sub(cameraDotView.pow2()).max(float4(0))
    ).toVar();
    const limbDistance = closestApproach.sub(atmosphereContext.bottomRadius).toVar();
    const limbWidth = fwidth(limbDistance).max(float4(1e-5)).mul(2).toVar();
    const rawPlanetMask = smoothstep3(limbWidth.negate(), limbWidth, limbDistance).toVar();
    const applyPlanetMask = cameraRadius.greaterThan(atmosphereContext.topRadius).and(cameraDotView.lessThan(0)).toVar();
    const planetMask = select4(applyPlanetMask, rawPlanetMask, float4(1)).toVar();
    return skyLuminance.add(sunDiscLuminance).mul(planetMask);
  })().context({ atmosphere: atmosphereContext });
  const buildColorNode = () => vec45(
    buildSkyLuminanceNode(cameraPosition, positionWorld.sub(cameraPosition), true),
    float4(1)
  );
  const buildScreenSpaceColorNode = () => Fn4(() => {
    const viewPosition = getViewPosition(
      screenUV,
      float4(1),
      screenCameraProjectionMatrixInverse
    ).toVar();
    const nearViewPosition = getViewPosition(
      screenUV,
      float4(0),
      screenCameraProjectionMatrixInverse
    ).toVar();
    const originView = vec36(0, 0, 0).toVar();
    const directionView = normalize(viewPosition).toVar();
    If5(screenCameraIsOrthographic, () => {
      originView.assign(nearViewPosition);
      directionView.assign(vec36(0, 0, -1));
    });
    const worldOrigin = screenCameraWorldPosition.toVar();
    If5(screenCameraIsOrthographic, () => {
      worldOrigin.assign(screenCameraMatrixWorld.mul(vec45(originView, float4(1))).xyz);
    });
    const worldViewDirection = normalize(
      screenCameraMatrixWorld.mul(vec45(directionView, float4(0))).xyz
    ).toVar();
    const skyLuminance = buildSkyLuminanceNode(worldOrigin, worldViewDirection, false).toVar();
    return vec45(skyLuminance, float4(1));
  })().context({ atmosphere: atmosphereContext });
  const buildScreenSpaceTransmittanceNode = () => Fn4(() => {
    const viewPosition = getViewPosition(
      screenUV,
      float4(1),
      screenCameraProjectionMatrixInverse
    ).toVar();
    const nearViewPosition = getViewPosition(
      screenUV,
      float4(0),
      screenCameraProjectionMatrixInverse
    ).toVar();
    const originView = vec36(0, 0, 0).toVar();
    const directionView = normalize(viewPosition).toVar();
    If5(screenCameraIsOrthographic, () => {
      originView.assign(nearViewPosition);
      directionView.assign(vec36(0, 0, -1));
    });
    const worldOrigin = screenCameraWorldPosition.toVar();
    If5(screenCameraIsOrthographic, () => {
      worldOrigin.assign(screenCameraMatrixWorld.mul(vec45(originView, float4(1))).xyz);
    });
    const worldViewDirection = normalize(
      screenCameraMatrixWorld.mul(vec45(directionView, float4(0))).xyz
    ).toVar();
    const cameraUnit = worldOrigin.sub(atmosphereContext.planetCenterWorld).mul(atmosphereContext.worldToUnitScene).toVar();
    const worldSunDir = normalize(atmosphereContext.sunDirectionWorld).toVar();
    const clampedGroundOpacity = groundOpacity.clamp(0, 1).toVar();
    const throughGroundFactor = float4(1).sub(clampedGroundOpacity).toVar();
    const skyTransfer = buildSkyTransferNode(
      cameraUnit,
      worldViewDirection,
      worldSunDir,
      atmosphereContext
    ).toVar();
    const skyTransferNoGround = buildSkyTransferNode(
      cameraUnit,
      worldViewDirection,
      worldSunDir,
      noGroundAtmosphereContext
    ).toVar();
    return vec45(
      skyTransfer.get("transmittance").mul(clampedGroundOpacity).add(skyTransferNoGround.get("transmittance").mul(throughGroundFactor)),
      float4(1)
    );
  })().context({ atmosphere: atmosphereContext });
  const createSkyMaterial = () => {
    const material2 = new MeshBasicNodeMaterial();
    material2.side = THREE.BackSide;
    material2.depthTest = false;
    material2.depthWrite = false;
    material2.colorNode = buildColorNode();
    return material2;
  };
  const createScreenSpaceMaterial = () => {
    const material2 = new MeshBasicNodeMaterial();
    material2.depthTest = false;
    material2.depthWrite = false;
    material2.outputNode = buildScreenSpaceColorNode();
    return material2;
  };
  const createScreenSpaceTransmittanceMaterial = () => {
    const material2 = new MeshBasicNodeMaterial();
    material2.depthTest = false;
    material2.depthWrite = false;
    material2.outputNode = buildScreenSpaceTransmittanceNode();
    return material2;
  };
  let material = createSkyMaterial();
  let skyMesh = null;
  let backgroundScene = null;
  let backgroundCamera = null;
  let backgroundQuad = null;
  let transmittanceMaterial = null;
  let transmittanceScene = null;
  let transmittanceCamera = null;
  let transmittanceQuad = null;
  if (presentationMode === "screen-space") {
    backgroundScene = new THREE.Scene();
    backgroundCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    backgroundQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), createScreenSpaceMaterial());
    backgroundQuad.frustumCulled = false;
    backgroundScene.add(backgroundQuad);
    transmittanceScene = new THREE.Scene();
    transmittanceCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    transmittanceMaterial = createScreenSpaceTransmittanceMaterial();
    transmittanceQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), transmittanceMaterial);
    transmittanceQuad.frustumCulled = false;
    transmittanceScene.add(transmittanceQuad);
    material.dispose();
    material = backgroundQuad.material;
  } else {
    skyMesh = new THREE.Mesh(geometry, material);
    skyMesh.frustumCulled = false;
    skyMesh.renderOrder = -100;
    scene.add(skyMesh);
  }
  const sunScratch = new THREE.Vector3(0, 1, 0);
  const solarIrradianceScratch = new THREE.Vector3();
  let rendererRef = null;
  let primePromise = null;
  let pendingReprimeTimeout = null;
  let appliedLutSettingsKey = "";
  let hasPrimedLuts = false;
  const syncSunDiscUniforms = () => {
    const innerScale = Math.max(0.01, settings.sunDiscInnerScale);
    const outerScale = Math.max(innerScale + 0.01, settings.sunDiscOuterScale);
    const averageScale = (innerScale + outerScale) * 0.5;
    sunDiscAngularRadius.value = Math.max(1e-5, parameters.sunAngularRadius * averageScale);
  };
  const configureParametersForSettings = (sourceSettings) => {
    const planetRadiusMeters = clampPositive(
      sourceSettings.planetRadiusM,
      DEFAULT_ATMOSPHERE_SETTINGS.planetRadiusM
    );
    const atmosphereHeightMeters = clampPositive(
      sourceSettings.atmosphereHeightM,
      DEFAULT_ATMOSPHERE_SETTINGS.atmosphereHeightM
    );
    parameters.bottomRadius = planetRadiusMeters;
    parameters.topRadius = planetRadiusMeters + atmosphereHeightMeters;
    parameters.rayleighDensity.layers[1].expScale = -1 / Math.max(1, sourceSettings.rayleighScaleHeightM);
    parameters.mieDensity.layers[1].expScale = -1 / Math.max(1, sourceSettings.mieScaleHeightM);
    parameters.miePhaseFunctionG = THREE.MathUtils.clamp(sourceSettings.miePhaseG, 0, 0.999);
    parameters.rayleighScattering.copy(baseRayleigh).multiplyScalar(clampNonNegative(sourceSettings.rayleighScatteringMultiplier));
    parameters.mieScattering.copy(baseMieScattering).multiplyScalar(clampNonNegative(sourceSettings.mieScatteringMultiplier));
    parameters.mieExtinction.copy(baseMieExtinction).multiplyScalar(clampNonNegative(sourceSettings.mieExtinctionMultiplier));
    parameters.absorptionExtinction.copy(baseAbsorptionExtinction).multiplyScalar(clampNonNegative(sourceSettings.absorptionExtinctionMultiplier));
    parameters.groundAlbedo.setScalar(clamp01(sourceSettings.groundAlbedo));
    parameters.solarIrradiance.copy(deriveSolarIrradiance(sourceSettings, solarIrradianceScratch));
    parameters.sunAngularRadius = deriveSunAngularRadius(sourceSettings);
    return {
      planetRadiusMeters,
      parametersSnapshot: parameters.clone()
    };
  };
  const prepareLutSettings = (sourceSettings) => {
    const prepared = configureParametersForSettings(sourceSettings);
    lutNode.configure(prepared.parametersSnapshot.clone());
    return prepared;
  };
  const commitLutSettings = ({
    planetRadiusMeters,
    parametersSnapshot
  }) => {
    atmosphereContext.applyParameters(parametersSnapshot);
    noGroundAtmosphereContext.applyParameters(parametersSnapshot);
    atmosphereContext.planetCenterWorld.value.set(0, -planetRadiusMeters * worldUnitsPerMeter, 0);
    atmosphereContext.worldToUnitScene.value = parametersSnapshot.worldToUnit * metersPerWorldUnit;
    const nextMaterial = presentationMode === "screen-space" ? createScreenSpaceMaterial() : createSkyMaterial();
    const nextTransmittanceMaterial = presentationMode === "screen-space" ? createScreenSpaceTransmittanceMaterial() : null;
    if (skyMesh) {
      skyMesh.material = nextMaterial;
    }
    if (backgroundQuad) {
      backgroundQuad.material = nextMaterial;
    }
    if (transmittanceQuad && nextTransmittanceMaterial) {
      transmittanceQuad.material = nextTransmittanceMaterial;
    }
    material.dispose();
    transmittanceMaterial?.dispose();
    material = nextMaterial;
    transmittanceMaterial = nextTransmittanceMaterial;
  };
  const applyVisualSettings = () => {
    skyIntensity.value = clampNonNegative(settings.skyIntensity);
    skyTint.value.set(
      clampNonNegative(settings.skyTintR),
      clampNonNegative(settings.skyTintG),
      clampNonNegative(settings.skyTintB)
    );
    groundOpacity.value = clamp01(settings.groundOpacity);
    sunDiscIntensity.value = clampNonNegative(settings.sunDiscIntensity);
    sunDiscColor.value.set(
      clampNonNegative(settings.sunDiscColorR),
      clampNonNegative(settings.sunDiscColorG),
      clampNonNegative(settings.sunDiscColorB)
    );
    syncSunDiscUniforms();
  };
  const scheduleReprime = () => {
    const activeRenderer = rendererRef;
    if (!activeRenderer) return;
    if (pendingReprimeTimeout) {
      clearTimeout(pendingReprimeTimeout);
    }
    pendingReprimeTimeout = setTimeout(() => {
      pendingReprimeTimeout = null;
      void prime(activeRenderer).catch((error) => {
        console.error("Atmosphere LUT re-prime failed.", error);
      });
    }, reprimeDebounceMs);
  };
  const syncSettings = (forceLutApply = false) => {
    const nextLutSettingsKey = lutKey(settings);
    const lutChanged = forceLutApply || nextLutSettingsKey !== appliedLutSettingsKey;
    if (lutChanged && rendererRef == null) {
      const prepared = prepareLutSettings(settings);
      commitLutSettings(prepared);
      appliedLutSettingsKey = nextLutSettingsKey;
    }
    applyVisualSettings();
    return lutChanged;
  };
  const prime = async (renderer) => {
    rendererRef = renderer;
    if (primePromise) {
      return primePromise;
    }
    primePromise = (async () => {
      while (true) {
        const nextSettings = normalizeAtmosphereSettings(settings);
        const nextLutSettingsKey = lutKey(nextSettings);
        if (hasPrimedLuts && nextLutSettingsKey === appliedLutSettingsKey) {
          break;
        }
        const prepared = prepareLutSettings(nextSettings);
        await lutNode.updateTextures(renderer);
        commitLutSettings(prepared);
        appliedLutSettingsKey = nextLutSettingsKey;
        hasPrimedLuts = true;
      }
    })().finally(() => {
      primePromise = null;
    });
    return primePromise;
  };
  const setSettings = (next) => {
    settings = normalizeAtmosphereSettings(next);
    const lutChanged = syncSettings(false);
    if (lutChanged) {
      scheduleReprime();
    }
  };
  const setSunDirection = (directionWorld) => {
    sunScratch.copy(directionWorld);
    if (sunScratch.lengthSq() <= 1e-8) {
      sunScratch.set(0, 1, 0);
    } else {
      sunScratch.normalize();
    }
    atmosphereContext.sunDirectionWorld.value.copy(sunScratch);
  };
  const setCameraPosition = (positionWorld3) => {
    screenCameraWorldPosition.value.copy(positionWorld3);
    if (skyMesh) {
      skyMesh.position.copy(positionWorld3);
    }
  };
  const setSkyLayer = (layer) => {
    const clampedLayer = THREE.MathUtils.clamp(Math.floor(layer), 0, 31);
    if (skyMesh) {
      skyMesh.layers.set(clampedLayer);
    }
  };
  const syncScreenCameraUniforms = (camera) => {
    camera.updateMatrixWorld();
    if ("projectionMatrixInverse" in camera) {
      screenCameraProjectionMatrixInverse.value.copy(
        camera.projectionMatrixInverse
      );
    } else {
      screenCameraProjectionMatrixInverse.value.copy(camera.projectionMatrix).invert();
    }
    screenCameraMatrixWorld.value.copy(camera.matrixWorld);
    screenCameraWorldPosition.value.setFromMatrixPosition(camera.matrixWorld);
    screenCameraIsOrthographic.value = camera instanceof THREE.OrthographicCamera;
  };
  const renderBackground = (renderer, camera) => {
    if (!backgroundScene || !backgroundCamera) {
      return;
    }
    syncScreenCameraUniforms(camera);
    renderer.render(backgroundScene, backgroundCamera);
  };
  const renderTransmittance = (renderer, camera) => {
    if (!transmittanceScene || !transmittanceCamera) {
      return;
    }
    syncScreenCameraUniforms(camera);
    renderer.render(transmittanceScene, transmittanceCamera);
  };
  syncSettings(true);
  const dispose = () => {
    if (pendingReprimeTimeout) {
      clearTimeout(pendingReprimeTimeout);
      pendingReprimeTimeout = null;
    }
    if (skyMesh) {
      scene.remove(skyMesh);
    }
    if (backgroundScene && backgroundQuad) {
      backgroundScene.remove(backgroundQuad);
      backgroundQuad.geometry.dispose();
    }
    if (transmittanceScene && transmittanceQuad) {
      transmittanceScene.remove(transmittanceQuad);
      transmittanceQuad.geometry.dispose();
    }
    geometry.dispose();
    transmittanceMaterial?.dispose();
    material.dispose();
    atmosphereContext.dispose();
  };
  return {
    prime,
    renderBackground,
    renderTransmittance,
    setSettings,
    setSunDirection,
    setCameraPosition,
    setSkyLayer,
    getContext: () => atmosphereContext,
    dispose
  };
};

// src/atmosphereRig.ts
import * as THREE2 from "three";

// src/AtmosphereLight.ts
import { DirectionalLight } from "three";
import { uniform as uniform5 } from "three/tsl";
var AtmosphereLight = class extends DirectionalLight {
  type = "AtmosphereLight";
  atmosphereContext;
  // Distance from target along the world sun direction.
  distance;
  direct = uniform5(true);
  indirect = uniform5(true);
  constructor(atmosphereContext, distance = 1) {
    super();
    this.atmosphereContext = atmosphereContext;
    this.distance = distance;
  }
  updateMatrixWorld(force) {
    this.updatePosition();
    super.updateMatrixWorld(force);
  }
  updatePosition() {
    if (!this.atmosphereContext) {
      return;
    }
    this.position.copy(this.atmosphereContext.sunDirectionWorld.value).multiplyScalar(this.distance).add(this.target.position);
    super.updateMatrixWorld(true);
    this.target.updateMatrixWorld(true);
  }
  copy(source, recursive) {
    super.copy(source, recursive);
    this.atmosphereContext = source.atmosphereContext;
    this.distance = source.distance;
    return this;
  }
};

// src/AtmosphereLightNode.ts
import {
  cameraViewMatrix,
  Fn as Fn5,
  normalWorld,
  positionWorld as positionWorld2,
  select as select5,
  vec4 as vec46
} from "three/tsl";
import { AnalyticLightNode } from "three/webgpu";
var AtmosphereLightNode = class extends AnalyticLightNode {
  static get type() {
    return "AtmosphereLightNode";
  }
  setupDirect(builder) {
    if (!this.light) {
      return;
    }
    const { atmosphereContext } = this.light;
    if (!atmosphereContext) {
      return;
    }
    const { direct, indirect } = this.light;
    const {
      worldToUnitScene,
      planetCenterWorld,
      solarIrradiance,
      sunRadianceToLuminance,
      luminanceScale,
      sunDirectionWorld
    } = atmosphereContext;
    const positionUnit = positionWorld2.sub(planetCenterWorld).mul(worldToUnitScene).toVar();
    const normalUnit = normalWorld;
    const skyIlluminance = Fn5((contextBuilder) => {
      contextBuilder.getContext().atmosphere = atmosphereContext;
      return getSkyIlluminance(positionUnit, normalUnit, sunDirectionWorld).mul(
        select5(indirect, 1, 0)
      );
    })();
    const lightingContext = builder.getContext();
    lightingContext.irradiance.addAssign(skyIlluminance);
    const sunDirectionView = cameraViewMatrix.mul(vec46(sunDirectionWorld, 0)).xyz;
    const radius = positionUnit.length().toVar();
    const cosSun = positionUnit.dot(sunDirectionWorld).div(radius);
    const sunTransmittance = Fn5((contextBuilder) => {
      contextBuilder.getContext().atmosphere = atmosphereContext;
      return getTransmittanceToSun(
        atmosphereContext.lutNode.getTextureNode("transmittance"),
        radius,
        cosSun
      );
    })();
    const sunLuminance = solarIrradiance.mul(sunTransmittance).mul(sunRadianceToLuminance.mul(luminanceScale)).mul(select5(direct, 1, 0));
    return {
      lightDirection: sunDirectionView,
      lightColor: sunLuminance.mul(this.colorNode)
    };
  }
};

// src/atmosphereRig.ts
var DEFAULT_SKY_LAYER = 1;
var DEFAULT_SUN_DISTANCE = 5;
var DEFAULT_SUN_INTENSITY = 1;
var DEFAULT_MAX_SUN_INTENSITY = 12;
var DEFAULT_AMBIENT_INTENSITY = 0.35;
var DEFAULT_ENVIRONMENT_RESOLUTION = 256;
var DEFAULT_ENVIRONMENT_NEAR = 0.1;
var DEFAULT_ENVIRONMENT_FAR = 250;
var DEFAULT_AMBIENT_SKY_COLOR = new THREE2.Color(16777215);
var DEFAULT_AMBIENT_GROUND_COLOR = new THREE2.Color(4865069);
var createEnvironmentTarget = (resolution) => {
  const target = new THREE2.WebGLCubeRenderTarget(resolution, {
    type: THREE2.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE2.LinearMipmapLinearFilter,
    magFilter: THREE2.LinearFilter
  });
  target.texture.colorSpace = THREE2.LinearSRGBColorSpace;
  return target;
};
var getRendererLightNodeLibrary = (renderer) => {
  const maybeRenderer = renderer;
  const library = maybeRenderer.library;
  if (!library || typeof library !== "object") {
    return null;
  }
  const lightLibrary = library;
  if (typeof lightLibrary.getLightNodeClass !== "function" || typeof lightLibrary.addLight !== "function") {
    return null;
  }
  return lightLibrary;
};
var normalizeRigAtmosphereSettings = (settings) => ({
  ...DEFAULT_ATMOSPHERE_SETTINGS,
  ...settings
});
var ensureAtmosphereLightNodeRegistered = (renderer) => {
  const lightLibrary = getRendererLightNodeLibrary(renderer);
  if (!lightLibrary) {
    return;
  }
  if (lightLibrary.getLightNodeClass(AtmosphereLight)) {
    return;
  }
  lightLibrary.addLight(AtmosphereLightNode, AtmosphereLight);
};
var createAtmosphereRig = (scene, options = {}) => {
  let baseAtmosphereSettings = normalizeRigAtmosphereSettings(
    options.atmosphereSettings ?? DEFAULT_ATMOSPHERE_SETTINGS
  );
  const skyLayer = THREE2.MathUtils.clamp(
    Math.floor(options.skyLayer ?? DEFAULT_SKY_LAYER),
    0,
    31
  );
  const sunDistance = Number.isFinite(options.sunDistance) && (options.sunDistance ?? 0) > 0 ? options.sunDistance : DEFAULT_SUN_DISTANCE;
  const maxSunIntensity = Number.isFinite(options.maxSunIntensity) && (options.maxSunIntensity ?? 0) > 0 ? options.maxSunIntensity : DEFAULT_MAX_SUN_INTENSITY;
  const syncAtmosphereToSun = options.syncAtmosphereToSun ?? true;
  const atmosphere = createAtmosphereSystem(
    scene,
    baseAtmosphereSettings,
    options.atmosphereSystemOptions
  );
  atmosphere.setSkyLayer(skyLayer);
  const sunTarget = new THREE2.Object3D();
  scene.add(sunTarget);
  const sunLight = new AtmosphereLight(atmosphere.getContext(), sunDistance);
  sunLight.target = sunTarget;
  sunLight.color.set(16777215);
  sunLight.intensity = DEFAULT_SUN_INTENSITY;
  scene.add(sunLight);
  const ambientLight = new THREE2.HemisphereLight(
    DEFAULT_AMBIENT_SKY_COLOR.getHex(),
    DEFAULT_AMBIENT_GROUND_COLOR.getHex(),
    DEFAULT_AMBIENT_INTENSITY
  );
  scene.add(ambientLight);
  const environmentOptions = options.environment ?? {};
  const environmentEnabled = environmentOptions.enabled ?? false;
  const environmentMode = environmentOptions.mode ?? "on-change";
  const environmentApplyToScene = environmentOptions.applyToSceneEnvironment ?? true;
  const environmentCaptureOnPrime = environmentOptions.captureOnPrime ?? true;
  const environmentCaptureLayer = THREE2.MathUtils.clamp(
    Math.floor(environmentOptions.captureLayer ?? skyLayer),
    0,
    31
  );
  const environmentTargets = environmentEnabled ? [
    createEnvironmentTarget(
      Math.max(16, Math.floor(environmentOptions.resolution ?? DEFAULT_ENVIRONMENT_RESOLUTION))
    ),
    createEnvironmentTarget(
      Math.max(16, Math.floor(environmentOptions.resolution ?? DEFAULT_ENVIRONMENT_RESOLUTION))
    )
  ] : null;
  let environmentReadIndex = 0;
  let environmentWriteIndex = 1;
  const environmentCamera = environmentEnabled ? new THREE2.CubeCamera(
    environmentOptions.near ?? DEFAULT_ENVIRONMENT_NEAR,
    environmentOptions.far ?? DEFAULT_ENVIRONMENT_FAR,
    environmentTargets[environmentWriteIndex]
  ) : null;
  if (environmentCamera) {
    environmentCamera.layers.set(environmentCaptureLayer);
    scene.add(environmentCamera);
    if (environmentApplyToScene) {
      scene.environment = environmentTargets[environmentReadIndex].texture;
    }
  }
  const sunDirectionScratch = new THREE2.Vector3(0, 1, 0);
  const capturePositionScratch = new THREE2.Vector3(0, 0, 0);
  let ambientIntensity = Number.isFinite(options.ambientIntensity) && (options.ambientIntensity ?? -1) >= 0 ? options.ambientIntensity : DEFAULT_AMBIENT_INTENSITY;
  let sunState = {
    altitudeDeg: options.sun?.altitudeDeg ?? 35,
    azimuthDeg: options.sun?.azimuthDeg ?? 0,
    intensity: Math.max(0, options.sun?.intensity ?? DEFAULT_SUN_INTENSITY)
  };
  let environmentDirty = true;
  const syncSunState = () => {
    sunDirectionFromAngles(
      sunState.altitudeDeg,
      sunState.azimuthDeg,
      sunDirectionScratch
    );
    let atmosphereSettings = baseAtmosphereSettings;
    if (syncAtmosphereToSun) {
      const sunScale = THREE2.MathUtils.clamp(sunState.intensity / maxSunIntensity, 0, 1);
      atmosphereSettings = {
        ...baseAtmosphereSettings,
        skyIntensity: baseAtmosphereSettings.skyIntensity * sunScale,
        sunDiscIntensity: baseAtmosphereSettings.sunDiscIntensity * sunScale
      };
      atmosphere.setSettings(atmosphereSettings);
    }
    sunLight.atmosphereContext = atmosphere.getContext();
    atmosphere.setSunDirection(sunDirectionScratch);
    sunLight.color.set(16777215);
    sunLight.intensity = Math.max(0, sunState.intensity);
    sunTarget.position.set(0, 0, 0);
    sunLight.updateMatrixWorld(true);
    sunTarget.updateMatrixWorld();
    ambientLight.intensity = Math.max(0, ambientIntensity);
    environmentDirty = true;
  };
  const setSun = (next) => {
    sunState = {
      altitudeDeg: typeof next.altitudeDeg === "number" ? next.altitudeDeg : sunState.altitudeDeg,
      azimuthDeg: typeof next.azimuthDeg === "number" ? next.azimuthDeg : sunState.azimuthDeg,
      intensity: typeof next.intensity === "number" ? Math.max(0, next.intensity) : sunState.intensity
    };
    syncSunState();
  };
  const captureEnvironment = (renderer, position = capturePositionScratch) => {
    if (!environmentEnabled || !environmentCamera || !environmentTargets) {
      return;
    }
    const writeTarget = environmentTargets[environmentWriteIndex];
    const previousSceneEnvironment = scene.environment;
    scene.environment = null;
    environmentCamera.renderTarget = writeTarget;
    environmentCamera.position.copy(position);
    environmentCamera.update(renderer, scene);
    environmentReadIndex = environmentWriteIndex;
    environmentWriteIndex = (environmentWriteIndex + 1) % environmentTargets.length;
    scene.environment = environmentApplyToScene ? environmentTargets[environmentReadIndex].texture : previousSceneEnvironment;
    environmentDirty = false;
  };
  const setCameraPosition = (positionWorld3) => {
    atmosphere.setCameraPosition(positionWorld3);
    capturePositionScratch.copy(positionWorld3);
  };
  const update = (renderer, camera) => {
    ensureAtmosphereLightNodeRegistered(renderer);
    if (camera) {
      setCameraPosition(camera.position);
    }
    if (!environmentEnabled) {
      return;
    }
    if (environmentMode === "on-change" && environmentDirty) {
      captureEnvironment(renderer, capturePositionScratch);
    }
  };
  const renderBackground = (renderer, camera) => {
    atmosphere.renderBackground(renderer, camera);
  };
  const renderTransmittance = (renderer, camera) => {
    atmosphere.renderTransmittance(renderer, camera);
  };
  const requestEnvironmentCapture = () => {
    environmentDirty = true;
  };
  const prime = async (renderer) => {
    ensureAtmosphereLightNodeRegistered(renderer);
    await atmosphere.prime(renderer);
    syncSunState();
    if (environmentEnabled && environmentCaptureOnPrime) {
      captureEnvironment(renderer, capturePositionScratch);
    }
  };
  const setAtmosphereSettings = (next) => {
    baseAtmosphereSettings = normalizeRigAtmosphereSettings(next);
    if (syncAtmosphereToSun) {
      syncSunState();
      return;
    }
    atmosphere.setSettings(baseAtmosphereSettings);
    sunLight.atmosphereContext = atmosphere.getContext();
    atmosphere.setSunDirection(sunDirectionScratch);
    environmentDirty = true;
  };
  const setAmbientIntensity = (next) => {
    ambientIntensity = Math.max(0, next);
    ambientLight.intensity = ambientIntensity;
  };
  const getEnvironmentTexture = () => {
    if (!environmentEnabled || !environmentTargets) {
      return null;
    }
    return environmentTargets[environmentReadIndex].texture;
  };
  const dispose = () => {
    atmosphere.dispose();
    scene.remove(sunLight);
    scene.remove(sunTarget);
    scene.remove(ambientLight);
    if (environmentCamera) {
      scene.remove(environmentCamera);
    }
    if (environmentTargets) {
      for (const target of environmentTargets) {
        target.dispose();
      }
    }
    if (environmentApplyToScene && scene.environment) {
      const currentTexture = scene.environment;
      if (currentTexture === getEnvironmentTexture()) {
        scene.environment = null;
      }
    }
  };
  syncSunState();
  return {
    atmosphere,
    sunLight,
    sunTarget,
    ambientLight,
    prime,
    renderBackground,
    renderTransmittance,
    update,
    setSun,
    setSunAngles: (altitudeDeg, azimuthDeg) => {
      setSun({ altitudeDeg, azimuthDeg });
    },
    setSunIntensity: (intensity) => {
      setSun({ intensity });
    },
    setAtmosphereSettings,
    setAmbientIntensity,
    requestEnvironmentCapture,
    captureEnvironment,
    setCameraPosition,
    getEnvironmentTexture,
    dispose
  };
};
export {
  AtmosphereLight,
  AtmosphereLightNode,
  AtmosphereParameters,
  DEFAULT_ATMOSPHERE_SETTINGS,
  createAtmosphereRig,
  createAtmosphereSystem,
  deriveSolarIrradiance,
  deriveSunAngularRadius,
  sunDirectionFromAngles
};
