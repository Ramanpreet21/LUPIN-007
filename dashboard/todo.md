# Header Removal and Telemetry Readability

- [x] Inspect the unmatched header and the telemetry back-face density at desktop and mobile sizes.
- [x] Remove the dashboard header and improve telemetry text contrast, size, spacing, and control legibility.
- [x] Validate responsive rendering and production build before saving.

# Rendering Regression Recovery

- [x] Reproduce the reported blank or broken dashboard rendering and identify the latest layout regression.
- [x] Apply the smallest safe correction while retaining the intended header removal and telemetry readability improvements.
- [x] Verify desktop/mobile rendering and production build before saving the recovery checkpoint.

# System Health Telemetry Relocation

- [x] Inspect the stale telemetry-panel target and the System Health summary layout.
- [x] Move CPU, RAM, and storage meters to System Health and remove their duplicate back-face presentation.
- [x] Verify responsive card faces and production build before saving.

# System Health Meter Enhancements

- [x] Inspect the current resource-strip layout and live network telemetry fields.
- [x] Add warning-threshold hover tooltips and a compact live network meter beside disk activity.
- [x] Verify desktop/mobile usability and production build before saving.

# System Health Resource Row Adjustment

- [x] Inspect the current four-meter grid and apply the requested two-row grouping.
- [x] Keep CPU and RAM first, with Disk and Network together on the next line.
- [x] Verify desktop/mobile layout and production build before saving.

# System Health Readability Refinement

- [x] Inspect the stale editor target and identify the current front-face readability constraints.
- [x] Increase System Health text, meter, and contrast readability while preserving its two-row layout.
- [x] Verify desktop/mobile rendering and production build before saving.

# Agent Status Readability Refinement

- [x] Inspect the stale editor target and identify current Agent Status readability constraints.
- [x] Increase Agent Status typography, contrast, and control clarity without disrupting its cutout placement.
- [x] Verify desktop/mobile rendering and production build before saving.

# Expandable Navigation Rail

- [x] Inspect the stale sidebar target and current rail/layout constraints.
- [x] Add accessible expanded and collapsed desktop navigation states without disturbing the workspace geometry.
- [x] Verify rail behavior at desktop and mobile sizes and complete production validation.

# Reference-led Motion Icons

- [x] Inspect the supplied reference video and identify its icon-motion characteristics.
- [x] Apply a compatible, restrained motion treatment to relevant dashboard icons.
- [x] Verify desktop/mobile motion and reduced-motion behavior before saving.

# Decorative Background Removal

- [x] Inspect the current decorative canvas background layers.
- [x] Remove the decorative background while retaining contrast for Liquid Glass panels, including workspace and archive imagery.
- [x] Verify desktop/mobile presentation and production build before saving.

# Streamlined Rail and Profile Fan-out

- [x] Inspect the stale rail controls and current profile action placement.
- [x] Keep only the collapse control in the rail and move Settings, Logout, and SSH into an accessible profile fan-out.
- [x] Verify rail and profile actions at desktop/mobile sizes and complete production validation.

# Click-driven Rail and Profile Fan-out

- [x] Inspect the current hover/focus expansion handlers and profile trigger coverage.
- [x] Make rail expansion click-driven and make the full profile area open the action fan-out.
- [x] Verify click behavior, responsive layout, and production build before saving.

# Settings and SSH Management Dialogs

- [x] Inspect the existing profile fan-out and available settings/SSH state contracts.
- [x] Replace placeholder actions with focused Settings and SSH connections management dialogs; remove Logout.
- [x] Verify dialogs, responsive layout, and production build before saving.

# AI Conversation Workspace and Notch Popup

- [x] Inspect the main workspace and measured notch layout constraints.
- [x] Build a scrollable AI conversation history in the main workspace and a backend-ready popup menu in the notch.
- [x] Verify conversation scrolling, popup interaction, responsive geometry, and production build before saving.

# Corrected Notch and Composer Popup Placement

- [x] Inspect the current notch popup and input-composer placement.
- [x] Restore Agent Status in the notch and transform the composer into the backend-request popup in place.
- [x] Verify desktop/mobile geometry, popup behavior, and production build before saving.

# Freeform AI Conversation Messages

- [x] Inspect assistant-message styling and role hierarchy constraints.
- [x] Remove assistant message containers while retaining readable metadata and user/system distinction.
- [x] Verify desktop/mobile conversation readability and production build before saving.

# First-run Setup Experience

- [x] Inspect the dashboard entry flow and determine a safe local preference-storage contract.
- [x] Build an accessible multi-step first-run setup for preferences, target machine, access, and notifications.
- [x] Verify first-run completion, stored preferences, responsive layout, and production build before saving.

# Supplied Content Integration

- [x] Inspect the supplied content and determine its appropriate dashboard placement and behavior.
- [x] Incorporate the relevant content while preserving the established Liquid Glass hierarchy.
- [x] Verify desktop/mobile integration and production build before saving.

# Workspace Notch Restoration

- [x] Inspect the referenced workspace region and current measured notch geometry.
- [x] Restore the real notch if it is absent or visually obscured, retaining Agent Status placement.
- [x] Verify the notch at desktop and mobile sizes and complete production validation before saving.

# Notch Corner Consistency

- [x] Compare the current notch-corner styling with the original rounded SVG geometry.
- [x] Remove the unintended perimeter-corner treatment and restore consistent notch corners.
- [x] Verify desktop/mobile notch corners and production build before saving.

# Lupin Brand Update

- [x] Prepare the supplied reference mark as a deployment-safe dashboard asset.
- [x] Replace the current mark and brand naming with Lupin across the visible product surfaces.
- [x] Verify the Lupin branding at desktop/mobile sizes and complete production validation before saving.

# Targeted Workspace Span Removal

- [x] Inspect the synchronized source element identified by the visual editor.
- [x] Remove the intended span while preserving the workspace controls and conversation flow.
- [x] Verify desktop/mobile behavior and production build before saving.

# Lupin Assistant Message Refinement

- [x] Inspect current assistant-message styles and metadata icon markup.
- [x] Remove assistant message containers and replace the robot metadata glyph with the Lupin mark.
- [x] Verify desktop/mobile conversation readability and production build before saving.

# First-run Model Configuration Simplification

- [x] Inspect the indicated setup fieldset and model-provider input group.
- [x] Remove the requested fieldset, retain one API-key input, and rename the endpoint label.
- [x] Verify the streamlined setup at desktop/mobile sizes and complete production validation before saving.

# Workspace Edge-Handle Removal

- [x] Inspect the inactive workspace edge-handle markup and related styling.
- [x] Remove the inactive control without affecting the measured workspace geometry.
- [x] Verify desktop/mobile workspace layout and production build before saving.
