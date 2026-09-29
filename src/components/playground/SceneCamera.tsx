"use client";

import { useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useControls, folder, button } from "leva";
import { MathUtils } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

// Spherical defaults that match the previous DEFAULT_POS ≈ [16.5, 12.5, -5.0]
const DEFAULT_AZIMUTH = -135; // deg — horizontal angle (0 = +Z axis, 90 = +X axis)
const DEFAULT_POLAR = 58; // deg — vertical angle  (0 = top, 90 = horizon)
const DEFAULT_RADIUS = 17.0; // world units — distance from target
const ORIGIN: [number, number, number] = [0, 0, 0];

interface SceneCameraProps {
  /** Starting orbit for this scene — also what "Reset Camera" returns to. */
  azimuth?: number;
  polar?: number;
  radius?: number;
  /** What the orbit is centred on. The default origin suits a scene laid out
   *  around it (a floor, a water plane); a TALL subject standing on y = 0 wants
   *  its own mid-height here, or the camera spends the whole orbit looking at
   *  its feet. */
  target?: [number, number, number];
  /** Leva folder. Leva's store is global and keyed by folder + control name, so
   *  two scenes sharing this component under the same folder would also share
   *  its VALUES: whatever you dragged in one demo would carry into the next.
   *  Each scene passes its own folder to stay isolated. */
  folder?: string;
  /** Vertical FOV in degrees. Part of the shot, so it belongs with the orbit. */
  fov?: number;
  /**
   * How the orbit FEELS, as opposed to how far it may go.
   *
   * `rotateSpeed` matters most on a tightly clamped shot: at OrbitControls'
   * default of 1.0 a single flick crosses a narrow window end to end, so the
   * only thing the visitor ever feels is the clamp. Lower it and the limits
   * stop being reachable by accident.
   */
  rotateSpeed?: number;
  /** How far one wheel notch asks to travel. The move itself is damped. */
  zoomSpeed?: number;
  /** Damping rate per SECOND for the dolly. Lower drifts longer. */
  zoomSmoothing?: number;
  /** How far a VISITOR may stray from the shot above. The defaults suit a scene
   *  laid out around the origin; a baked shot must sit INSIDE them, or
   *  OrbitControls clamps it on the first update and the framing is lost — a
   *  polar of 101° with the default 85° ceiling snaps the moment it loads. */
  limits?: {
    minDistance?: number;
    maxDistance?: number;
    /** Degrees from straight up. Over 90 puts the camera below the target,
     *  looking up — which is a shot, not a mistake. */
    minPolar?: number;
    maxPolar?: number;
    /**
     * How far the visitor may swing left or right OF THE SHOT, in degrees.
     * Undefined leaves the orbit free all the way round.
     *
     * Relative rather than absolute min/max on purpose. The window then travels
     * with the framing: re-baking `azimuth` cannot leave the shot sitting
     * outside its own limits, which is the trap the polar note above describes
     * and the one thing about angle clamps that reliably bites.
     */
    azimuthRange?: number;
  };
  /**
   * Panning moves the orbit TARGET, so it is the one interaction that can take
   * the subject off centre — no angle or distance clamp constrains it, and a
   * visitor can pan the subject clean out of frame. Off is the right default for
   * a scene built around one subject; it stays on by default here only because
   * the demos that already use this component expect it.
   */
  enablePan?: boolean;
  /** Starting state of the "Free Camera" toggle — the framing mode. Off, the
   *  orbit is clamped for visitors; on, every limit is lifted so a shot can be
   *  found, and "Copy Camera JSON" writes out what was found. Turn it back off
   *  once the numbers are baked into the props above. */
  freeCamera?: boolean;
}

/** Rounded so a pasted JSON reads like something a person wrote. */
const r2 = (n: number) => Math.round(n * 100) / 100;

