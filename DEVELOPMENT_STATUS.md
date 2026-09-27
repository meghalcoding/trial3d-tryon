# Development Status

Current milestone: Phase 12 — Zero-Lag Glasses Tracking

Completed (Phase 12, see `docs/MOTION_LATENCY.md` for full detail):
- Made 0 half-life (instant, no smoothing) the actual default for glasses
  position/rotation tracking, not just an available setting: previously the
  UI's own default (0.08s) silently overrode the smoother's faster internal
  default (0.035s/0.025s) the moment the app started, so the shipped
  experience always had ~80ms of visible tracking lag ("glasses trailing a
  head turn").
- Found and fixed a real pre-existing bug in the velocity-adaptive smoothing:
  it could lerp the effective half-life UP toward its 0.012s floor as head
  motion sped up when the configured half-life was already at or below that
  floor -- the opposite of the mechanism's purpose, silently adding lag
  during fast motion. Fixed by clamping with `Math.min()` so the adaptive
  path can only ever reduce latency, never add it; a no-op for anyone using a
  non-zero configured half-life above the floor.
- Tightened the occlusion depth surface's own (separate) smoothing from 45ms
  to 20ms so its hidden/visible boundary doesn't visibly lag the now-instant
  glasses during a fast turn, without zeroing it outright (that surface is
  noisy per-frame reconstructed depth; zero smoothing there trades a latency
  artifact for a worse shimmer artifact).
- 16 new unit tests (`PoseSmoother.test.ts`), including a regression test
  that specifically catches the adaptive-direction bug by asserting identical
  output regardless of motion speed when configured half-life is at the
  floor. Full suite: 100/100 passing, clean `tsc -b` and `vite build`.

Current milestone: Phase 11 — Face Occlusion Hardening (depth, head/ears, hair/hand mask, fit, shadow)

Completed (Phase 11, see `docs/OCCLUSION_HARDENING.md` for full detail):
- Replaced the fixed-reference-width depth guess with a metrically correct face
  surface reconstructed from the pose matrix + bounded, confidence-weighted
  landmark personalisation (`FaceSurfaceReconstructor.ts`), closing TD-02.
  Synthetic ground-truth tests show ~1-2mm mean depth error vs. the legacy
  model's 3-4cm at typical chat distances.
- Added closed skull + ear depth volumes (`HeadProxy.ts`) so temple arms on
  the far side of a turned head are hidden instead of drawn over the hair.
- Added a real-time hair/hand/object occlusion mask via MediaPipe's
  `selfie_multiclass_256x256` segmenter, applied on the GPU by patching the
  glasses' own material shaders (`ForegroundSegmenter.ts`,
  `ForegroundOcclusion.ts`); fails closed on the known GPU class-scrambling
  issue and self-throttles to a duty cycle.
- Added frame/face fit diagnostics (`FitDiagnostics.ts`) that measure and
  auto-correct calibrations that embed the frame in the face -- a defect that
  was previously invisible because the old occluder's own depth error masked
  it. Exposed in the panel with a one-click "bake into calibration" action.
- Added contact shadows (dedicated shadow-only light + `ShadowMaterial`
  catcher) and an optional, bounded lighting-match heuristic.
- Added a tracker-camera-matched renderer FOV option
  (`TrackerProjection.ts`) so pose-space points project onto the same pixels
  as the tracked face under the video's `object-fit: cover` crop.
- Kept the previous occluder byte-identical as `occlusion/LegacyFaceOccluder.ts`,
  selectable via `settings.mode = 'legacy'` for on-camera A/B comparison.
  All v1 settings keys/exports still load unchanged.
- Hardened the render loop: per-frame update/render are individually
  try/caught so one bad frame degrades a layer instead of freezing the AR
  overlay; found and fixed a real pre-existing bug in a new diagnostic
  (`FaceHeightField.sample` returning 0 instead of null before first build).
- 82 new unit tests (Vitest) across 9 files covering every pure-math module;
  two additional GPU-level checks (ray-cast visibility, injected-shader
  pixel readback) run in a headless-Chromium sandbox outside the unit suite.
- `npx tsc -b` and `npx vite build` both pass clean; `npm run build` output
  unchanged in structure (single bundle, ~1.13MB before gzip).

