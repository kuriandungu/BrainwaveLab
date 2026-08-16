/* Added by claude-code on 10thAug2026 at 12:33pm GMT+3. purpose: AudioWorkletProcessor implementing
   BrainwaveLab V1 real-time synthesis (binaural/isochronic layers + pink noise) per SPEC.md. */

const MAX_LAYERS = 8;
const TWO_PI = 2 * Math.PI;
const GAIN_SMOOTH_COEF = 0.001; // one-pole smoother, ~20ms time constant at typical sample rates

class BrainwaveSynthProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [];
  }

  constructor() {
    super();

    // --- state set via port.postMessage({type, payload}) ---
    this.mode = 'binaural';   // 'binaural' | 'isochronic'
    this.beat = 10;           // Hz
    this.layers = [];         // [{carrier, gain, enabled}, ...] up to MAX_LAYERS, fixed slots
    this.test = null;         // null | 'left' | 'right'

    // --- gain targets + one-pole smoothed values (click-free level changes) ---
    this.masterGainTarget = 0;
    this.masterGainSmoothed = 0;
    this.noiseGainTarget = 0;
    this.noiseGainSmoothed = 0;
    this.layerGainSmoothed = new Array(MAX_LAYERS).fill(0);

    // --- double-precision phase accumulators, two per layer (never reset to 0) ---
    // Initial phases are randomized: the default carriers are harmonically related
    // (all multiples of 60 Hz), so identical start phases re-align constructively
    // and the summed peak reaches the coherent bound (~1.47x), clipping at high
    // master volume. Random phases decorrelate the peaks. Frequency is unaffected.
    this.phaseL = new Array(MAX_LAYERS);
    this.phaseR = new Array(MAX_LAYERS);
    for (let i = 0; i < MAX_LAYERS; i++) {
      this.phaseL[i] = Math.random() * TWO_PI;
      this.phaseR[i] = Math.random() * TWO_PI;
    }

    // --- shared isochronic gate accumulator, phase in [0,1) ---
    this.gatePhase = 0;

    // --- channel-separation test tone (440 Hz), independent accumulator; per-channel
    //     crossfade mixes so start/stop/side-switch are all click-free ---
    this.testPhase = 0;
    this.testMixL = 0;
    this.testMixR = 0;

    // --- noise bed: 'pink' | 'brown' ---
    this.noiseType = 'pink';
    // brown noise state: leaky integrator of white noise (-6 dB/octave)
    this.brown = 0;

    // --- pink noise filter state (Paul Kellet's refined method) ---
    this.pb0 = 0;
    this.pb1 = 0;
    this.pb2 = 0;
    this.pb3 = 0;
    this.pb4 = 0;
    this.pb5 = 0;
    this.pb6 = 0;

    // --- generic linear fade envelope (0..1), drives start fade-in / stop / timer fade-out ---
    this.fadeMultiplier = 0;
    this.fadeTarget = 0;
    this.fadeStep = 0;

    this.port.onmessage = (event) => this._handleMessage(event.data);
  }

  _handleMessage(msg) {
    const type = msg.type;
    const payload = msg.payload;
    switch (type) {
      case 'mode':
        this.mode = payload;
        break;
      case 'beat':
        this.beat = payload;
        break;
      case 'layers':
        this.layers = payload;
        break;
      case 'masterGain':
        this.masterGainTarget = payload;
        break;
      case 'noiseGain':
        this.noiseGainTarget = payload;
        break;
      case 'noiseType':
        this.noiseType = payload === 'brown' ? 'brown' : 'pink';
        break;
      case 'test':
        this.test = payload;
        break;
      case 'fade': {
        const seconds = Math.max(payload.seconds, 1 / sampleRate);
        this.fadeTarget = payload.to;
        this.fadeStep = (payload.to - this.fadeMultiplier) / (seconds * sampleRate);
        break;
      }
      default:
        break;
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const chL = output[0];
    const chR = output[1];
    const n = chL.length;

    const layers = this.layers;
    const numLayers = layers.length;

    // Normalization divisor is recomputed per block (enabled count changes only via messages).
    let enabledCount = 0;
    for (let i = 0; i < numLayers; i++) {
      if (layers[i].enabled) enabledCount++;
    }
    const norm = 1 / Math.max(1, Math.sqrt(enabledCount));

    for (let s = 0; s < n; s++) {
      // one-pole smoothers for master/noise gain
      this.masterGainSmoothed += (this.masterGainTarget - this.masterGainSmoothed) * GAIN_SMOOTH_COEF;
      this.noiseGainSmoothed += (this.noiseGainTarget - this.noiseGainSmoothed) * GAIN_SMOOTH_COEF;

      // linear start/stop/timer fade envelope
      if (this.fadeMultiplier !== this.fadeTarget) {
        this.fadeMultiplier += this.fadeStep;
        if ((this.fadeStep > 0 && this.fadeMultiplier > this.fadeTarget) ||
            (this.fadeStep < 0 && this.fadeMultiplier < this.fadeTarget)) {
          this.fadeMultiplier = this.fadeTarget;
        }
      }

      let outL;
      let outR;

      {
        // shared isochronic gate (raised-cosine), gatePhase advances at beat Hz regardless of mode
        this.gatePhase += this.beat / sampleRate;
        if (this.gatePhase >= 1) this.gatePhase -= 1;

        let gate = 1;
        if (this.mode === 'isochronic') {
          const p = this.gatePhase;
          if (p < 0.1) {
            gate = 0.5 * (1 - Math.cos(Math.PI * p / 0.1));
          } else if (p < 0.4) {
            gate = 1;
          } else if (p < 0.5) {
            gate = 0.5 * (1 + Math.cos(Math.PI * (p - 0.4) / 0.1));
          } else {
            gate = 0;
          }
        }

        let sumL = 0;
        let sumR = 0;
        for (let i = 0; i < numLayers; i++) {
          const layer = layers[i];
          const target = layer.enabled ? layer.gain : 0;
          this.layerGainSmoothed[i] += (target - this.layerGainSmoothed[i]) * GAIN_SMOOTH_COEF;
          const g = this.layerGainSmoothed[i];

          if (this.mode === 'binaural') {
            const incL = layer.carrier - this.beat / 2;
            const incR = layer.carrier + this.beat / 2;
            this.phaseL[i] += TWO_PI * incL / sampleRate;
            if (this.phaseL[i] > TWO_PI) this.phaseL[i] -= TWO_PI;
            this.phaseR[i] += TWO_PI * incR / sampleRate;
            if (this.phaseR[i] > TWO_PI) this.phaseR[i] -= TWO_PI;
            sumL += Math.sin(this.phaseL[i]) * g;
            sumR += Math.sin(this.phaseR[i]) * g;
          } else {
            // Isochronic: identical carrier tone on both channels (uses phaseL only, so L and
            // R are bit-for-bit identical); phaseR keeps advancing at the same rate so it stays
            // continuous if the mode is later switched back to binaural.
            const inc = layer.carrier;
            this.phaseL[i] += TWO_PI * inc / sampleRate;
            if (this.phaseL[i] > TWO_PI) this.phaseL[i] -= TWO_PI;
            this.phaseR[i] += TWO_PI * inc / sampleRate;
            if (this.phaseR[i] > TWO_PI) this.phaseR[i] -= TWO_PI;
            const raw = Math.sin(this.phaseL[i]) * g * gate;
            sumL += raw;
            sumR += raw;
          }
        }
        sumL *= norm;
        sumR *= norm;

        // Pink noise (Paul Kellet's refined filter), same value to both channels.
        const white = Math.random() * 2 - 1;
        this.pb0 = 0.99886 * this.pb0 + white * 0.0555179;
        this.pb1 = 0.99332 * this.pb1 + white * 0.0750759;
        this.pb2 = 0.96900 * this.pb2 + white * 0.1538520;
        this.pb3 = 0.86650 * this.pb3 + white * 0.3104856;
        this.pb4 = 0.55000 * this.pb4 + white * 0.5329522;
        this.pb5 = -0.7616 * this.pb5 - white * 0.0168980;
        let pink = this.pb0 + this.pb1 + this.pb2 + this.pb3 + this.pb4 + this.pb5 + this.pb6 + white * 0.5362;
        this.pb6 = white * 0.115926;
        pink *= 0.11;

        // Brown noise: leaky integration of white (-6 dB/oct, deep rumble). Both
        // generators always run (both are cheap, and keeping state warm makes
        // switching types click-free); the selector picks which one is heard.
        this.brown = (this.brown + 0.02 * white) / 1.02;
        const brown = this.brown * 3.5;

        const noise = (this.noiseType === 'brown' ? brown : pink) * this.noiseGainSmoothed * 0.3;

        outL = (sumL + noise) * this.masterGainSmoothed * this.fadeMultiplier;
        outR = (sumR + noise) * this.masterGainSmoothed * this.fadeMultiplier;
      }

      // Channel-separation test: crossfaded per channel so start, timeout, side-switch
      // and Stop are all click-free, and the tone respects master volume + fade envelope.
      // Off-channel suppression passes -120 dB within ~150 ms (acceptance bound: -80 dB).
      this.testMixL += ((this.test === 'left' ? 1 : 0) - this.testMixL) * 0.002;
      this.testMixR += ((this.test === 'right' ? 1 : 0) - this.testMixR) * 0.002;
      const testMix = Math.max(this.testMixL, this.testMixR);
      if (testMix > 1e-4) {
        this.testPhase += TWO_PI * 440 / sampleRate;
        if (this.testPhase > TWO_PI) this.testPhase -= TWO_PI;
        const tone = 0.5 * Math.sin(this.testPhase) * this.masterGainSmoothed * this.fadeMultiplier;
        outL = outL * (1 - testMix) + tone * this.testMixL;
        outR = outR * (1 - testMix) + tone * this.testMixR;
      }

      chL[s] = Math.min(1, Math.max(-1, outL));
      chR[s] = Math.min(1, Math.max(-1, outR));
    }

    return true;
  }
}

registerProcessor('brainwave-synth', BrainwaveSynthProcessor);
