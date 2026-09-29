import * as THREE from "three";
import { Pass } from "postprocessing";
import {
  VOLUMETRIC_LIGHT_VERTEX,
  VOLUMETRIC_LIGHT_MASK_FRAGMENT,
  VOLUMETRIC_LIGHT_RAYS_FRAGMENT,
} from "./glsl/volumetricLight";

// ─────────────────────────────────────────────────────────────────────────────
// VolumetricLightPass — god rays as a composer pass. See glsl/volumetricLight.ts
// for what the march is doing and README.md for the shape of it.
//
// Declaring `needsDepthTexture` is what makes this work: the composer notices,
// creates a depth texture off its render pass and hands it over via
// setDepthTexture. Nothing has to be re-rendered for it.
//
// Put it EARLY in the chain, ahead of any stylisation — see the warning on the
// React wrapper, which is about depth and is not a matter of taste.
// ─────────────────────────────────────────────────────────────────────────────

export interface VolumetricLightOptions {
  /** Master strength. 0 is off and costs nothing — the shader returns early. */
  intensity?: number;
  /** How far along the pixel→sun line the march walks, as a fraction of that
   *  distance. 1 reaches the disc; lower stops the shafts short of it. */
  density?: number;
  /** Per-step falloff, so a shaft fades along its length instead of ending. */
  decay?: number;
  /** Steps per pixel. A quality knob only — the result is normalised by the
   *  weights it used, so moving this does not change the brightness. */
  samples?: number;
  /** Fraction of a step each pixel is jittered by. Without it a low sample
   *  count draws the march as concentric arcs. */
  dither?: number;
  /** Luminance a pixel needs before it emits, and how sharply that cuts in.
   *
   *  In LINEAR light, not sRGB: the composer's buffers are pre-tone-map, so a
   *  daylight sky that looks like 0.7 on screen is nearer 0.4 here. The default
   *  sits under a lit sky and well over a night one, which is what makes the
   *  same effect produce shafts at noon and almost nothing at midnight without
   *  anything gating it per preset. */
  threshold?: number;
  softness?: number;
  /** 1 = only the sky (depth-cleared pixels) emits. Lower it to let bright
   *  geometry throw shafts too. */
  skyOnly?: number;
  /** How far from the disc the shafts reach, in screen heights, and the curve
   *  of that falloff. Past ~1.5 the cut is off-frame, i.e. effectively off. */
  reach?: number;
  reachPow?: number;
  /** Colour bias. `tintMix` 0 keeps the sky's own colour. */
  tint?: THREE.ColorRepresentation;
  tintMix?: number;
  /** Dust in the air: breaks the fan into separate beams. 0 = a clean fan. */
  noiseAmount?: number;
  noiseScale?: number;
  noiseSpeed?: number;
  /** Size of the mask target relative to the frame. Half is the default and is
   *  not only a cost decision — the downsample softens the mask, and shafts
   *  want to be soft. Full resolution mostly buys aliasing. */
  resolutionScale?: number;
}

export class VolumetricLightPass extends Pass {
  private readonly maskMaterial: THREE.ShaderMaterial;
  private readonly rayMaterial: THREE.ShaderMaterial;
  private readonly maskTarget: THREE.WebGLRenderTarget;
  private readonly resolutionScale: number;

  /**
   * The SCENE camera — deliberately not called `camera`, which the base Pass
   * already owns for the fullscreen triangle. Without it the sun cannot be
   * projected onto the screen and the pass passes the image through.
   */
  sceneCamera: THREE.Camera | null = null;

  /**
   * Where the sun disc IS, in world space.
   *
   * A position, not a direction, and the difference is not small: the sky dome
   * is centred on the camera LIFTED by its Y offset, so the disc hangs off THAT
   * centre. Projecting a bare direction from the camera lands the origin of the
   * shafts somewhere the sun is not — about 12° off at a dome offset of 190 with
   * radius 900, which is a whole disc and a half. Feed it SkyDome's `moonPosRef`,
   * which has already resolved this.
   */
  readonly sunWorldPosition = new THREE.Vector3(0, 1, 0);

  /** Advanced by whoever owns the pass; the React wrapper does it from the frame
   *  loop. Left at 0 the strands are simply static, which is a look and not a
   *  bug. */
  private _time = 0;

  private readonly _vp = new THREE.Matrix4();
  private readonly _clip = new THREE.Vector4();