Completed (Phase 11.1 — live-camera feedback fix):
- Live testing surfaced a real defect: temple arms were cut off abruptly right
  past the hinge instead of running along the head to the ear. Root cause: the
  face-surface occluder used one uniform push-back for the whole face, which
  can't be both tight at the nose/brow (needed for Rule 4) and generous at the
  cheek/temple (needed for arms, and exactly where landmark reconstruction is
  noisiest). Fixed with a per-vertex graduated push (`aLateral` attribute,
  `MIRRORED_CANONICAL_LATERAL_BIAS` in `canonicalFaceModel.ts`,
  `createFaceDepthMaterial` in `DepthOnlyMaterial.ts`): tight at the sagittal
  centre, generous toward the cheek/temple. New `templeClearanceCm` setting;
  `headProxyPushCm`/`earProxyPushCm` defaults also raised (proven safe by the
  existing "skull/ears stay behind the true face surface" invariant).
  Reproduced and verified fixed with a headless-Chromium pixel-readback test
  (synthetic arm with a deliberate 3-5mm inward offset: 0% visible past the
  hinge before the fix, 13-18% after, matching the zero-error baseline).
  84/84 unit tests pass; 2 new tests added for the lateral-bias gradient and
  the geometry attribute.

Completed (Phase 10):
- Fixed duplicate declarations in `FaceReferenceGeometry.ts`.
- Fixed GLB orientation normalization: removed the mathematically invalid centered-depth sign test that could invert Y/Z per model; canonical X/Y/Z snapping now prevents spurious PCA rotations for already-canonical assets.
- Fixed automatic eyewear eye-line placement: lens-midpoint-anchored models now derive X/Y from the canonical eye midpoint instead of the lower nose bridge.
- Fixed the remaining systematic Y offset at the calibration root: the fallback FaceReference now uses MediaPipe canonical eye-line Y=2.624618 cm instead of incorrectly treating the facial transformation-matrix origin as the eye line.
- Verified the five supplied catalog GLBs offline: the corrected orientation basis resolves to right-handed X/Y/Z for all five assets.
- Preserved camera, MediaPipe tracking, Three.js rendering, product schema, product switching, and asset files.

In progress:
- Live-camera empirical validation of the hardened occlusion system (real hair,
  hands, lighting, head turns) -- everything above has been validated with
  unit tests and a headless-GPU sandbox, not yet on a live device/browser.
- Full npm build verification requires the project's dependencies to be installed.

Next:
- Live camera validation of Phase 11, then production deployment.
- Consider baking the auto-clearance correction into each catalog product's
  stored calibration once live-validated, and code-splitting the bundle
  (currently a single >500KB chunk per the Vite build warning).

Blockers: None

## Tech Debt Register
- TD-01 - Full dependency installation/build verification requires registry access in the developer environment. - Severity: Low
- TD-02 - RESOLVED (Phase 11): the occluder now reconstructs metric depth from the pose matrix plus bounded landmark personalisation instead of a fixed reference width; see `FaceSurfaceReconstructor.ts`. The underlying constraint (approved browser task API does not expose the legacy Face Geometry runtime mesh directly) is unchanged, but is no longer a source of centimetre-scale error.
- TD-03 - The supplied catalog does not contain real pricing, so product price fields are set to 0 and are not surfaced as product pricing UI yet. - Severity: Low
- TD-04 - Product starting calibrations are asset-space baselines derived from GLB geometry; final camera validation is still required for production-quality fit. The new fit-diagnostics auto-clearance (Phase 11) masks most embedding in real time, but baking corrected Z values into the catalog is still open. - Severity: Low
- TD-05 - Full npm build verification in this execution environment is blocked by missing installed dependencies after the previous install timeout. - Severity: Low
- TD-06 - The hardened occlusion system (Phase 11) has had one round of live-camera
  feedback (temple-arm cutoff, fixed in Phase 11.1 — see above) but has not
  been systematically validated: real hair, hands, ambient lighting, and a
  full range of head motion/distance are still untested. - Severity: Med
- TD-07 - `selfie_multiclass_256x256` is fetched from a public Google Cloud Storage URL and the MediaPipe Tasks WASM runtime from a public jsDelivr CDN at runtime; production deployments may want to self-host both. - Severity: Low


## Latest iteration — portrait mobile projection correction (2026-09-27)

TASK
- Bug fix: glasses render too small in portrait phone orientation.

IMPLEMENTATION
- Enabled the existing tracker-camera-matched projection by default. The renderer already computes the appropriate vertical FOV from source video dimensions and the `object-fit: cover` crop; the feature was present but disabled in the shipped defaults. No pose, calibration, tracking, or occlusion algorithm changed.

FILES CHANGED
- `src/types/FaceOcclusion.ts`
- `DEVELOPMENT_STATUS.md`

VERIFICATION
- Source inspected; execution/build not run in this environment.

RESULT
- Default renderer now uses the existing cover-aware projection path on portrait and landscape surfaces. Must still be confirmed on a real phone.

ASSUMPTIONS
- The reported phone is using the app's existing `object-fit: cover` camera surface.

