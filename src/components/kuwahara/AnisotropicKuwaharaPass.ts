import * as THREE from "three";
import { Pass } from "postprocessing";
import { STRUCTURE_TENSOR_FRAGMENT } from "./glsl/structureTensor";
import {
  ANISOTROPIC_KUWAHARA_FRAGMENT,
  FULLSCREEN_VERTEX,
  KUWAHARA_DEBUG,
  type KuwaharaDebugMode,
} from "./glsl/anisotropicKuwahara";

// ─────────────────────────────────────────────────────────────────────────────
// AnisotropicKuwaharaPass — the oil-paint filter, as ONE composer pass.
//
// It is two shaders (structure tensor → Kuwahara) but a single Pass on purpose:
// the tensor is scratch data that only this filter reads, so it belongs in a
// render target this pass owns rather than in the composer's shared buffers.
// The composer never has to know the filter has an internal stage.
//
// Because it is a `postprocessing` Pass, it drops into the SAME EffectComposer
// as everything else — bloom included — and the scene is rendered exactly once.
//
// Where it sits in the chain matters: the input buffer is the scene as rendered,
// so anything the composer ran before this gets painted over too. The rule is
// to put it FIRST, with bloom after, so the glow blooms off the painted image
// rather than the paint being applied to an already-glowing one.
//
// The rule bends for any pass that reads the DEPTH buffer — a lens flare
// testing occlusion, SSAO, a depth-based fog. `postprocessing` attaches the
// scene's depth texture to the composer's INITIAL input buffer, and every pass
// with `needsSwap` flips input and output, so a few passes in that attachment
// has been used as a render target and cleared. Those passes have to run before
// this one, which puts the paint after them. See PainterlySceneContent for the
// real case: fog and lens flare first, paint last.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Defaults, and the single source of truth for them: the constructor and the
 * Leva panel both read this object, so a knob cannot start at one value in the
 * pass and a different one in the panel.
 *
 * `alpha` is deliberately small. It is an eccentricity limit that saturates
 * fast — see the shader — and at the double-digit values this used to run at
 * the kernel is round to within a few percent, which turns the anisotropy off
 * in all but name. 2 gives a visibly directional stroke while still relaxing
 * to a circle wherever the image has no flow.
 */
export const KUWAHARA_DEFAULTS = {
  radius: 3,
  alpha: 2,
  eta: 0.36,
  lambda: 0.85,
} as const;

export interface AnisotropicKuwaharaOptions {
  /** Brush size, in pixels of kernel radius. THE cost knob: the filter samples
   *  8 sectors × radius × 5 per pixel. */
  radius?: number;
  /** Kernel eccentricity limit. Lower = strokes stretch along the flow sooner
   *  and harder. */
  alpha?: number;
  /** Sector weight polynomial. Rarely worth touching — see the shader. */
  eta?: number;
  lambda?: number;
  /** Swap the paint for a picture of one of the filter's own intermediate
   *  values. Teaching aid; see KUWAHARA_DEBUG. */
  debug?: KuwaharaDebugMode;
  /** Before/after wipe, as a fraction of screen width. 0 disables. */
  split?: number;
}

export class AnisotropicKuwaharaPass extends Pass {
  private readonly tensorTarget: THREE.WebGLRenderTarget;
  private readonly tensorMaterial: THREE.ShaderMaterial;
  private readonly kuwaharaMaterial: THREE.ShaderMaterial;

