# Lupin Glass Dashboard — Design Direction

## Reference as Ground-Truth Specification

The supplied dashboard reference is the structural brief: a dark framed application surface, a slim vertical control rail, one generous hero workspace, three stacked right-side modules, a compact lower utility panel, and a luminous action dock. The implementation will reproduce this visual hierarchy while using original interface content, interaction states, and an elevated liquid-glass material system rather than copying any source artwork.

## Chosen Approach: Luminous Obsidian Instrument Panel

**Design Movement:** Contemporary industrial interface design informed by dark-room photography, optical glass, and precision instrumentation.

**Core Principles:**

1. **Material first:** Every module is visibly made from deep translucent glass, using layered blur, optical highlights, and low-contrast internal detail.
2. **Structural asymmetry:** A persistent left rail anchors a large creative workspace, while the right-hand stack and lower utility area create a composed, modular rhythm.
3. **Selective brilliance:** Warm ivory controls and electric blue data accents appear only where action or priority needs to be clear.
4. **Quiet precision:** Dense information is reduced to deliberate labels, calibrated values, fine rules, and measured spacing.

**Color Philosophy:** Obsidian and charcoal establish a calm, cinematic field in which light can refract. Mineral-white carries the readable interface layer; an ownable **ion blue** is used sparingly as the living signal running beneath the glass. Soft amber is reserved for an immediate, human-sounding alert state.

**Layout Paradigm:** A framed instrument enclosure inside a dramatic, textured, full-viewport field. The layout is intentionally non-centralized: it progresses from the control rail into a major workspace, then compresses toward a vertical diagnostic stack and low supporting dock.

**Signature Elements:**

1. **Specular perimeter:** Hairline, multi-tone borders that catch light along top and left faces more strongly than lower faces.
2. **Refraction blooms:** Out-of-focus colored light pools behind each glass module that shift subtly at rest and during hover.
3. **Orbital indicators:** Small circular utilities, signal LEDs, and ring meters that provide the visual language of a calibrated instrument.

**Interaction Philosophy:** Interfaces respond like physical glass controls: buttons compress slightly, panels lift with a sharpened highlight, and navigation transitions remain understated and immediate. Content controls are all keyboard-focusable and clearly labelled.

**Animation:** Ambient refraction gradients drift on an 18–24 second loop. Modules use 180–240ms `cubic-bezier(0.23, 1, 0.32, 1)` transitions for hover and selection, while the workspace icon and signal markers use small opacity shifts only. Motion is disabled for reduced-motion preferences.

**Typography System:** `DM Mono` handles calibrated labels, dates, and numerical readouts with tiny tracked uppercase forms. `Manrope` is used for all body/UI text, and its 700–800 weights create short, cool headline hierarchy. No generic display flourishes are used.

**Brand Essence:** Lupin is a private visual control room for creative operators who want clarity without visual noise.

**Personality:** Precise, cinematic, quietly futuristic.

**Brand Voice:** Headlines are concise and observational; labels feel like instrument annotations; actions use direct verbs. Example lines: “The room is holding steady.” and “Route the next signal.” Generic welcome language is excluded.

**Wordmark & Logo:** The supplied three-pronged Lupin reference mark is the canonical logo. It appears as a high-contrast, lightly luminous symbol beside a compact uppercase `LUPIN` wordmark with widened tracking.

**Signature Brand Color:** **Ion Blue — #6CB8FF**.

## Style Decisions

- Every Luma surface, including onboarding, retains a left control rail and at least one compact diagnostic or support treatment so the hierarchy remains an instrument panel rather than a centered wizard.
- Primary glass uses simultaneous specular perimeter highlights, translucent depth, and restrained optical ion-blue blooms. Ion Blue is reserved for live, selected, primary-action, and key-readout states; inactive UI recedes into charcoal and mineral-white.
- List-oriented operational views include an asymmetric utility strip or diagnostic panel, so inventory screens continue to read as a calibrated control enclosure rather than a generic admin table.
- Ion Blue behaves as emitted signal light in live states, selected controls, compact readouts, and primary actions; it is never used as a broad flat fill.
- Operational copy uses concise instrument annotations and state observations, favoring phrases such as “Signal paths remain stable” over generic management language.
- Onboarding preserves visible calibration and support instrumentation beside the primary decision area, so first-run configuration remains part of the control enclosure.
- Primary modules pair an optical glass perimeter with translucent layering and a contained ion-blue refraction bloom; orbital readouts and fine calibration rules reinforce the Lupin instrument language.
