# BrainwaveLab

A brainwave-entrainment audio app (binaural beats + isochronic tones) whose core product promise is
**provably correct frequencies** — real-time synthesis, no pre-rendered audio, live FFT proof panel.

Owner: Kuria. Platforms: Windows (browser/PWA) now, Android (installable PWA) next.

## Conventions

- **Vanilla JS + Web Audio API. No frameworks, no npm, no build step, no CDN/external requests.**
  The app must work fully offline from static files.
- Audio synthesis lives in an `AudioWorkletProcessor` (`synth-processor.js`) with double-precision
  phase accumulators. Never use pre-rendered audio files. Never let frequency precision degrade
  (no `Math.fround`, no single-precision shortcuts in phase math).
- Frequency correctness is the product. Any change to DSP code must keep set-vs-measured FFT
  agreement within 0.1 Hz (see SPEC.md acceptance criteria).
- UI: dark theme, responsive single-column on narrow screens, no horizontal scroll.
- Serve locally with `python -m http.server 8763` (worklets don't load from `file://`).

## Workflow rules (Kuria's house rules)

- Propose before writing code; get explicit approval for the specific change.
- Substantial edits (>~20 net lines) are delegated to a Sonnet executor agent; the main loop
  plans and reviews. Small tweaks may be edited directly.
- Never commit or push untested changes.
