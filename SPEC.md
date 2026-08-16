# BrainwaveLab V1 — Technical Specification

A free, offline-capable Web Audio PWA that generates **layered binaural beats and isochronic
tones** with real-time synthesis and a live "proof panel" showing that the emitted frequencies
are exactly what the UI claims. Differentiator vs. commercial apps (SeptaSync, Neuro-Programmer):
transparency — every layer's true left/right frequency is displayed and FFT-verified live.

## Files (all in project root)

- `index.html` — single page, loads everything; no external resources whatsoever
- `styles.css` — dark theme
- `app.js` — UI wiring, audio graph setup, analyser/proof panel, presets, timer
- `synth-processor.js` — AudioWorkletProcessor (all synthesis)
- `manifest.webmanifest` — PWA manifest (name "BrainwaveLab", standalone, dark theme color, `icon.svg` as icon with sizes "any", purpose "any maskable")
- `sw.js` — service worker, **network-first** falling back to cache (avoids stale dev files); cache the app shell
- `icon.svg` — simple icon: two overlapping sine waves on dark rounded square
- `README.md` — what it is, how to run (`python -m http.server 8763`), how to install as app on Windows (Edge/Chrome "Install app") and Android (Chrome "Add to Home screen"), and the "before you listen" checklist (see UI section)

## Audio engine (`synth-processor.js`)

One `AudioWorkletProcessor` registered as `"brainwave-synth"`, stereo output (2 channels),
`outputChannelCount: [2]`.

### State (set via `port.postMessage`, message shape `{type, payload}`)

- `mode`: `"binaural"` | `"isochronic"`
- `beat`: beat frequency in Hz (0.5–40)
- `layers`: array of up to 8 `{carrier, gain, enabled}`
- `masterGain`: 0–1
- `noiseGain`: 0–1 (pink noise bed)
- `test`: `null | "left" | "right"` (channel-separation test: 440 Hz sine to one channel only, other channel hard zero)

### Synthesis rules

- Every oscillator uses a **double-precision phase accumulator**:
  `phase += 2 * Math.PI * freq / sampleRate`, wrapped by subtracting `2π` when `phase > 2π`
  (never reset to 0 — keep the remainder). Frequency changes keep phase continuous (no clicks).
- **Binaural mode**: for each enabled layer, left channel gets `sin` at `carrier − beat/2`,
  right channel gets `carrier + beat/2`. Each layer needs two independent phase accumulators.
- **Isochronic mode**: each layer plays `carrier` identically in both channels, multiplied by a
  shared raised-cosine gate at the beat frequency. Gate cycle (gatePhase ∈ [0,1), advancing at
  `beat` Hz): rise `0→1` over [0, 0.1) via `0.5*(1−cos(π·p/0.1))`; hold 1 over [0.1, 0.4);
  fall `1→0` over [0.4, 0.5) via mirror cosine; silence over [0.5, 1). One gate accumulator shared
  by all layers (they pulse together).
- **Pink noise**: Paul Kellet's filter on white noise, same value to both channels, scaled by
  `noiseGain * 0.3`.
- **Click-free level changes**: smooth every gain (master, per-layer, noise) toward its target
  with a one-pole smoother, e.g. `g += (target − g) * 0.001` per sample (~20 ms). Mode/beat/carrier
  changes take effect immediately (phase continuity keeps them click-free).
- Sum of layers is normalized: divide by `max(1, sqrt(number of enabled layers))` to avoid
  clipping; also hard-clamp final sample to [−1, 1].
