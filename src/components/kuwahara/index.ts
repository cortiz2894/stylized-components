// Anisotropic Kuwahara — a screen-space oil-paint filter. See README.md.
//
// The pass itself depends only on `three` + `postprocessing`. The component is
// the only file that needs React and Leva, so a project without them can import
// the pass alone and add it to a composer by hand.

export {
  AnisotropicKuwaharaPass,
  KUWAHARA_DEFAULTS,
  type AnisotropicKuwaharaOptions,
} from "./AnisotropicKuwaharaPass";

export { STRUCTURE_TENSOR_FRAGMENT } from "./glsl/structureTensor";
export {
  ANISOTROPIC_KUWAHARA_FRAGMENT,
  FULLSCREEN_VERTEX,
  KUWAHARA_DEBUG,
  type KuwaharaDebugMode,
} from "./glsl/anisotropicKuwahara";