export default function SceneCamera({
  azimuth: initialAzimuth = DEFAULT_AZIMUTH,
  polar: initialPolar = DEFAULT_POLAR,
  radius: initialRadius = DEFAULT_RADIUS,
  target = ORIGIN,
  fov: initialFov = 50,
  rotateSpeed: initialRotateSpeed = 1,
  zoomSpeed: initialZoomSpeed = 0.5,
  zoomSmoothing: initialZoomSmoothing = 4,
  limits,
  folder: folderName = "Camera",
  freeCamera: freeCameraDefault = false,
  enablePan: enablePanDefault = true,
}: SceneCameraProps = {}) {
  const lim = {
    minDistance: limits?.minDistance ?? 3,
    maxDistance: limits?.maxDistance ?? 40,
    minPolar: limits?.minPolar ?? 10,
    maxPolar: limits?.maxPolar ?? 85,
    // 180 = the full sweep either way, i.e. unlimited. Using the slider's own
    // top end as "off" keeps this one number instead of a number plus a toggle.
    azimuthRange: limits?.azimuthRange ?? 180,
  };
  const [targetX, targetY, targetZ] = target;

  const controlsRef = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  /**
   * The current shot, in the shape this component's own props take — so what
   * comes out of the console goes straight back in as `<SceneCamera {...} />`.
   *
   * Read from the CONTROLS, not from the Leva sliders: panning and dollying
   * with the mouse move the camera without touching them, and those moves are
   * the whole point of framing mode.
   */
  const readShot = () => {
    const controls = controlsRef.current;
    if (!controls) return null;

    const t = controls.target;
    const offX = camera.position.x - t.x;
    const offY = camera.position.y - t.y;
    const offZ = camera.position.z - t.z;
    const radius = Math.sqrt(offX * offX + offY * offY + offZ * offZ);

    return {
      // Same spherical convention as the positioning effect below:
      // position = target + r · (sinφ·sinθ, cosφ, sinφ·cosθ)
      azimuth: r2(MathUtils.radToDeg(Math.atan2(offX, offZ))),
      polar: r2(
        MathUtils.radToDeg(Math.acos(MathUtils.clamp(offY / radius, -1, 1))),
      ),
      radius: r2(radius),
      target: [r2(t.x), r2(t.y), r2(t.z)],
      fov: "fov" in camera ? r2(camera.fov) : undefined,
      // Not a prop — just here to read against the viewport while framing.
      position: [
        r2(camera.position.x),
        r2(camera.position.y),
        r2(camera.position.z),
      ],
    };
  };

  const logShot = (why: string) => {
    const shot = readShot();
    if (!shot) return;
    const json = JSON.stringify(shot, null, 2);
    console.log(`[${folderName}] ${why}\n${json}`);
    return json;
  };

  const {
    autoRotate,
    autoRotateSpeed,
    dampingFactor,
    minDistance,
    maxDistance,
    minPolarAngle,
    maxPolarAngle,
    rotateSpeed,
    zoomSpeed,
    zoomSmoothing,
    azimuthRange,
    enablePan,
    fov,
    azimuth,
    polar,
    radius,
    targetX: targetXCtl,
    targetY: targetYCtl,
    targetZ: targetZCtl,
    freeCamera,
    logOnRelease,
  } = useControls(folderName, {
    autoRotate: { value: false, label: "Auto Rotate" },
    autoRotateSpeed: {
      value: 0.05,
      min: 0.01,
      max: 5,
      step: 0.01,
      label: "Rotate Speed",
    },
    dampingFactor: {
      value: 0.08,
      min: 0.01,
      max: 0.3,
      step: 0.01,
      label: "Damping (rotate)",
    },
    // Unexposed until now, and it was sitting at OrbitControls' default of 1.0.
    // That is a sensible number for a scene you can orbit all the way round and
    // a bad one for a shot with a 24° window, where a single flick crosses the
    // whole range and slams into the clamp. Lower it and the wall stops being
    // something you can reach by accident.
    rotateSpeed: {
      value: initialRotateSpeed,
      min: 0.05,
      max: 2,
      step: 0.05,
      label: "Drag Sensitivity",
    },
    // How much of the distance one wheel notch asks for. The move itself is
    // damped (see the dolly below), so this is "how far", not "how fast".
    zoomSpeed: {
      value: initialZoomSpeed,
      min: 0.05,
      max: 3,
      step: 0.05,
      label: "Zoom Step",
    },
    // Per SECOND, unlike OrbitControls' own damping, which is a per-FRAME
    // multiply and therefore settles ~2.4× faster at 144fps than at 60.
    zoomSmoothing: {
      value: initialZoomSmoothing,
      min: 0.5,
      max: 20,
      step: 0.1,
      label: "Zoom Smoothing (low = slower)",
    },
    minDistance: {
      value: lim.minDistance,
      min: 0.1,
      max: Math.max(20, lim.minDistance * 2),
      step: 0.5,
      label: "Min Distance",
    },
    maxDistance: {
      value: lim.maxDistance,
      min: 1,
      max: Math.max(100, lim.maxDistance * 2),
      step: 1,
      label: "Max Distance",
    },
    // Full hemisphere-to-hemisphere: a scene may legitimately want the camera
    // below its subject, and a 90° ceiling here could not even hold the number.
    minPolarAngle: {
      value: lim.minPolar,
      min: 0,
      max: 180,
      step: 1,
      label: "Min Polar (deg)",
    },
    maxPolarAngle: {
      value: lim.maxPolar,
      min: 0,
      max: 180,
      step: 1,
      label: "Max Polar (deg)",
    },
    // Measured from the shot, not from the world — see the prop's note.
    azimuthRange: {
      value: lim.azimuthRange,
      min: 0,
      max: 180,
      step: 1,
      label: "Swing ± (deg, 180 = free)",
    },
    // The orbit's own centre. Off, it cannot be moved at all, which is what
    // keeps a framed subject framed.
    enablePan: { value: enablePanDefault, label: "Allow Pan" },
    fov: { value: initialFov, min: 20, max: 120, step: 1, label: "FOV" },

    // ── Framing ───────────────────────────────────────────────────────────
    // For finding a shot, not for visitors. With Free Camera on, every clamp
    // above is ignored — dolly to a metre or to a kilometre, orbit under the
    // floor — and the two readouts below are how the result gets out of the
    // browser and into the props.
    Framing: folder(
      {
        freeCamera: {
          value: freeCameraDefault,
          label: "Free Camera (no limits)",
        },
        logOnRelease: {
          value: freeCameraDefault,
          label: "Log on Mouse Release",
        },
        "Copy Camera JSON": button(() => {
          const json = logShot("camera");
          if (!json) return;
          // Clipboard first, console always: the console copy is the one that
          // survives a browser refusing clipboard access.
          navigator.clipboard?.writeText(json).catch(() => {});
        }),
      },
      { collapsed: false },
    ),

    "Initial Orbit": folder(
      {
        azimuth: {
          value: initialAzimuth,
          min: -180,
          max: 180,
          step: 1,
          label: "Azimuth (deg)",
        },
        // Past 90° the camera is below the target looking up — a legitimate
        // hero shot, and something framing mode can reach, so the slider has
        // to be able to hold the number that comes back.
        polar: {
          value: initialPolar,
          min: 1,
          max: 179,
          step: 1,
          label: "Polar (deg)",
        },
        // Range follows whatever the scene asked for, so baking a far-away
        // shot back into the props doesn't get clamped on the way in.
        radius: {
          value: initialRadius,
          min: 0.1,
          max: Math.max(120, initialRadius * 3),
          step: 0.5,
          label: "Radius",
        },
        // ── The orbit centre, and the only way to MOVE the viewpoint ─────────
        // Azimuth, polar and radius all move the camera AROUND a fixed point;
        // raising or lowering the shot means moving the point. OrbitControls
        // has panning for that, and it is useless here: its pan speed scales
        // with the distance to the target, so on a shot framed as a fixed
        // viewpoint (radius of a few centimetres — see the rainy scene) a full
        // drag across the screen moves the camera by millimetres.
        //
        // Deliberately WITHOUT min/max, which is what makes Leva render them as
        // draggable number fields rather than sliders: for placing a camera you
        // want to drag a value until it looks right and then type an exact one,
        // and a slider pinned to an arbitrary range gives you neither.
        targetX: { value: targetX, step: 0.25, label: "Target X" },
        targetY: { value: targetY, step: 0.25, label: "Target Y" },
        targetZ: { value: targetZ, step: 0.25, label: "Target Z" },
        "Reset Camera": button(() => {
          if (!controlsRef.current) return;
          const phi = MathUtils.degToRad(initialPolar);
          const theta = MathUtils.degToRad(initialAzimuth);
          // Panning moves the target, so a reset has to put it back too.
          controlsRef.current.target.set(targetX, targetY, targetZ);
          camera.position.set(
            targetX + initialRadius * Math.sin(phi) * Math.sin(theta),
            targetY + initialRadius * Math.cos(phi),
            targetZ + initialRadius * Math.sin(phi) * Math.cos(theta),
          );
          controlsRef.current.update();
        }),
      },
      { collapsed: false },
    ),
  });

  // Spherical → Cartesian, around the orbit target: reposition the camera
  // whenever azimuth/polar/radius change. The target is spread into three
  // numbers so an inline array literal at the call site can't re-run this — and
  // snap the camera back — on every render.
  //
  // It is written onto the controls HERE rather than passed to <OrbitControls>
  // as a prop: a prop is re-applied whenever R3F diffs it, which would drag the
  // view back every render and undo the user's panning.
  useEffect(() => {
    const phi = MathUtils.degToRad(polar);
    const theta = MathUtils.degToRad(azimuth);
    controlsRef.current?.target.set(targetXCtl, targetYCtl, targetZCtl);
    camera.position.set(
      targetXCtl + radius * Math.sin(phi) * Math.sin(theta),
      targetYCtl + radius * Math.cos(phi),
      targetZCtl + radius * Math.sin(phi) * Math.cos(theta),
    );
    controlsRef.current?.update();
    // The PANEL's target, not the prop's: the prop is only its starting value.
    // Reading the prop here instead would mean the sliders moved a number
    // nothing looked at.
  }, [
    azimuth,
    polar,
    radius,
    camera,
    targetXCtl,
    targetYCtl,
    targetZCtl,
  ]);

  // ── Damped dolly ───────────────────────────────────────────────────────────
  // OrbitControls' zoom is NOT damped, `enableDamping` notwithstanding. Its
  // update() reads:
  //
  //     spherical.radius = clampDistance(spherical.radius * scale);
  //     scale = 1;
  //
  // — the whole wheel notch is applied on the frame it arrives and the
  // accumulator is reset, so zooming lands as a step however low dampingFactor
  // is. That is the "stops dead" half of the problem; rotation at least glides.
  //
  // So the wheel moves a TARGET distance here and the real one chases it with
  // the same frame-rate-independent damp() the mouse parallax uses. Clamping
  // the target rather than the position is what makes the ends of the range
  // feel like arriving instead of like hitting something: the target stops, the
  // camera keeps easing into it.
  const dollyRef = useRef<{ target: number | null }>({ target: null });

  useEffect(() => {
    const el = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      const controls = controlsRef.current;
      if (!controls) return;
      e.preventDefault();
      const d = dollyRef.current;
      const current = camera.position.distanceTo(controls.target);
      // Multiplicative, like OrbitControls' own dolly: a notch should change
      // the distance by a FRACTION, so zooming feels the same close up and far
      // out instead of crawling at one end and leaping at the other.
      const step = Math.pow(0.95, zoomSpeed);
      const next = (d.target ?? current) * (e.deltaY > 0 ? 1 / step : step);
      d.target = freeCamera
        ? Math.max(next, 0.01)
        : MathUtils.clamp(next, minDistance, maxDistance);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [gl, camera, zoomSpeed, minDistance, maxDistance, freeCamera]);

  // Priority −1.5: after CameraParallax takes last frame's offset back out at
  // −2, and before OrbitControls reads the camera to derive its orbit at −1.
  // Anywhere else and the dolly either measures a distance that still has the
  // parallax drift in it, or gets overwritten the moment it is written.
  useFrame((_state, delta) => {
    const controls = controlsRef.current;
    const d = dollyRef.current;
    if (!controls || d.target === null) return;

    const t = controls.target;
    const current = camera.position.distanceTo(t);
    if (current < 1e-5) return;

    const next = MathUtils.damp(current, d.target, zoomSmoothing, delta);
    // Settled. Released rather than held, so a later Reset or a Leva radius
    // drag is not fought by a stale target from minutes ago.
    if (Math.abs(next - current) < 1e-4) {
      d.target = null;
      return;
    }
    camera.position
      .sub(t)
      .multiplyScalar(next / current)
      .add(t);
  }, -1.5);

  // Framing mode: log the shot every time the mouse is let go, so orbiting and
  // reading the numbers is one gesture instead of two. OrbitControls fires
  // "end" at the end of a drag, dolly or pan.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls || !logOnRelease) return;
    const onEnd = () => logShot("camera (drag end)");
    controls.addEventListener("end", onEnd);
    return () => controls.removeEventListener("end", onEnd);
    // logShot closes over refs only, so it does not need to be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logOnRelease]);

  if ("fov" in camera && camera.fov !== fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      autoRotate={autoRotate}
      autoRotateSpeed={autoRotateSpeed}
      dampingFactor={dampingFactor}
      rotateSpeed={rotateSpeed}
      // Zoom is ours — see the damped dolly above. Left on, OrbitControls would
      // apply its own undamped step on the same wheel event and the two would
      // fight over the same distance.
      enableZoom={false}
      // Free Camera lifts every clamp rather than widening it: a framing pass
      // should never be fighting a limit, and the sliders above are still there
      // holding the numbers to go back to.
      minDistance={freeCamera ? 0.01 : minDistance}
      maxDistance={freeCamera ? Infinity : maxDistance}
      minPolarAngle={freeCamera ? 0 : MathUtils.degToRad(minPolarAngle)}
      maxPolarAngle={freeCamera ? Math.PI : MathUtils.degToRad(maxPolarAngle)}
      // Centred on the LIVE azimuth so dragging "Initial Orbit → Azimuth"
      // carries the window with it instead of the shot snapping back to the
      // edge of a window it just left.
      //
      // No wrapping is done here even though `azimuth ± range` can leave
      // [-180, 180]: OrbitControls normalises both ends itself and has a
      // separate branch for the interval that straddles the seam.
      minAzimuthAngle={
        freeCamera || azimuthRange >= 180
          ? -Infinity
          : MathUtils.degToRad(azimuth - azimuthRange)
      }
      maxAzimuthAngle={
        freeCamera || azimuthRange >= 180
          ? Infinity
          : MathUtils.degToRad(azimuth + azimuthRange)
      }
      // Framing needs to be able to pan; a visitor generally must not.
      enablePan={freeCamera ? true : enablePan}
    />
  );
}