  constructor({
    intensity = 0.5,
    density = 0.85,
    decay = 0.965,
    samples = 40,
    dither = 1,
    threshold = 0.15,
    softness = 0.3,
    skyOnly = 1,
    reach = 1.6,
    reachPow = 1.4,
    tint = "#ffe6bd",
    tintMix = 0.35,
    noiseAmount = 0.35,
    noiseScale = 6,
    noiseSpeed = 0.05,
    resolutionScale = 0.5,
  }: VolumetricLightOptions = {}) {
    super("VolumetricLightPass");

    this.needsSwap = true;
    this.needsDepthTexture = true;
    this.resolutionScale = resolutionScale;

    this.maskMaterial = new THREE.ShaderMaterial({
      name: "VolumetricLightMaskMaterial",
      vertexShader: VOLUMETRIC_LIGHT_VERTEX,
      fragmentShader: VOLUMETRIC_LIGHT_MASK_FRAGMENT,
      uniforms: {
        uColor: { value: null },
        uDepth: { value: null },
        uThreshold: { value: threshold },
        uSoftness: { value: softness },
        uSkyOnly: { value: skyOnly },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.rayMaterial = new THREE.ShaderMaterial({
      name: "VolumetricLightRaysMaterial",
      vertexShader: VOLUMETRIC_LIGHT_VERTEX,
      fragmentShader: VOLUMETRIC_LIGHT_RAYS_FRAGMENT,
      uniforms: {
        uColor: { value: null },
        uMask: { value: null },
        // 0 = composite (normal), 1 = the emitter mask, 2 = the shafts alone
        // on black. For explaining the effect; see the filter's `debugView`.
        uDebugView: { value: 0 },
        uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
        uVisible: { value: 0 },
        uAspect: { value: 1.78 },
        uIntensity: { value: intensity },
        uDensity: { value: density },
        uDecay: { value: decay },
        uSamples: { value: samples },
        uDither: { value: dither },
        uReach: { value: reach },
        uReachPow: { value: reachPow },
        uTint: { value: new THREE.Color(tint) },
        uTintMix: { value: tintMix },
        uNoiseAmount: { value: noiseAmount },
        uNoiseScale: { value: noiseScale },
        uNoiseSpeed: { value: noiseSpeed },
        uTime: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });

    // Half float, and it matters: the mask carries the sky's colour straight out
    // of the input buffer, which in a bloom chain is HDR. An 8-bit target would
    // clip the sun to white before the march ever sees it, and the shafts would
    // lose exactly the brightness that makes them shafts.
    this.maskTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.maskTarget.texture.name = "VolumetricLight.Mask";

    this.fullscreenMaterial = this.rayMaterial;
  }

  /** The composer assigns this to every pass it owns; the React wrapper sets
   *  `sceneCamera` directly, and either route ends up in the same place. */
  override set mainCamera(value: THREE.Camera) {
    this.sceneCamera = value;
  }

  override setDepthTexture(depthTexture: THREE.Texture): void {
    this.maskMaterial.uniforms.uDepth.value = depthTexture;
  }

  override setSize(width: number, height: number): void {
    this.maskTarget.setSize(
      Math.max(1, Math.round(width * this.resolutionScale)),
      Math.max(1, Math.round(height * this.resolutionScale)),
    );
    this.rayMaterial.uniforms.uAspect.value = width / Math.max(height, 1);
  }

  /** The strands' only moving part. */
  set time(value: number) {
    this._time = value;
    this.rayMaterial.uniforms.uTime.value = value;
  }

  get time(): number {
    return this._time;
  }

  /** Live uniforms for the march. Every knob on this pass is one of these or a
   *  mask uniform, so a panel can write them straight in without a rebuild. */
  get uniforms(): Record<string, THREE.IUniform> {
    return this.rayMaterial.uniforms;
  }

  /** Live uniforms for the emitter mask — threshold, softness, sky-only. */
  get maskUniforms(): Record<string, THREE.IUniform> {
    return this.maskMaterial.uniforms;
  }

  /**
   * Puts the sun on screen, and decides whether marching toward it means
   * anything at all.
   *
   * Behind the camera (`w <= 0`) the projected point is the disc's MIRROR
   * image, so the shafts would fan out of a sun that is not there and run the
   * wrong way — hence the hard 0. Off the sides it is only a matter of the
   * origin leaving the frame, which is fine and common (the shafts are still
   * legible long after the disc has gone), so that end fades over a generous
   * margin rather than cutting.
   */
  private updateSun(): number {
    const cam = this.sceneCamera;
    if (!cam) return 0;

    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    this._vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

    const p = this.sunWorldPosition;
    this._clip.set(p.x, p.y, p.z, 1).applyMatrix4(this._vp);
    if (this._clip.w <= 0) return 0;

    const sx = (this._clip.x / this._clip.w) * 0.5 + 0.5;
    const sy = (this._clip.y / this._clip.w) * 0.5 + 0.5;
    (this.rayMaterial.uniforms.uSunUv.value as THREE.Vector2).set(sx, sy);

    const fx = (Math.min(sx, 1 - sx) + 0.25) / 0.35;
    const fy = (Math.min(sy, 1 - sy) + 0.25) / 0.35;
    return Math.max(0, Math.min(1, Math.min(fx, fy)));
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
  ): void {
    const visible = this.updateSun();
    this.rayMaterial.uniforms.uVisible.value = visible;

    // Nothing to march toward: hand the image on untouched rather than paying
    // for a mask nobody will read. The ray shader early-outs per pixel anyway,
    // but this skips the whole first draw.
    if (visible <= 0 || this.rayMaterial.uniforms.uIntensity.value <= 0) {
      this.rayMaterial.uniforms.uColor.value = inputBuffer.texture;
      this.rayMaterial.uniforms.uMask.value = this.maskTarget.texture;
      // Asserted rather than assumed: the two draws below swap the screen mesh's
      // material, and this path must not inherit the mask's.
      this.fullscreenMaterial = this.rayMaterial;
      renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
      renderer.render(this.scene, this.camera);
      return;
    }

    // ── 1. Emitter mask, into the half-res target ────────────────────────────
    this.maskMaterial.uniforms.uColor.value = inputBuffer.texture;
    this.fullscreenMaterial = this.maskMaterial;
    renderer.setRenderTarget(this.maskTarget);
    renderer.render(this.scene, this.camera);

    // ── 2. The march, over the scene ─────────────────────────────────────────
    this.rayMaterial.uniforms.uColor.value = inputBuffer.texture;
    this.rayMaterial.uniforms.uMask.value = this.maskTarget.texture;
    this.fullscreenMaterial = this.rayMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    // this.camera is the base Pass's ortho camera for the fullscreen triangle,
    // NOT the scene camera above.
    renderer.render(this.scene, this.camera);
  }

  override dispose(): void {
    this.maskMaterial.dispose();
    this.rayMaterial.dispose();
    this.maskTarget.dispose();
    super.dispose();
  }
}
