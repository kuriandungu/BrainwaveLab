<!-- Added by claude-code on 10thAug2026 at 12:33pm GMT+3. purpose: README for BrainwaveLab V1 per SPEC.md -->
# BrainwaveLab

A free, offline-capable Web Audio PWA that generates layered binaural beats and isochronic tones
with real-time synthesis and a live "proof panel" that FFT-verifies the emitted frequencies match
what the UI claims. No pre-rendered audio, no external network requests, no build step.

## What it is

- Vanilla JS + Web Audio API, running an `AudioWorkletProcessor` with double-precision phase
  accumulators for click-free, frequency-accurate synthesis.
- Binaural mode: each layer's left ear gets `carrier − beat/2`, right ear gets `carrier + beat/2`.
- Isochronic mode: each layer plays its carrier identically in both channels, gated by a shared
  raised-cosine pulse at the beat frequency (works on speakers, no headphones required).
- Proof panel: live left/right FFT spectra plus a measured-frequency table using parabolic
  interpolation, so every displayed frequency is independently verified against what's actually
  playing.
- Base Hz field: the tone you actually want to hear (e.g. 417, 528). The stack retunes so its
  nearest layer lands exactly on it — that layer is highlighted and made loudest, the rest keep
  their proportions to it.

## How to run

This app must be served over HTTP — `AudioWorkletProcessor` modules do not load from `file://`.

```
python -m http.server 8763
```

Then open `http://localhost:8763/` in Chrome or Edge.

## Install as an app

**Windows (Edge/Chrome):** open the page, click the "Install app" icon in the address bar (or the
browser menu → "Install BrainwaveLab...").

**Android (Chrome):** open the page, tap the browser menu → "Add to Home screen".

## Before you listen (setup checklist)

- Use wired stereo headphones for binaural mode — Bluetooth codecs and speakers can mix the left
  and right channels, which erases the binaural beat.
- On Windows: Settings → Sound → device Properties → disable "Audio enhancements"; set Spatial
  sound to Off. These features mix left/right and destroy binaural beats.
- Keep the volume comfortable-low; entrainment does not need loudness.
- Not for use while driving. Stop if you feel discomfort. This is not a medical device.
