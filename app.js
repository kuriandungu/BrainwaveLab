/* Added by claude-code on 10thAug2026 at 12:33pm GMT+3. purpose: UI wiring, audio graph setup,
   proof panel (spectra + parabolic-interpolation measurement), presets, timer, persistence,
   for BrainwaveLab V1 per SPEC.md */

(function () {
  'use strict';

  const STORAGE_KEY = 'brainwavelab.settings.v1';
  const NUM_LAYER_ROWS = 7;
  // Added by Claude Sonnet (brief by Claude Fable 5) on 16Aug2026 at 1:22pm EAT. purpose: gains
  // assigned by setBaseHz(), indexed by rank-distance-from-the-anchor-tone (rank 0 = anchor itself).
  const ANCHOR_GAINS = [1.0, 0.7, 0.55, 0.45, 0.35, 0.3, 0.25];

  const SEPTA_STACK = [
    { carrier: 120, gain: 1.0, enabled: true },
    { carrier: 180, gain: 0.8, enabled: true },
    { carrier: 240, gain: 0.65, enabled: true },
    { carrier: 300, gain: 0.5, enabled: true },
    { carrier: 360, gain: 0.4, enabled: true },
    { carrier: 480, gain: 0.3, enabled: true },
    { carrier: 600, gain: 0.25, enabled: true }
  ];
  // Added by Claude Sonnet (brief by Claude Fable 5) on 16Aug2026 at 1:05pm EAT. purpose: fundamental
  // of the stack, used by the Base Hz field to scale carriers proportionally and to recognise this
  // stack (by ratio, not absolute carrier) after such a scale.
  SEPTA_STACK.nativeBase = 120;

  // ---- mutable app state (mirrors processor state + UI-only bits) ----
  const state = {
    mode: 'binaural',
    beat: 10,
    layers: SEPTA_STACK.map((l) => Object.assign({}, l)),
    // Updated by Claude Sonnet (brief by Claude Fable 5) on 16Aug2026 at 1:22pm EAT. purpose: Base Hz
    // is now the tone the user wants to hear (played exactly by anchorIndex's layer); anchorIndex is
    // the layer retuned to sit exactly on it.
    baseHz: 120,
    anchorIndex: 0,
    masterGain: 0.6,
    noiseEnabled: false,
    noiseType: 'pink',
    noiseLevel: 0.2,
    timerMinutes: 0
  };

  // ---- DOM refs ----
  const startStopBtn = document.getElementById('startStopBtn');
  const nowPlayingEl = document.getElementById('nowPlaying');
  const timerSelect = document.getElementById('timerSelect');
  const masterVolume = document.getElementById('masterVolume');

  const modeBinauralBtn = document.getElementById('modeBinauralBtn');
  const modeIsochronicBtn = document.getElementById('modeIsochronicBtn');
  const modeBadge = document.getElementById('modeBadge');

  const beatSlider = document.getElementById('beatSlider');
  const beatNumber = document.getElementById('beatNumber');
  const bandBadge = document.getElementById('bandBadge');

  const septaStackBtn = document.getElementById('septaStackBtn');
  const singleToneBtn = document.getElementById('singleToneBtn');
  const solfeggioBtn = document.getElementById('solfeggioBtn');

  // Added by Claude Sonnet (brief by Claude Fable 5) on 16Aug2026 at 1:05pm EAT. purpose: DOM refs
  // for the Base Hz field.
  const baseHzInput = document.getElementById('baseHz');
  const baseHzHint = document.getElementById('baseHzHint');

  const noiseEnable = document.getElementById('noiseEnable');
  const noiseTypeSel = document.getElementById('noiseType');
  const noiseLevel = document.getElementById('noiseLevel');

  const testLeftBtn = document.getElementById('testLeftBtn');
  const testRightBtn = document.getElementById('testRightBtn');

  const sampleRateDisplay = document.getElementById('sampleRateDisplay');
  const spectrumCanvasL = document.getElementById('spectrumCanvasL');
  const spectrumCanvasR = document.getElementById('spectrumCanvasR');
  const measurementTableHead = document.getElementById('measurementTableHead');
  const measurementTableBody = document.getElementById('measurementTableBody');
  const beatReadoutValue = document.getElementById('beatReadoutValue');
  const beatReadoutBand = document.getElementById('beatReadoutBand');

  // ---- audio graph (created lazily on first Start click) ----
  let audioCtx = null;
  let synthNode = null;
  let analyserL = null;
  let analyserR = null;
  let dataL = null;
  let dataR = null;

  let running = false;
  let starting = false; // re-entrancy guard: handleStart is async (addModule/resume)
  let rafHandle = null;
  let measureIntervalHandle = null;
  let sessionTimerHandle = null;
  let timerExpireHandle = null; // pending finishStop() scheduled by onTimerExpire
  let testTimeoutHandle = null;

  // Added by Claude Sonnet (brief by Claude Fable 5) on 16Aug2026 at 1:22pm EAT. purpose: how many
  // layers got clamped to 50/1000 Hz by the most recent setBaseHz() call, surfaced in the Base Hz
  // hint. Not persisted — it's a transient result of the last retune, not app state.
  let lastClampedCount = 0;

  // ---------------------------------------------------------------------
  // Band helper
  // ---------------------------------------------------------------------
  function bandFor(beat) {
    if (beat < 4) return { name: 'Delta', color: '#7c5cff' };
    if (beat < 8) return { name: 'Theta', color: '#5ce1e6' };
    if (beat < 12) return { name: 'Alpha', color: '#5cff8f' };
    if (beat < 30) return { name: 'Beta', color: '#ffd35c' };
    return { name: 'Gamma', color: '#ff5c5c' };
  }

  // "Now playing" summary under the Start/Stop button: mode, beat + band,
  // which stack the layers match, and the noise bed if on.
  // Updated by Claude Sonnet (brief by Claude Fable 5) on 16Aug2026 at 1:22pm EAT. purpose: match
  // stacks by carrier ratio, each set normalised by its own lowest carrier (baseHz is no longer
  // necessarily one of the layers now that it's a retune target, so we can't key ratios off it) —
  // still recognises a stack after setBaseHz retunes it, and is labelled with the base it's at.
  function layerStackName() {
    const matches = function (def) {
      if (state.layers.length !== def.length) return false;
      const stateMin = Math.min.apply(null, state.layers.map(function (l) { return l.carrier; }));
      const defMin = Math.min.apply(null, def.map(function (l) { return l.carrier; }));
      return state.layers.every(function (l, i) {
        return l.enabled === def[i].enabled &&
          Math.abs((l.carrier / stateMin) - (def[i].carrier / defMin)) < 0.002;
      });
    };
    const nameFor = function (def, label) {
      if (!matches(def)) return null;
      return state.baseHz !== def.nativeBase
        ? label + ' @ ' + (+state.baseHz.toFixed(1)) + ' Hz'
        : label;
    };
    const septaName = nameFor(SEPTA_STACK, 'Septa stack');
    if (septaName) return septaName;
    if (typeof SOLFEGGIO_STACK !== 'undefined') {
      const solfeggioName = nameFor(SOLFEGGIO_STACK, 'Solfeggio stack');
      if (solfeggioName) return solfeggioName;
    }
    const enabled = state.layers.filter(function (l) { return l.enabled; });
    if (enabled.length === 1) return 'Single tone ' + enabled[0].carrier + ' Hz';
    return 'Custom (' + enabled.length + ' layers)';
  }

  function updateNowPlaying() {
    if (!running) {
      nowPlayingEl.textContent = 'Stopped';
      nowPlayingEl.classList.add('idle');
      return;
    }
    nowPlayingEl.classList.remove('idle');
    const parts = [
      state.mode === 'binaural' ? 'Binaural' : 'Isochronic',
      state.beat.toFixed(1) + ' Hz beat (' + bandFor(state.beat).name + ')',
      layerStackName()
    ];
    if (state.noiseEnabled) {
      parts.push((state.noiseType === 'brown' ? 'Brown' : 'Pink') + ' noise');
    }
    nowPlayingEl.textContent = '▶ ' + parts.join(' · ');
  }

  function updateBandUI() {
    const band = bandFor(state.beat);
    bandBadge.textContent = band.name + ' band';
    bandBadge.style.color = band.color;
    bandBadge.style.borderColor = band.color;
    beatReadoutValue.textContent = state.beat.toFixed(1);
    beatReadoutValue.style.color = band.color;
    beatReadoutBand.textContent = band.name;
    beatReadoutBand.style.color = band.color;
  }

  // ---------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------
  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // localStorage may be unavailable (private mode); ignore.
    }
    // Every state change funnels through here, so this keeps the summary current.
    updateNowPlaying();
  }

  // Clamp to a finite number in [lo, hi], else fall back. Malformed storage must
  // never reach the worklet: a NaN beat/carrier poisons a phase accumulator until
  // the page is reloaded (NaN + x stays NaN in the audio callback).
  function sanNum(v, lo, hi, dflt) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  }

  // Added by Claude Sonnet (brief by Claude Fable 5) on 16Aug2026 at 1:22pm EAT. purpose: index of
  // the current layer whose carrier is musically nearest hz — "nearest" measured
  // in log space (an octave above counts the same as an octave below), ties going to the lower
  // index. Used both to pick setBaseHz's anchor and to restore/recompute anchorIndex elsewhere.
  // Edited by Claude Fable 5 on 16Aug2026 at 1:35pm EAT. purpose: only ENABLED layers compete for
  // the anchor (fall back to all layers if none is enabled). Otherwise "Single tone" + base 528
  // would anchor on a disabled leftover Septa layer and turn on a second tone.
  function nearestLayerIndex(hz) {
    const anyEnabled = state.layers.some(function (l) { return l.enabled; });
    let idx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < NUM_LAYER_ROWS; i++) {
      if (anyEnabled && !state.layers[i].enabled) continue;
      const dist = Math.abs(Math.log(state.layers[i].carrier / hz));
      if (dist < bestDist) {
        bestDist = dist;
        idx = i;
      }
    }
    return idx;
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;
      state.mode = saved.mode === 'isochronic' ? 'isochronic' : 'binaural';
      state.beat = sanNum(saved.beat, 0.5, 40, state.beat);
      state.masterGain = sanNum(saved.masterGain, 0, 1, state.masterGain);
      state.noiseLevel = sanNum(saved.noiseLevel, 0, 1, state.noiseLevel);
      state.noiseEnabled = saved.noiseEnabled === true;
      state.noiseType = saved.noiseType === 'brown' ? 'brown' : 'pink';
      state.timerMinutes = sanNum(saved.timerMinutes, 0, 600, state.timerMinutes);
      state.layers = SEPTA_STACK.map(function (dflt, i) {
        const s = (Array.isArray(saved.layers) && saved.layers[i] && typeof saved.layers[i] === 'object')
          ? saved.layers[i] : {};
        return {
          carrier: sanNum(s.carrier, 50, 1000, dflt.carrier),
          gain: sanNum(s.gain, 0, 1, dflt.gain),
          enabled: typeof s.enabled === 'boolean' ? s.enabled : dflt.enabled
        };
      });
      // Added by Claude Sonnet (brief by Claude Fable 5) on 16Aug2026 at 1:05pm EAT. purpose: restore
      // the saved base, falling back to the lowest restored carrier if it's missing/corrupt.
      state.baseHz = sanNum(saved.baseHz, 50, 1000, Math.min.apply(null, state.layers.map(function (l) { return l.carrier; })));
      // Added by Claude Sonnet (brief by Claude Fable 5) on 16Aug2026 at 1:22pm EAT. purpose: restore
      // which layer is the anchor (plays baseHz exactly), falling back to whichever restored layer
      // is nearest the restored base in log space if the saved index is missing/corrupt.
      state.anchorIndex = Math.round(sanNum(saved.anchorIndex, 0, NUM_LAYER_ROWS - 1, nearestLayerIndex(state.baseHz)));
    } catch (e) {
      // ignore corrupt storage
    }
  }

  // ---------------------------------------------------------------------
  // UI <-> state wiring
  // ---------------------------------------------------------------------
  function renderLayersUI() {
    for (let i = 0; i < NUM_LAYER_ROWS; i++) {
      const layer = state.layers[i];
      document.getElementById('layerEnable' + i).checked = layer.enabled;
      document.getElementById('layerCarrier' + i).value = layer.carrier;
      document.getElementById('layerGain' + i).value = layer.gain;
      // Added by Claude Sonnet (brief by Claude Fable 5) on 16Aug2026 at 1:22pm EAT. purpose:
      // highlight the anchor row — the layer currently retuned to play the Base Hz tone exactly.
      document.querySelector('.layer-row[data-index="' + i + '"]').classList.toggle('anchor', i === state.anchorIndex);
    }
  }

  // Updated by Claude Sonnet (brief by Claude Fable 5) on 16Aug2026 at 1:22pm EAT. purpose: Base Hz
  // is now the exact tone the user wants to hear, not a per-stack range-limited fundamental — the
  // hint names which layer carries it (and how many carriers had to be clamped to fit 50-1000 Hz)
  // instead of showing a range. baseRange()/effectiveBaseHz() are gone: the allowed range is now
  // the fixed [50, 1000] synth limit, not something computed from the current stack's ratios.
  function renderBaseUI() {
    baseHzInput.value = +state.baseHz.toFixed(1);
    let hint = 'Your tone is L' + (state.anchorIndex + 1);
    if (lastClampedCount > 0) {
      hint += ' · ' + lastClampedCount + ' layer(s) clamped to range';
    }
    baseHzHint.textContent = hint;
  }

  // Retunes the stack so the layer musically nearest v plays it exactly, scaling every other
  // layer by the same factor (ratios preserved) and re-weighting gains by musical distance from
  // the new anchor so the requested tone is loudest.
  function setBaseHz(v) {
    v = parseFloat(v);
    if (!Number.isFinite(v)) return;
    v = Math.min(1000, Math.max(50, v));

    const currentAnchor = state.layers[state.anchorIndex];
    if (v === state.baseHz && currentAnchor && currentAnchor.carrier === v) {
      renderLayersUI();
      renderBaseUI();
      return;
    }

    const anchorIdx = nearestLayerIndex(v);
    const anchorCarrier = state.layers[anchorIdx].carrier;
    const factor = v / anchorCarrier;

    // Rank-distance for gains: scale-invariant, so computed from the pre-scale ratio to the
    // anchor (equals the post-scale ratio to v, since every carrier moves by the same factor).
    const ranked = state.layers
      .map(function (l, i) { return { i: i, dist: Math.abs(Math.log(l.carrier / anchorCarrier)) }; })
      .sort(function (a, b) { return a.dist - b.dist || a.i - b.i; });

    let clampedCount = 0;
    state.layers.forEach(function (l) {
      const target = Math.round(l.carrier * factor * 100) / 100;
      const clamped = Math.min(1000, Math.max(50, target));
      // Edited by Claude Fable 5 on 16Aug2026 at 1:45pm EAT. purpose: only report clamps on layers
      // that are switched on — silent leftovers (e.g. after "Single tone") were inflating the hint.
      if (clamped !== target && l.enabled) clampedCount++;
      l.carrier = clamped;
    });
    state.layers[anchorIdx].carrier = v; // exact — no rounding drift on the requested tone
    state.layers[anchorIdx].enabled = true;

    ranked.forEach(function (r, rank) {
      state.layers[r.i].gain = ANCHOR_GAINS[rank];
    });

    state.baseHz = v;
    state.anchorIndex = anchorIdx;
    lastClampedCount = clampedCount;
    renderLayersUI();
    renderBaseUI();
    sendLayers();
    saveSettings();
  }

  function renderModeUI() {
    const isBinaural = state.mode === 'binaural';
    modeBinauralBtn.classList.toggle('active', isBinaural);
    modeIsochronicBtn.classList.toggle('active', !isBinaural);
    if (isBinaural) {
      modeBadge.textContent = 'Stereo headphones required — beats vanish if channels mix.';
      modeBadge.className = 'badge badge-warn';
    } else {
      modeBadge.textContent = 'Works on speakers too.';
      modeBadge.className = 'badge';
    }
  }

  function renderAllUI() {
    beatSlider.value = state.beat;
    beatNumber.value = state.beat;
    masterVolume.value = state.masterGain;
    noiseEnable.checked = state.noiseEnabled;
    noiseTypeSel.value = state.noiseType;
    noiseLevel.value = state.noiseLevel;
    timerSelect.value = String(state.timerMinutes);
    renderModeUI();
    updateBandUI();
    renderLayersUI();
    renderBaseUI();
  }

  function sendLayers() {
    if (synthNode) {
      synthNode.port.postMessage({ type: 'layers', payload: state.layers });
    }
  }

  // ---- transport ----
  async function ensureAudioGraph() {
    if (audioCtx) return;

    // 'playback' hint = larger audio buffer. Nothing here needs low latency, and the
    // bigger buffer resists dropouts/blips, especially over Bluetooth audio.
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    await audioCtx.audioWorklet.addModule('synth-processor.js');

    synthNode = new AudioWorkletNode(audioCtx, 'brainwave-synth', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });

    const splitter = audioCtx.createChannelSplitter(2);
    synthNode.connect(audioCtx.destination);
    synthNode.connect(splitter);

    analyserL = audioCtx.createAnalyser();
    analyserL.fftSize = 32768;
    analyserL.smoothingTimeConstant = 0.5;
    analyserR = audioCtx.createAnalyser();
    analyserR.fftSize = 32768;
    analyserR.smoothingTimeConstant = 0.5;

    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);

    dataL = new Float32Array(analyserL.frequencyBinCount);
    dataR = new Float32Array(analyserR.frequencyBinCount);

    sampleRateDisplay.textContent = 'Context sample rate: ' + audioCtx.sampleRate + ' Hz';

    // push current UI state into the processor
    synthNode.port.postMessage({ type: 'mode', payload: state.mode });
    synthNode.port.postMessage({ type: 'beat', payload: state.beat });
    synthNode.port.postMessage({ type: 'layers', payload: state.layers });
    synthNode.port.postMessage({ type: 'masterGain', payload: state.masterGain });
    synthNode.port.postMessage({ type: 'noiseGain', payload: state.noiseEnabled ? state.noiseLevel : 0 });
    synthNode.port.postMessage({ type: 'noiseType', payload: state.noiseType });
  }

  function startSpectraLoop() {
    // Throttle to ~15 fps: each draw runs two 32768-point FFTs, and 60 fps of that
    // is wasted CPU that makes system-level audio underruns likelier on a busy machine.
    let lastDraw = 0;
    function draw(now) {
      if (now - lastDraw >= 66) {
        lastDraw = now;
        drawSpectrum(spectrumCanvasL, analyserL, dataL, 'L');
        drawSpectrum(spectrumCanvasR, analyserR, dataR, 'R');
      }
      rafHandle = requestAnimationFrame(draw);
    }
    rafHandle = requestAnimationFrame(draw);
    measureIntervalHandle = setInterval(updateMeasurementTable, 200);
  }

  function stopSpectraLoop() {
    if (rafHandle) cancelAnimationFrame(rafHandle);
    rafHandle = null;
    if (measureIntervalHandle) clearInterval(measureIntervalHandle);
    measureIntervalHandle = null;
  }

  function clearSessionTimer() {
    if (sessionTimerHandle) {
      clearTimeout(sessionTimerHandle);
      sessionTimerHandle = null;
    }
  }

  function scheduleSessionTimer() {
    clearSessionTimer();
    if (state.timerMinutes > 0) {
      sessionTimerHandle = setTimeout(onTimerExpire, state.timerMinutes * 60 * 1000);
    }
  }

  function clearTimerExpireHandle() {
    if (timerExpireHandle) {
      clearTimeout(timerExpireHandle);
      timerExpireHandle = null;
    }
  }

  function onTimerExpire() {
    sessionTimerHandle = null;
    if (synthNode) {
      synthNode.port.postMessage({ type: 'fade', payload: { to: 0, seconds: 10 } });
    }
    timerExpireHandle = setTimeout(function () {
      timerExpireHandle = null;
      finishStop();
    }, 10000);
  }

  function finishStop() {
    if (audioCtx) audioCtx.suspend();
    running = false;
    startStopBtn.textContent = 'Start';
    startStopBtn.classList.remove('running');
    stopSpectraLoop();
    updateNowPlaying();
  }

  async function handleStart() {
    if (starting || running) return; // re-entrancy guard: addModule()/resume() are async
    starting = true;
    try {
      clearTimerExpireHandle(); // cancel any pending timer-expiry finishStop() from a prior session
      await ensureAudioGraph();
      await audioCtx.resume();
      running = true;
      startStopBtn.textContent = 'Stop';
      startStopBtn.classList.add('running');
      synthNode.port.postMessage({ type: 'fade', payload: { to: 1, seconds: 1 } });
      scheduleSessionTimer();
      stopSpectraLoop();
      startSpectraLoop();
      updateNowPlaying();
    } finally {
      starting = false;
    }
  }

  function handleStop() {
    clearSessionTimer();
    clearTimerExpireHandle(); // avoid a stale finishStop() firing later and desyncing the UI
    if (synthNode) {
      synthNode.port.postMessage({ type: 'fade', payload: { to: 0, seconds: 0.05 } });
    }
    setTimeout(function () {
      if (audioCtx) audioCtx.suspend();
      running = false;
      startStopBtn.textContent = 'Start';
      startStopBtn.classList.remove('running');
      stopSpectraLoop();
      updateNowPlaying();
    }, 80);
  }

  startStopBtn.addEventListener('click', function () {
    if (running) {
      handleStop();
    } else {
      handleStart();
    }
  });

  timerSelect.addEventListener('change', function () {
    state.timerMinutes = parseInt(timerSelect.value, 10) || 0;
    saveSettings();
    if (running) scheduleSessionTimer();
  });

  masterVolume.addEventListener('input', function () {
    state.masterGain = parseFloat(masterVolume.value);
    if (synthNode) synthNode.port.postMessage({ type: 'masterGain', payload: state.masterGain });
    saveSettings();
  });

  // ---- mode toggle ----
  function setMode(mode) {
    state.mode = mode;
    renderModeUI();
    if (synthNode) synthNode.port.postMessage({ type: 'mode', payload: state.mode });
    saveSettings();
  }

  modeBinauralBtn.addEventListener('click', function () { setMode('binaural'); });
  modeIsochronicBtn.addEventListener('click', function () { setMode('isochronic'); });

  // ---- beat control ----
  function setBeat(value) {
    let beat = parseFloat(value);
    if (!Number.isFinite(beat)) return;
    beat = Math.min(40, Math.max(0.5, beat));
    state.beat = beat;
    beatSlider.value = beat;
    // Never rewrite the number field mid-typing: clamping "52" to "40" on the
    // input event makes multi-digit values impossible to key in.
    if (document.activeElement !== beatNumber) beatNumber.value = beat;
    updateBandUI();
    if (synthNode) synthNode.port.postMessage({ type: 'beat', payload: state.beat });
    saveSettings();
  }

  beatSlider.addEventListener('input', function () { setBeat(beatSlider.value); });
  beatNumber.addEventListener('input', function () { setBeat(beatNumber.value); });
  // Normalize the display to the clamped value once the user leaves the field.
  beatNumber.addEventListener('change', function () { beatNumber.value = state.beat; });

  // ---- presets ----
  document.querySelectorAll('.preset-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setBeat(btn.getAttribute('data-beat'));
    });
  });

  // ---- layers ----
  for (let i = 0; i < NUM_LAYER_ROWS; i++) {
    const idx = i;
    const enableEl = document.getElementById('layerEnable' + idx);
    const carrierEl = document.getElementById('layerCarrier' + idx);
    const gainEl = document.getElementById('layerGain' + idx);

    enableEl.addEventListener('change', function () {
      state.layers[idx].enabled = enableEl.checked;
      sendLayers();
      saveSettings();
    });
    carrierEl.addEventListener('input', function () {
      let v = parseFloat(carrierEl.value);
      if (!Number.isFinite(v)) return;
      v = Math.min(1000, Math.max(50, v));
      state.layers[idx].carrier = v;
      sendLayers();
      saveSettings();
      // Updated by Claude Sonnet (brief by Claude Fable 5) on 16Aug2026 at 1:22pm EAT. purpose: a
      // manual carrier edit can change which layer is musically nearest baseHz, so recompute the
      // anchor and refresh the hint (baseHz itself is left alone — the user didn't touch it).
      state.anchorIndex = nearestLayerIndex(state.baseHz);
      renderBaseUI();
    });
    gainEl.addEventListener('input', function () {
      state.layers[idx].gain = parseFloat(gainEl.value);
      sendLayers();
      saveSettings();
    });
  }

  // Added by Claude Sonnet (brief by Claude Fable 5) on 16Aug2026 at 1:05pm EAT. purpose: wire the
  // Base Hz field.
  // Edited by Claude Fable 5 on 16Aug2026 at 1:40pm EAT. purpose: apply on 'change' (Enter, blur,
  // spinner arrows) rather than every keystroke — typing "528" used to retune to 5→50, then 52,
  // then 528, and the anchor picked at 50 differs from the one picked straight from the stack.
  // Enter applies immediately (blur() triggers the change event); Escape reverts the display.
  baseHzInput.addEventListener('change', function () { setBaseHz(baseHzInput.value); renderBaseUI(); });
  baseHzInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { baseHzInput.blur(); }
    if (e.key === 'Escape') { renderBaseUI(); baseHzInput.blur(); }
  });

  septaStackBtn.addEventListener('click', function () {
    // Updated by Claude Sonnet (brief by Claude Fable 5) on 16Aug2026 at 1:22pm EAT. purpose: stack
    // buttons set the base + anchor to their native tone/layer and restore native gains — setBaseHz
    // is not called here, so its rank-based re-weighting never overrides a preset's own gains.
    state.baseHz = 120;
    state.anchorIndex = 0;
    lastClampedCount = 0;
    state.layers = SEPTA_STACK.map((l) => Object.assign({}, l));
    renderLayersUI();
    renderBaseUI();
    sendLayers();
    saveSettings();
  });

  // The seven classic solfeggio pitches as carriers. Folklore, not science — but
  // popular, and here every pitch is FFT-verified instead of taken on faith.
  // 528 ("miracle tone") gets the loudest slot; gains taper with pitch so the
  // high tones don't dominate perceived loudness.
  const SOLFEGGIO_STACK = [
    { carrier: 396, gain: 0.7, enabled: true },
    { carrier: 417, gain: 0.7, enabled: true },
    { carrier: 528, gain: 1.0, enabled: true },
    { carrier: 639, gain: 0.6, enabled: true },
    { carrier: 741, gain: 0.5, enabled: true },
    { carrier: 852, gain: 0.45, enabled: true },
    { carrier: 963, gain: 0.4, enabled: true }
  ];
  // Updated by Claude Sonnet (brief by Claude Fable 5) on 16Aug2026 at 1:22pm EAT. purpose: 528 Hz
  // ("the miracle tone") is Solfeggio's signature — that's the tone Base Hz plays exactly when this
  // preset loads, index 2 in the array above.
  SOLFEGGIO_STACK.nativeBase = 528;

  solfeggioBtn.addEventListener('click', function () {
    state.baseHz = 528;
    state.anchorIndex = 2;
    lastClampedCount = 0;
    state.layers = SOLFEGGIO_STACK.map((l) => Object.assign({}, l));
    renderLayersUI();
    renderBaseUI();
    sendLayers();
    saveSettings();
  });

  singleToneBtn.addEventListener('click', function () {
    state.baseHz = 200;
    state.anchorIndex = 0;
    lastClampedCount = 0;
    state.layers[0].enabled = true;
    state.layers[0].carrier = 200;
    state.layers[0].gain = 1;
    for (let i = 1; i < NUM_LAYER_ROWS; i++) {
      state.layers[i].enabled = false;
    }
    renderLayersUI();
    renderBaseUI();
    sendLayers();
    saveSettings();
  });

  // ---- noise ----
  function sendNoiseGain() {
    if (synthNode) {
      synthNode.port.postMessage({ type: 'noiseGain', payload: state.noiseEnabled ? state.noiseLevel : 0 });
    }
  }

  noiseEnable.addEventListener('change', function () {
    state.noiseEnabled = noiseEnable.checked;
    sendNoiseGain();
    saveSettings();
  });

  noiseLevel.addEventListener('input', function () {
    state.noiseLevel = parseFloat(noiseLevel.value);
    sendNoiseGain();
    saveSettings();
  });

  noiseTypeSel.addEventListener('change', function () {
    state.noiseType = noiseTypeSel.value === 'brown' ? 'brown' : 'pink';
    if (synthNode) synthNode.port.postMessage({ type: 'noiseType', payload: state.noiseType });
    saveSettings();
  });

  // ---- channel test ----
  function runTest(channel) {
    if (testTimeoutHandle) {
      clearTimeout(testTimeoutHandle);
      testTimeoutHandle = null;
    }
    if (!synthNode) return; // must have started the engine first
    synthNode.port.postMessage({ type: 'test', payload: channel });
    testTimeoutHandle = setTimeout(function () {
      synthNode.port.postMessage({ type: 'test', payload: null });
      testTimeoutHandle = null;
    }, 2000);
  }

  testLeftBtn.addEventListener('click', function () { runTest('left'); });
  testRightBtn.addEventListener('click', function () { runTest('right'); });

  // ---------------------------------------------------------------------
  // Proof panel: spectra drawing
  // ---------------------------------------------------------------------
  const DISPLAY_MAX_HZ = 1000;

  function expectedFrequencies() {
    // returns array of {index, carrier, gain, expectedL, expectedR} for enabled layers
    const result = [];
    for (let i = 0; i < state.layers.length; i++) {
      const layer = state.layers[i];
      if (!layer.enabled) continue;
      if (state.mode === 'binaural') {
        result.push({
          index: i,
          carrier: layer.carrier,
          expectedL: layer.carrier - state.beat / 2,
          expectedR: layer.carrier + state.beat / 2
        });
      } else {
        result.push({
          index: i,
          carrier: layer.carrier,
          expectedL: layer.carrier,
          expectedR: layer.carrier
        });
      }
    }
    return result;
  }

  function drawSpectrum(canvas, analyser, dataArr, side) {
    if (!analyser) return;
    analyser.getFloatFrequencyData(dataArr);

    const ctx2d = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx2d.clearRect(0, 0, w, h);

    const minDb = analyser.minDecibels;
    const maxDb = analyser.maxDecibels;
    const binWidth = audioCtx.sampleRate / analyser.fftSize;
    const maxBin = Math.min(dataArr.length - 1, Math.ceil(DISPLAY_MAX_HZ / binWidth));

    // spectrum line
    ctx2d.strokeStyle = side === 'L' ? '#5ce1e6' : '#7c5cff';
    ctx2d.lineWidth = 1.5;
    ctx2d.beginPath();
    for (let b = 0; b <= maxBin; b++) {
      const freq = b * binWidth;
      const x = (freq / DISPLAY_MAX_HZ) * w;
      const db = Math.max(minDb, Math.min(maxDb, dataArr[b]));
      const y = h - ((db - minDb) / (maxDb - minDb)) * h;
      if (b === 0) ctx2d.moveTo(x, y);
      else ctx2d.lineTo(x, y);
    }
    ctx2d.stroke();

    // markers at each enabled layer's expected frequency for this channel
    const expected = expectedFrequencies();
    ctx2d.strokeStyle = '#ffd35c';
    ctx2d.lineWidth = 1;
    expected.forEach(function (e) {
      const freq = side === 'L' ? e.expectedL : e.expectedR;
      if (freq < 0 || freq > DISPLAY_MAX_HZ) return;
      const x = (freq / DISPLAY_MAX_HZ) * w;
      ctx2d.beginPath();
      ctx2d.moveTo(x, 0);
      ctx2d.lineTo(x, h);
      ctx2d.stroke();
    });
  }

  // ---------------------------------------------------------------------
  // Proof panel: parabolic-interpolation measurement
  // ---------------------------------------------------------------------
  function measureFrequency(dataArr, expectedFreq, binWidth) {
    const searchBins = Math.max(1, Math.round(5 / binWidth));
    const centerBin = Math.round(expectedFreq / binWidth);
    const lo = Math.max(1, centerBin - searchBins);
    const hi = Math.min(dataArr.length - 2, centerBin + searchBins);
    if (lo > hi) return null;

    let peakBin = lo;
    let peakVal = dataArr[lo];
    for (let b = lo; b <= hi; b++) {
      if (dataArr[b] > peakVal) {
        peakVal = dataArr[b];
        peakBin = b;
      }
    }

    const alpha = dataArr[peakBin - 1];
    const beta = dataArr[peakBin];
    const gamma = dataArr[peakBin + 1];

    if (!Number.isFinite(alpha) || !Number.isFinite(beta) || !Number.isFinite(gamma)) {
      return peakBin * binWidth;
    }

    const denom = alpha - 2 * beta + gamma;
    let delta = 0;
    if (Math.abs(denom) > 1e-9) {
      delta = 0.5 * (alpha - gamma) / denom;
    }
    if (!Number.isFinite(delta) || Math.abs(delta) > 0.5) {
      return peakBin * binWidth;
    }

    return (peakBin + delta) * binWidth;
  }

  function updateMeasurementTable() {
    if (!audioCtx || !analyserL || !analyserR) return;

    analyserL.getFloatFrequencyData(dataL);
    analyserR.getFloatFrequencyData(dataR);

    const binWidth = audioCtx.sampleRate / analyserL.fftSize;
    const expected = expectedFrequencies();
    const isBinaural = state.mode === 'binaural';

    if (isBinaural) {
      measurementTableHead.innerHTML =
        '<tr><th>Layer</th><th>Set L</th><th>Measured L</th><th>Set R</th><th>Measured R</th></tr>';
    } else {
      measurementTableHead.innerHTML =
        '<tr><th>Layer</th><th>Set</th><th>Measured</th><th>Gate rate</th></tr>';
    }

    let rows = '';
    expected.forEach(function (e) {
      const measL = measureFrequency(dataL, e.expectedL, binWidth);
      const measR = measureFrequency(dataR, e.expectedR, binWidth);
      const okL = measL !== null && Math.abs(measL - e.expectedL) < 0.5;
      const okR = measR !== null && Math.abs(measR - e.expectedR) < 0.5;
      const label = 'Layer ' + (e.index + 1);

      if (isBinaural) {
        rows += '<tr><td>' + label + '</td>' +
          '<td>' + e.expectedL.toFixed(3) + ' Hz</td>' +
          '<td>' + fmtMeasured(measL, okL) + '</td>' +
          '<td>' + e.expectedR.toFixed(3) + ' Hz</td>' +
          '<td>' + fmtMeasured(measR, okR) + '</td></tr>';
      } else {
        rows += '<tr><td>' + label + '</td>' +
          '<td>' + e.carrier.toFixed(3) + ' Hz</td>' +
          '<td>' + fmtMeasured(measL, okL) + '</td>' +
          '<td>' + state.beat.toFixed(1) + ' Hz</td></tr>';
      }
    });
    measurementTableBody.innerHTML = rows;
  }

  function fmtMeasured(freq, ok) {
    if (freq === null) return '<span class="no-mark">&mdash;</span>';
    const markClass = ok ? 'ok-mark' : 'no-mark';
    const mark = ok ? '✓' : '';
    return freq.toFixed(2) + ' Hz <span class="' + markClass + '">' + mark + '</span>';
  }

  // ---------------------------------------------------------------------
  // Service worker registration
  // ---------------------------------------------------------------------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {
        // registration failure should not break the app
      });
    });
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  loadSettings();
  renderAllUI();
})();