  constructor({
    radius = KUWAHARA_DEFAULTS.radius,
    alpha = KUWAHARA_DEFAULTS.alpha,
    eta = KUWAHARA_DEFAULTS.eta,
    lambda = KUWAHARA_DEFAULTS.lambda,
    debug = KUWAHARA_DEBUG.OFF,
    split = 0,
  }: AnisotropicKuwaharaOptions = {}) {
    super("AnisotropicKuwaharaPass");

    // This pass writes a new image, so the composer must swap its buffers after
    // it — otherwise the next pass would read the pre-paint scene.
    this.needsSwap = true;

    // Half float: the tensor holds squared gradient sums, which run well past
    // 1.0 and would clip to a flat orientation field in an 8-bit target.
    this.tensorTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.tensorTarget.texture.name = "Kuwahara.StructureTensor";

    this.tensorMaterial = new THREE.ShaderMaterial({
      name: "StructureTensorMaterial",
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: STRUCTURE_TENSOR_FRAGMENT,
      uniforms: {
        uInput: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.kuwaharaMaterial = new THREE.ShaderMaterial({
      name: "AnisotropicKuwaharaMaterial",
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: ANISOTROPIC_KUWAHARA_FRAGMENT,
      uniforms: {
        uTensor: { value: this.tensorTarget.texture },
        uColor: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uRadius: { value: radius },
        uAlpha: { value: alpha },
        uEta: { value: eta },
        uLambda: { value: lambda },
        uDebug: { value: debug },
        uSplit: { value: split },
      },
      depthTest: false,
      depthWrite: false,
    });

    // Creates the shared fullscreen triangle. Which material is on it gets
    // swapped per stage in render().
    this.fullscreenMaterial = this.kuwaharaMaterial;
  }

  get radius(): number {
    return this.kuwaharaMaterial.uniforms.uRadius.value as number;
  }

  set radius(value: number) {
    this.kuwaharaMaterial.uniforms.uRadius.value = value;
  }

  get alpha(): number {
    return this.kuwaharaMaterial.uniforms.uAlpha.value as number;
  }

  set alpha(value: number) {
    this.kuwaharaMaterial.uniforms.uAlpha.value = value;
  }

  get eta(): number {
    return this.kuwaharaMaterial.uniforms.uEta.value as number;
  }

  set eta(value: number) {
    this.kuwaharaMaterial.uniforms.uEta.value = value;
  }

  get lambda(): number {
    return this.kuwaharaMaterial.uniforms.uLambda.value as number;
  }

  set lambda(value: number) {
    this.kuwaharaMaterial.uniforms.uLambda.value = value;
  }

  get debug(): KuwaharaDebugMode {
    return this.kuwaharaMaterial.uniforms.uDebug.value as KuwaharaDebugMode;
  }

  set debug(value: KuwaharaDebugMode) {
    this.kuwaharaMaterial.uniforms.uDebug.value = value;
  }

  get split(): number {
    return this.kuwaharaMaterial.uniforms.uSplit.value as number;
  }

  set split(value: number) {
    this.kuwaharaMaterial.uniforms.uSplit.value = value;
  }

  /** Called by the composer with the DRAWING BUFFER size — which is what
   *  `gl_FragCoord` is in, so the two agree by construction. */
  override setSize(width: number, height: number): void {
    this.tensorTarget.setSize(width, height);
    (this.tensorMaterial.uniforms.uResolution.value as THREE.Vector2).set(
      width,
      height,
    );
    (this.kuwaharaMaterial.uniforms.uResolution.value as THREE.Vector2).set(
      width,
      height,
    );
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
  ): void {
    // ── 1. Scene → structure tensor ─────────────────────────────────────────
    this.tensorMaterial.uniforms.uInput.value = inputBuffer.texture;
    this.fullscreenMaterial = this.tensorMaterial;
    renderer.setRenderTarget(this.tensorTarget);
    renderer.render(this.scene, this.camera);

    // ── 2. Scene + tensor → paint ───────────────────────────────────────────
    // Colours come from the input buffer, NOT from the tensor target: the
    // filter averages original pixels, and feeding it its own output would
    // smear the image a little more every frame.
    this.kuwaharaMaterial.uniforms.uColor.value = inputBuffer.texture;
    this.fullscreenMaterial = this.kuwaharaMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override dispose(): void {
    this.tensorTarget.dispose();
    this.tensorMaterial.dispose();
    this.kuwaharaMaterial.dispose();
    super.dispose();
  }
}
