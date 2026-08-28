# Operational View Expansion

- [x] Inspect the current view controller, navigation rail, and reusable dashboard primitives.
- [x] Add typed presentation contracts, fixtures, and local event-hook adapters for Fleet, Safety, Archive, and Automation.
- [x] Build and route the four top-level views with drawers, panels, search/filter controls, and action feedback.
- [x] Validate desktop/mobile rendering and production build before saving.

# Archive Pulse Fan-out

- [x] Inspect the archive-pulse control and the right-hand diagnostics area it will replace.
- [x] Add persistent upward-fanning placeholder cards with the archive control retained on every card.
- [x] Validate the interaction and layout at desktop/mobile sizes, then save a checkpoint.

# Archive Fan-out Anchor

- [x] Move the fan-out origin above the Archive Pulse card while keeping the pulse card visible.
- [x] Verify the revised placement and save a checkpoint.

# Diagnostics Reflection Correction

- [x] Inspect the telemetry-side reflection that duplicates System Health.
- [x] Remove the duplicate reflection and verify the diagnostics presentation.
- [x] Validate the build and save a checkpoint.

# Telemetry Material Alignment

- [x] Compare the isolated telemetry back face against the dashboard’s blue-glass surface treatment.
- [x] Restore matching visual material cues without revealing the System Health front face.
- [x] Verify the unified visual treatment and save a checkpoint.

# Six Swappable Incident Workspace Cards

- [x] Inspect the workspace controller, clip layout, and Archive Pulse fan-out integration points.
- [x] Add shared incident-view TypeScript contracts and typed fixture data for all six cards.
- [x] Implement topology, blast-radius, timeline, state-drift, sandbox-twin, and scheduler presentation components.
- [x] Wire all six cards into the upward fan-out and workspace swap controller with local event callbacks.
- [x] Validate desktop/mobile card swaps, production build, and checkpoint the completed implementation.

# Lower-Right Workspace Card Correction

- [x] Review the central workspace swap and lower-right archive-card integration points.
- [x] Keep the conversation workspace fixed and render the six incident views only in the lower-right swappable card.
- [x] Verify the corrected layout and save a checkpoint.

# Simplified Archive Fan-out

- [x] Review the active six-card definitions and existing fan-out transforms.
- [x] Remove Timeline Engine, State Drift, and Automation Scheduler from the selector and compact-card controller.
- [x] Align the three remaining cards in a straight symmetric stack above Archive Pulse.
- [x] Verify the revised fan-out and save a checkpoint.

# Default Lower-Right Card

- [x] Review the current lower-right card state and Archive Pulse selector control.
- [x] Replace the Archive Pulse placeholder with Topology Map as the default lower-right card.
- [x] Verify the default topology presentation and save a checkpoint.

# Dynamic Lower-Right Card Menu

- [x] Review the active compact-card renderer and current fan-out menu markup.
- [x] Filter the active card from the menu and render each remaining option as a complete compact preview card.
- [x] Verify dynamic switching and the full-card menu layout, then save a checkpoint.

# System Health Visual Calibration

- [x] Audit System Health’s active material, typography, and signal-color treatments against divergent panels.
- [x] Establish shared Health-inspired styles for panel materials, controls, text hierarchy, and live signal states.
- [x] Apply the unified system to System Logs, the lower-right cards, and supporting dashboard modules.
- [x] Verify desktop/mobile consistency, production build, and checkpoint the visual calibration.

# Notes Card and Translucent Material Update

- [x] Review lower-right card contracts and the shared panel-fill overrides.
- [x] Add a local Notes card and include it in the dynamic lower-right selector.
- [x] Replace opaque ion-blue card fills with consistent translucent glass material treatments.
- [x] Verify note entry, selector behavior, and production build before checkpointing.

# Remaining Panel Cleanup

- [x] Inspect the Agent Status blue-fill override and telemetry lower-right circle treatment.
- [x] Remove the ion-blue fill from Agent Status and the lower-right telemetry circle.
- [x] Verify both visual corrections and save a checkpoint.

# First Run Setup Simplification

- [x] Inspect the specified aside and section border-line implementation.
- [x] Remove the aside and requested setup-section border lines.
- [x] Verify the simplified setup layout and save a checkpoint.

# Workspace Edge Expansion

- [x] Inspect the targeted Home workspace element and its current width constraints.
- [x] Extend the element to the full workspace edge without breaking adjacent controls.
- [x] Verify the expanded width and save a checkpoint.

# Workspace Notch Restoration

- [x] Inspect the notch clip geometry, workspace input dock, and recent conversation-width overrides.
- [x] Restore the intended central workspace notch and its dock alignment.
- [x] Verify the restored geometry and save a checkpoint.

# Workspace Notch Corner Border

- [x] Inspect the current seam element and the target workspace corner-border intent.
- [x] Restore the notch corner border without obscuring the Agent Status dock.
- [x] Verify the corrected corner line and save a checkpoint.

# Electron Desktop Conversion

- [x] Audit the current Vite entry points and package scripts for Electron compatibility.
- [x] Add a secure Electron main process and preload bridge that loads the existing React app.
- [x] Add Electron development and production packaging scripts/configuration.
- [x] Validate the web build and Electron startup path, then save a checkpoint.

Each task will be marked complete immediately after its implementation or verification.

# Electron Conversion Recovery

- [x] Recover the missing client/src dashboard tree from the last verified shared project state before continuing Electron work.
- [x] Re-run the Electron conversion checks after recovery and save a clean checkpoint.

# Notch Corner Rendering Correction

- [x] Inspect the current notch clip path, corner seam, and stale visual-edit target.
- [x] Correctly render the rounded corners around the notch without covering the Agent Status dock.
- [x] Verify the desktop/mobile layout and Electron/web builds, then save a checkpoint.

# Notch Entrance Transition Refinement

- [x] Inspect the current notch start, clip path, and seam overlay where the hard 90-degree break appears.
- [x] Replace the disconnected corner treatment with a smooth, continuous transition around the notch entrance.
- [x] Verify desktop/mobile rendering and project checks, then save a checkpoint.

# Final Notch Corner Connection

- [x] Inspect the remaining disconnected notch corner and its measured SVG path.
- [x] Connect the remaining corner to the continuous notch contour without covering the dock.
- [x] Verify responsive rendering and project checks, then save a checkpoint.

# Notch Outline Color Correction

- [x] Inspect the actual SVG outline color and late-loaded palette rule.
- [x] Set the notch outline to the intended neutral/specular glass color without broad ion-blue fill.
- [x] Verify desktop/mobile appearance and project checks, then save a checkpoint.

# Unresolved Notch Geometry Investigation

- [x] Reproduce and measure the exact visible notch break in the live dashboard rather than assuming the prior SVG outline is sufficient.
- [x] Correct the underlying notch geometry and layering so the contour is visually continuous.
- [x] Verify the result at desktop/mobile sizes and rerun project checks before saving a checkpoint.

# Validation Script Repair

- [x] Repair the root test script so it discovers the Electron and project specs from the repository root.
- [x] Rerun the complete validation sequence after the script fix.

# Final Notch Contour Rebuild

- [x] Confirm the remaining disconnect after comparing the native clipped edge, sibling SVG, and dock inset.
- [x] Move the notch contour into the focus module’s clipped layer and remove the drifting competing outline.
- [x] Verify the final desktop/mobile result and full project checks, then save a new checkpoint.
