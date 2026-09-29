// Volumetric light — god rays marched from the sun's screen position.
// See README.md. The pass needs only `three` + `postprocessing`; the component
// is the one file that needs React and Leva.

export {
  VolumetricLightPass,
  type VolumetricLightOptions,
} from "./VolumetricLightPass";
export {
  VOLUMETRIC_LIGHT_VERTEX,
  VOLUMETRIC_LIGHT_MASK_FRAGMENT,
  VOLUMETRIC_LIGHT_RAYS_FRAGMENT,
} from "./glsl/volumetricLight";