BLOCKERS
- Live-device verification not performed.

## Latest iteration — stakeholder demo Task 1: full-screen viewer and Bauhaus foundation (2026-09-27)

TASK
- Stakeholder Demo Task 1 — Full-Screen 3D Viewer & Bauhaus Interface.

IMPLEMENTATION
- Changed the app shell and try-on surface to a viewport-sized, responsive canvas with the camera and Three.js layers remaining full bleed.
- Restyled the header, camera permission/start experience, status controls, and product selector using the requested Bauhaus primary palette, hard borders/shadows, geometric mark, and Outfit typography.
- Repositioned the existing product carousel as an overlay on the viewer, with mobile and short-landscape adaptations.
- Removed Circular 001 from the shipped product catalog; retained the other four supplied catalog products.
- Did not alter tracking, coordinate conversion, calibration data, or rendering algorithms.

FILES CHANGED
- `src/App.tsx`
- `src/App.css`
- `src/index.css`
- `src/data/products.json`
- `DEVELOPMENT_STATUS.md`

VERIFICATION
- Source inspected before editing. Build/lint not yet executed.

RESULT
- Task 1 interface changes are implemented in source. Runtime verification across actual device sizes remains outstanding.

ASSUMPTIONS
- The four non-Circular catalog products and their supplied assets are the stakeholder demo catalog.
- Loading Outfit from Google Fonts follows the supplied design brief's explicit font instruction.

BLOCKERS
- Build and browser/device validation have not been run in this execution.

## Latest iteration — stakeholder demo Task 2: AR diagnostics drawer (2026-09-27)

TASK
- Stakeholder Demo Task 2 — Collapsible AR Diagnostics & Stakeholder Demo Drawer.

IMPLEMENTATION
- Replaced the visible developer-control area with a compact bottom-docked diagnostics drawer that overlays the viewer and expands on explicit click/tap.
- Added live, source-backed readouts for camera state/resolution, face-tracking and pose availability, selected/loading eyewear model, and available occlusion/segmenter telemetry.
- Kept telemetry sourced from existing runtime state and renderer/segmenter status; no fabricated FPS, confidence, or performance metrics were introduced.
- Made the drawer responsive, keyboard-operable, and respectful of reduced-motion preferences. Its open/closed state does not change viewer layout.
- Removed developer controls from the visible interface; legacy panel components remain hidden and are not exposed through the stakeholder UI.

FILES CHANGED
- `src/App.tsx`
- `src/App.css`
- `DEVELOPMENT_STATUS.md`

VERIFICATION
- Inspected the current Task 1 repository source and direct UI dependencies before editing.
- Build/lint not executed because `node_modules` is absent in this environment.

RESULT
- Drawer UI and runtime-backed status cards are implemented in source. Browser interaction, accessibility, and device-size validation remain outstanding.

ASSUMPTIONS
- Existing app state and renderer/segmenter status APIs are the approved source for stakeholder diagnostics; metrics not exposed by those APIs are omitted.

BLOCKERS
- Build and live browser/device validation require installed dependencies and a browser/device environment.

## Latest iteration — stakeholder demo Task 3: integration and responsive acceptance (2026-09-27)

TASK
- Stakeholder Demo Task 3 — Responsive Polish, Integration & Demo Acceptance.

IMPLEMENTATION
- Added safe-area-aware spacing so the product selector remains clear of the collapsed diagnostics drawer handle, including mobile portrait and short landscape layouts.
- Improved compact drawer summary behavior on narrow screens and added visible keyboard focus treatment to primary interactive controls.
- Made the closed diagnostics content inert as well as aria-hidden, preventing hidden readouts from entering keyboard navigation; Escape closes the expanded drawer.
- Added low-frequency camera-resolution telemetry that updates only when the actual video dimensions change, rather than copying per-frame data into React state.
- Preserved camera/tracking/rendering algorithms, product calibration, model assets, and the approved app architecture.

FILES CHANGED
- `src/App.tsx`
- `src/App.css`
- `DEVELOPMENT_STATUS.md`

VERIFICATION
- Inspected the Task 2 source, direct UI dependencies, drawer styles, and package scripts.
- `npm ci` attempted but timed out in the execution environment; dependencies remain unavailable.
- Build, lint, unit tests, and browser/device acceptance not executed.

RESULT
- Task 3 integration and responsive/accessibility source updates are implemented. Production/demo acceptance is not yet verified because the dependency install and live browser/device checks could not be completed.

ASSUMPTIONS
- Existing four catalog products and their supplied assets remain the approved demo set.

BLOCKERS
- Dependency installation timed out; build/lint/test and real-device acceptance remain outstanding.