- Fade-in ~1 s on start (handled by ramping masterGain in `app.js` via the smoother, or a
  dedicated startup ramp in the processor — implementer's choice, must be click-free).

## Audio graph (`app.js`)

```
AudioWorkletNode("brainwave-synth", stereo)
  ├─→ AudioContext.destination
  └─→ ChannelSplitterNode(2)
        ├─ ch0 → AnalyserNode L (fftSize 32768, smoothingTimeConstant 0.5)
        └─ ch1 → AnalyserNode R (same)
```

AudioContext created/resumed only on user gesture (Start button). Show the context's actual
`sampleRate` in the proof panel.

## Proof panel (the differentiator — get this right)

- Two canvas spectra (Left / Right), drawn from `getFloatFrequencyData`, x-axis linear 0–1000 Hz,
  dB y-axis. Draw a marker at each enabled layer's expected frequency.
- **Measured-frequency readout table**: one row per enabled layer showing
  `Layer n | Set L: xxx.xxx Hz | Measured L: xxx.xx Hz ✓ | Set R | Measured R ✓`.
  Measurement: within ±5 Hz of each expected frequency, find the max bin, then refine with
  **parabolic interpolation** over the 3 dB-magnitude bins:
  `δ = 0.5·(α−γ)/(α−2β+γ)`, `f = (bin+δ)·sampleRate/fftSize`. Mark ✓ when |set−measured| < 0.5 Hz
  (FFT bin width at 48 kHz/32768 is ~1.46 Hz; interpolation gets well under 0.5 Hz on a clean sine).
  In isochronic mode L and R are identical; show one Set/Measured pair per layer plus the gate rate.
- Beat readout: big display of `beat` Hz + band name and color:
  delta < 4, theta 4–8, alpha 8–12, beta 12–30, gamma ≥ 30.
- Update ~5×/s (not every rAF frame; keep CPU low). Spectra may redraw every rAF.

## UI (single page, top to bottom)

1. **Header**: "BrainwaveLab" + tagline "True frequencies. Proven live."
2. **Transport**: big Start/Stop button; session timer select (∞, 15, 30, 60 min) — at expiry,
   fade out over 10 s and stop; master volume slider.
3. **Mode toggle**: Binaural / Isochronic. When Binaural is active show badge "Stereo headphones
   required — beats vanish if channels mix." When Isochronic: "Works on speakers too."
4. **Beat control**: slider 0.5–40 Hz (step 0.1) + numeric input (they stay in sync) + band badge.
5. **Presets row** (buttons set beat + sensible defaults, don't touch layers):
   Deep Sleep δ 2 Hz · Meditation θ 6 Hz · Relax α 10 Hz · Focus β 18 Hz · Gamma 40 Hz.
6. **Layers panel**: default "Septa stack" — 7 layers, carriers 120, 180, 240, 300, 360, 480,
   600 Hz with gains 1.0, 0.8, 0.65, 0.5, 0.4, 0.3, 0.25 (a harmonically related drone; all
   carriers < 1 kHz where binaural perception is strongest). Each row: enable checkbox, carrier
   numeric input (50–1000 Hz), gain slider. Buttons: "Septa stack" (restore default),
   "Single tone" (one layer, 200 Hz, gain 1 — classic research configuration). A "Base Hz" field
   holds the tone the user wants to hear (each stack button sets it to that stack's signature
   tone); editing it retunes the stack so its nearest layer lands exactly on that tone — that
   layer is highlighted and made loudest, the rest keep their proportions to it.
7. **Extras**: pink-noise bed toggle + level slider.
8. **Channel test**: "Test Left" / "Test Right" buttons — 2 s of 440 Hz in that channel only,
   with text "You should hear this ONLY in your left/right ear."
9. **Proof panel** (as above).
10. **Setup checklist card** (static, collapsible):
    - Use wired stereo headphones for binaural mode (Bluetooth codecs and speakers can mix channels).
    - Windows: Settings → Sound → device Properties → disable "Audio enhancements"; set Spatial
      sound to Off. These mix left/right and destroy binaural beats.
    - Keep volume comfortable-low; entrainment does not need loudness.
    - Not for use while driving; stop if you feel discomfort. Not a medical device.

Persist last-used settings to `localStorage`; restore on load.

## Acceptance criteria

1. With default Septa stack, binaural mode, beat 10 Hz: every layer's measured L and R frequency
   within 0.5 Hz of set values (proof panel shows all ✓).
2. Changing beat/carrier/mode while playing produces no audible clicks and the proof panel
   re-verifies within ~2 s.
3. "Test Left" produces signal exclusively in channel 0 (analyser R shows silence < −80 dB peak
   in the 400–500 Hz window), and vice versa.
4. Page works served from `python -m http.server 8763` in Chrome/Edge; no console errors; no
   network requests to any external host.
5. Layout usable at 375 px wide (Android) and 1280 px (desktop); no horizontal scroll.
6. Timer fade-out works; Stop is immediate but click-free (fast gain ramp, then suspend).
