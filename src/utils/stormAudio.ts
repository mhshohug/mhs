import { WeatherMood } from './rajshahiWeather';

type UnlockListener = (unlocked: boolean) => void;

/**
 * Unified Web Audio Engine:
 * - Natural, non-harsh soft Rainfall (warm downpour wash + realistic discrete water droplets, NO harsh static hiss)
 * - Soft ambient Thunder synced with lightning (always softer than songs, always running on normal days)
 * - Mild/Gentle Birthday Firework sounds (always softer than birthday songs, always running in Birthday mode)
 * - Louder foreground Music Synth bus for fallback melody when MP3s aren't added yet
 */
type SceneAudioMode = 'storm' | 'weather' | 'birthday';

class StormAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private rainGroupGain: GainNode | null = null;
  private rainMoodGain: GainNode | null = null;
  private thunderBus: GainNode | null = null;
  private weatherGroupGain: GainNode | null = null;
  private weatherBreezeGain: GainNode | null = null;
  private weatherBreezeFilter: BiquadFilterNode | null = null;
  private weatherRainGain: GainNode | null = null;
  private weatherNatureBus: GainNode | null = null;
  private birthdayBus: GainNode | null = null;
  private musicBus: GainNode | null = null;

  private isRainGraphBuilt = false;
  private isWeatherGraphBuilt = false;
  private isRainMuted = false;
  private sceneMode: SceneAudioMode = 'storm';
  private currentMood: WeatherMood = 'rain';
  private weatherIsDay = true;
  private weatherWindKmh = 8;
  private weatherTempC = 25;
  private sunProgress = 0.5;
  private natureTimer: number | null = null;
  private unlockListeners = new Set<UnlockListener>();
  private gestureHooksInstalled = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.installGlobalGestureHooks();
      try {
        this.unlockAndStart(this.currentMood);
      } catch {
        // Unlocks cleanly on first user interaction
      }
    }
  }

  private installGlobalGestureHooks(): void {
    if (this.gestureHooksInstalled) return;
    this.gestureHooksInstalled = true;

    const handleUserGesture = () => {
      const ctx = this.ensureContext();
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        ctx
          .resume()
          .then(() => {
            this.notifyUnlockState();
          })
          .catch(() => {});
      } else {
        this.notifyUnlockState();
      }

      if (!this.isRainGraphBuilt) {
        this.buildRainGraph(ctx);
      }
      if (!this.isWeatherGraphBuilt) {
        this.buildWeatherGraph(ctx);
      }
      this.applySceneAudioState();
    };

    const events: Array<keyof WindowEventMap> = [
      'pointerdown',
      'pointerup',
      'touchstart',
      'touchend',
      'wheel',
      'click',
      'keydown',
    ];
    events.forEach((evt) => {
      window.addEventListener(evt, handleUserGesture, { capture: true, passive: true });
    });
  }

  private notifyUnlockState(): void {
    const unlocked = this.isUnlocked();
    this.unlockListeners.forEach((cb) => cb(unlocked));
  }

  public onUnlockChange(cb: UnlockListener): () => void {
    this.unlockListeners.add(cb);
    cb(this.isUnlocked());
    return () => {
      this.unlockListeners.delete(cb);
    };
  }

  public isUnlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;

    if (!this.ctx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;

      const ctx = new Ctx();
      this.ctx = ctx;

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.knee.value = 18;
      compressor.ratio.value = 3.5;
      compressor.attack.value = 0.005;
      compressor.release.value = 0.25;

      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = 1.0;

      // Ambient Rain + Thunder bus (softer than songs, always running on normal storm days)
      this.rainGroupGain = ctx.createGain();
      this.rainGroupGain.gain.value = this.sceneMode === 'storm' && !this.isRainMuted ? 1.0 : 0;

      this.rainMoodGain = ctx.createGain();
      this.rainMoodGain.gain.value = this.moodToGain(this.currentMood);

      this.thunderBus = ctx.createGain();
      this.thunderBus.gain.value = 0.42;

      // Live Daily Weather Mode bus (wind breeze, birdsong, night crickets, or live rain)
      this.weatherGroupGain = ctx.createGain();
      this.weatherGroupGain.gain.value = this.sceneMode === 'weather' ? 1.0 : 0;

      this.weatherBreezeFilter = ctx.createBiquadFilter();
      this.weatherBreezeFilter.type = 'bandpass';
      this.weatherBreezeFilter.frequency.value = 380;
      this.weatherBreezeFilter.Q.value = 0.7;

      this.weatherBreezeGain = ctx.createGain();
      this.weatherBreezeGain.gain.value = 0.12;

      this.weatherRainGain = ctx.createGain();
      this.weatherRainGain.gain.value = 0;

      this.weatherNatureBus = ctx.createGain();
      this.weatherNatureBus.gain.value = 0.55;

      // Mild/gentle Birthday Fireworks bus (always running softly in Birthday mode)
      this.birthdayBus = ctx.createGain();
      this.birthdayBus.gain.value = 0.26;

      // Louder Music bus
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 1.15;

      this.rainMoodGain.connect(this.rainGroupGain);
      this.thunderBus.connect(this.rainGroupGain);
      this.rainGroupGain.connect(this.masterGain);

      this.weatherBreezeFilter.connect(this.weatherBreezeGain);
      this.weatherBreezeGain.connect(this.weatherGroupGain);
      this.weatherRainGain.connect(this.weatherGroupGain);
      this.weatherNatureBus.connect(this.weatherGroupGain);
      this.weatherGroupGain.connect(this.masterGain);

      this.birthdayBus.connect(this.masterGain);
      this.musicBus.connect(this.masterGain);

      this.masterGain.connect(compressor);
      compressor.connect(ctx.destination);

      ctx.onstatechange = () => {
        this.notifyUnlockState();
        if (ctx.state === 'running') {
          this.applySceneAudioState();
        }
      };
    }

    if (this.ctx.state === 'suspended') {
      this.ctx
        .resume()
        .then(() => this.notifyUnlockState())
        .catch(() => {});
    }

    return this.ctx;
  }

  private moodToGain(mood: WeatherMood): number {
    if (mood === 'storm') return 0.26;
    if (mood === 'rain') return 0.21;
    return 0.16;
  }

  private buildRainGraph(ctx: AudioContext): void {
    if (this.isRainGraphBuilt || !this.rainMoodGain) return;
    this.isRainGraphBuilt = true;

    const sampleRate = ctx.sampleRate;

    // 1. Gentle airy drizzle mist wash (soft light drizzle, zero harsh static or heavy roar)
    const washLen = sampleRate * 6;
    const washBuf = ctx.createBuffer(2, washLen, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = washBuf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, smooth = 0;
      for (let i = 0; i < washLen; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.996 * b0 + white * 0.025;
        b1 = 0.980 * b1 + white * 0.030;
        b2 = 0.935 * b2 + white * 0.045;
        const pink = b0 + b1 + b2 + white * 0.015;
        smooth = smooth * 0.65 + pink * 0.35;
        data[i] = Math.max(-0.85, Math.min(0.85, smooth * 0.9));
      }
    }

    const drizzleWashSrc = ctx.createBufferSource();
    drizzleWashSrc.buffer = washBuf;
    drizzleWashSrc.loop = true;

    const drizzleFilter = ctx.createBiquadFilter();
    drizzleFilter.type = 'bandpass';
    drizzleFilter.frequency.value = 1050;
    drizzleFilter.Q.value = 0.45;

    const drizzleWashGain = ctx.createGain();
    drizzleWashGain.gain.value = 0.42;

    drizzleWashSrc.connect(drizzleFilter);
    drizzleFilter.connect(drizzleWashGain);
    drizzleWashGain.connect(this.rainMoodGain);
    drizzleWashSrc.start();

    // 2. Delicate drizzling raindrop patter (ঝিরি ঝিরি বৃষ্টির ফোঁটা)
    const dropLen = sampleRate * 6;
    const dropBuf = ctx.createBuffer(2, dropLen, sampleRate);
    const numDroplets = 760;
    for (let d = 0; d < numDroplets; d++) {
      const ch = d % 2;
      const data = dropBuf.getChannelData(ch);
      const startSample = Math.floor(Math.random() * (dropLen - sampleRate * 0.04));
      const tapFreq = 780 + Math.random() * 1250;
      const tapLen = Math.floor(sampleRate * (0.005 + Math.random() * 0.011));
      const amp = 0.07 + Math.random() * 0.14;
      for (let j = 0; j < tapLen && startSample + j < dropLen; j++) {
        const t = j / sampleRate;
        const env = Math.exp(-t / 0.0024);
        const tone = Math.sin(2 * Math.PI * tapFreq * t * (1 + t * 22));
        data[startSample + j] += tone * env * amp;
      }
    }

    const dropSrc = ctx.createBufferSource();
    dropSrc.buffer = dropBuf;
    dropSrc.loop = true;

    const dropFilter = ctx.createBiquadFilter();
    dropFilter.type = 'lowpass';
    dropFilter.frequency.value = 1850;

    const dropGain = ctx.createGain();
    dropGain.gain.value = 0.72;

    dropSrc.connect(dropFilter);
    dropFilter.connect(dropGain);
    dropGain.connect(this.rainMoodGain);
    dropSrc.start();

    // Feed soft drizzle + droplets into Weather Mode live-rain bus too (muted unless live weather is raining)
    if (this.weatherRainGain) {
      drizzleWashGain.connect(this.weatherRainGain);
      dropGain.connect(this.weatherRainGain);
    }
  }

  private buildWeatherGraph(ctx: AudioContext): void {
    if (this.isWeatherGraphBuilt || !this.weatherBreezeFilter) return;
    this.isWeatherGraphBuilt = true;

    const sampleRate = ctx.sampleRate;
    const breezeLen = sampleRate * 7;
    const breezeBuf = ctx.createBuffer(2, breezeLen, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = breezeBuf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < breezeLen; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + white * 0.022;
        b1 = 0.985 * b1 + white * 0.026;
        b2 = 0.955 * b2 + white * 0.032;
        data[i] = Math.max(-0.8, Math.min(0.8, (b0 + b1 + b2) * 1.15));
      }
    }

    const breezeSrc = ctx.createBufferSource();
    breezeSrc.buffer = breezeBuf;
    breezeSrc.loop = true;

    // Gentle LFO breathing on foliage breeze filter cutoff
    const breezeLfo = ctx.createOscillator();
    breezeLfo.type = 'sine';
    breezeLfo.frequency.value = 0.11;
    const breezeLfoDepth = ctx.createGain();
    breezeLfoDepth.gain.value = 140;

    breezeLfo.connect(breezeLfoDepth);
    breezeLfoDepth.connect(this.weatherBreezeFilter.frequency);
    breezeSrc.connect(this.weatherBreezeFilter);

    breezeLfo.start();
    breezeSrc.start();
  }

  /** Pleasant morning/evening songbird (দোয়েল / শালিক-সদৃশ মিষ্টি কলতান) */
  private playMorningSongbird(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const syllables = 3 + Math.floor(Math.random() * 3);
    const basePitch = 1900 + Math.random() * 750;

    for (let s = 0; s < syllables; s++) {
      const t0 = now + s * (0.11 + Math.random() * 0.05);
      const dur = 0.07 + Math.random() * 0.045;
      const osc = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const modGain = ctx.createGain();
      const env = ctx.createGain();

      osc.type = 'sine';
      const stepPattern = [1, 1.28, 1.12, 1.42, 1.22][s % 5];
      const fStart = basePitch * stepPattern;
      const fPeak = fStart * (1.16 + Math.random() * 0.14);
      osc.frequency.setValueAtTime(fStart, t0);
      osc.frequency.exponentialRampToValueAtTime(fPeak, t0 + dur * 0.55);
      osc.frequency.exponentialRampToValueAtTime(fStart * 0.96, t0 + dur);

      mod.type = 'sine';
      mod.frequency.value = 32 + Math.random() * 14;
      modGain.gain.value = 42;
      mod.connect(modGain);
      modGain.connect(osc.frequency);

      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.04, t0 + dur * 0.25);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(env);
      env.connect(this.weatherNatureBus);
      osc.start(t0);
      mod.start(t0);
      osc.stop(t0 + dur + 0.02);
      mod.stop(t0 + dur + 0.02);
    }
  }

  /** Hot summer/noon cuckoo or mourning dove (গরমের দুপুরের কোকিল বা ঘুঘুর ডাক + মৃদু গরমের ঝিঁঝিঁ) */
  private playHotMiddayCuckooOrDove(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;

    if (Math.random() < 0.55) {
      // Resonant rising Cuckoo ("কু-উ... কু-উ...")
      const base = 540 + Math.random() * 65;
      for (let rep = 0; rep < 2; rep++) {
        const t0 = now + rep * 0.68;
        const osc = ctx.createOscillator();
        const overtone = ctx.createOscillator();
        const oGain = ctx.createGain();
        const env = ctx.createGain();

        const pitchLift = rep === 1 ? 1.09 : 1.0;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(base * pitchLift, t0);
        osc.frequency.exponentialRampToValueAtTime(base * 1.28 * pitchLift, t0 + 0.24);

        overtone.type = 'sine';
        overtone.frequency.setValueAtTime(base * 2 * pitchLift, t0);
        overtone.frequency.exponentialRampToValueAtTime(base * 2.56 * pitchLift, t0 + 0.24);
        oGain.gain.value = 0.18;

        env.gain.setValueAtTime(0.0001, t0);
        env.gain.linearRampToValueAtTime(0.055, t0 + 0.05);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);

        osc.connect(env);
        overtone.connect(oGain);
        oGain.connect(env);
        env.connect(this.weatherNatureBus);

        osc.start(t0);
        overtone.start(t0);
        osc.stop(t0 + 0.36);
        overtone.stop(t0 + 0.36);
      }
    } else {
      // Soft mourning dove coo ("ঘু-ঘু-ঘু")
      const f = 410 + Math.random() * 35;
      const times = [0, 0.26, 0.5];
      for (let i = 0; i < times.length; i++) {
        const t0 = now + times[i];
        const dur = i === 0 ? 0.19 : 0.16;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, t0);
        osc.frequency.exponentialRampToValueAtTime(f * 0.89, t0 + dur);

        env.gain.setValueAtTime(0.0001, t0);
        env.gain.linearRampToValueAtTime(0.048, t0 + 0.04);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

        osc.connect(env);
        env.connect(this.weatherNatureBus);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
      }
    }

    // Subtle dry midday heat cicada shimmer
    if (Math.random() < 0.45) {
      const cStart = now + 0.25;
      const cDur = 0.85;
      const osc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const bp = ctx.createBiquadFilter();
      const env = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.value = 5100;
      lfo.type = 'sine';
      lfo.frequency.value = 22;
      lfoGain.gain.value = 280;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      bp.type = 'bandpass';
      bp.frequency.value = 4900;
      bp.Q.value = 3.2;

      env.gain.setValueAtTime(0.0001, cStart);
      env.gain.linearRampToValueAtTime(0.014, cStart + 0.25);
      env.gain.exponentialRampToValueAtTime(0.0001, cStart + cDur);

      osc.connect(bp);
      bp.connect(env);
      env.connect(this.weatherNatureBus);
      osc.start(cStart);
      lfo.start(cStart);
      osc.stop(cStart + cDur + 0.02);
      lfo.stop(cStart + cDur + 0.02);
    }
  }

  /** Harsh raspy Crow caw during excessive heat (অতিরিক্ত গরমে কাকের কর্কশ ডাক: কা-কা-কা) */
  private playHotCrowCaw(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const caws = 2 + (Math.random() < 0.5 ? 1 : 0);
    const basePitch = 455 + Math.random() * 65;

    for (let c = 0; c < caws; c++) {
      const t0 = now + c * (0.27 + Math.random() * 0.06);
      const dur = 0.17 + Math.random() * 0.04;

      const osc = ctx.createOscillator();
      const gritOsc = ctx.createOscillator();
      const gritGain = ctx.createGain();
      const f1 = ctx.createBiquadFilter();
      const f2 = ctx.createBiquadFilter();
      const env = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(basePitch * 1.08, t0);
      osc.frequency.linearRampToValueAtTime(basePitch * 1.12, t0 + dur * 0.35);
      osc.frequency.exponentialRampToValueAtTime(basePitch * 0.84, t0 + dur);

      // Vocal fold rasp/flutter giving authentic crow harshness
      gritOsc.type = 'triangle';
      gritOsc.frequency.value = 78 + Math.random() * 18;
      gritGain.gain.value = 52;
      gritOsc.connect(gritGain);
      gritGain.connect(osc.frequency);

      f1.type = 'bandpass';
      f1.frequency.value = 940;
      f1.Q.value = 2.6;

      f2.type = 'bandpass';
      f2.frequency.value = 1580;
      f2.Q.value = 2.2;

      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.042, t0 + 0.022);
      env.gain.setValueAtTime(0.038, t0 + dur * 0.65);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(f1);
      osc.connect(f2);
      f1.connect(env);
      f2.connect(env);
      env.connect(this.weatherNatureBus);

      osc.start(t0);
      gritOsc.start(t0);
      osc.stop(t0 + dur + 0.02);
      gritOsc.stop(t0 + dur + 0.02);
    }
  }

  /** Calm cloudy/breezy daytime bird (মেঘলা আকাশে শান্ত দূরবর্তী পাখির ডাক) */
  private playCloudyDayBird(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const base = 1480 + Math.random() * 380;

    for (let s = 0; s < 2; s++) {
      const t0 = now + s * 0.22;
      const dur = 0.14;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base * (s === 0 ? 1.12 : 0.98), t0);
      osc.frequency.exponentialRampToValueAtTime(base * (s === 0 ? 0.92 : 0.78), t0 + dur);

      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.036, t0 + 0.03);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(env);
      env.connect(this.weatherNatureBus);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }
  }

  /** Misty/cool morning flute-like bird (কুয়াশা বা শীতের ভোরের ডাহুক/ফিঙে) */
  private playMistyDawnBird(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const f = 1320 + Math.random() * 260;

    for (let i = 0; i < 2; i++) {
      const t0 = now + i * 0.34;
      const dur = 0.2;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t0);
      osc.frequency.exponentialRampToValueAtTime(f * (i === 0 ? 1.24 : 1.06), t0 + dur);

      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.032, t0 + 0.045);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(env);
      env.connect(this.weatherNatureBus);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }
  }

  /** Sheltered sparrow peep during gentle daytime rain (বৃষ্টিতে চড়ুইয়ের মৃদু ডাক) */
  private playRainShelteredSparrow(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const t0 = now + i * 0.14;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(2850, t0);
      osc.frequency.exponentialRampToValueAtTime(3400, t0 + 0.045);

      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.026, t0 + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.055);

      osc.connect(env);
      env.connect(this.weatherNatureBus);
      osc.start(t0);
      osc.stop(t0 + 0.07);
    }
  }

  /** Realistic Monsoon Frogs during rain / rainy nights (বর্ষা ও বৃষ্টির দিনে ব্যাঙের ডাক: ঘ্যাঙর-ঘ্যাঙ ও কট-কট-কট) */
  private playRainFrogChorus(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;

    if (Math.random() < 0.62) {
      // Deep resonant Indian bullfrog / monsoon toad ("ঘ্যাঙ... ঘ্যাঙর-ঘ্যাঙ")
      const croaks = 2 + (Math.random() < 0.45 ? 1 : 0);
      const baseF = 165 + Math.random() * 48;

      for (let c = 0; c < croaks; c++) {
        const t0 = now + c * (0.42 + Math.random() * 0.14);
        const dur = 0.24 + Math.random() * 0.11;

        const osc = ctx.createOscillator();
        const mod = ctx.createOscillator();
        const modGain = ctx.createGain();
        const f1 = ctx.createBiquadFilter();
        const f2 = ctx.createBiquadFilter();
        const env = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(baseF * 0.94, t0);
        osc.frequency.linearRampToValueAtTime(baseF * 1.12, t0 + dur * 0.45);
        osc.frequency.exponentialRampToValueAtTime(baseF * 0.88, t0 + dur);

        // Throat-sac guttural pulse modulation (~36-46 Hz)
        mod.type = 'sine';
        mod.frequency.value = 36 + Math.random() * 12;
        modGain.gain.value = 38;
        mod.connect(modGain);
        modGain.connect(osc.frequency);

        // Dual vocal-sac formants
        f1.type = 'bandpass';
        f1.frequency.value = 430 + Math.random() * 70;
        f1.Q.value = 3.2;

        f2.type = 'bandpass';
        f2.frequency.value = 980 + Math.random() * 140;
        f2.Q.value = 2.8;

        env.gain.setValueAtTime(0.0001, t0);
        env.gain.linearRampToValueAtTime(0.052, t0 + 0.035);
        env.gain.setValueAtTime(0.044, t0 + dur * 0.72);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

        osc.connect(f1);
        osc.connect(f2);
        f1.connect(env);
        f2.connect(env);
        env.connect(this.weatherNatureBus);

        osc.start(t0);
        mod.start(t0);
        osc.stop(t0 + dur + 0.02);
        mod.stop(t0 + dur + 0.02);
      }
    } else {
      // Quick rhythmic paddy/tree frog staccato clicks ("কট-কট-কট-কট")
      const clicks = 4 + Math.floor(Math.random() * 3);
      const pitch = 760 + Math.random() * 240;

      for (let k = 0; k < clicks; k++) {
        const t0 = now + k * (0.085 + Math.random() * 0.02);
        const dur = 0.042;

        const osc = ctx.createOscillator();
        const bp = ctx.createBiquadFilter();
        const env = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(pitch * 1.15, t0);
        osc.frequency.exponentialRampToValueAtTime(pitch * 0.78, t0 + dur);

        bp.type = 'bandpass';
        bp.frequency.value = pitch * 1.2;
        bp.Q.value = 3.5;

        env.gain.setValueAtTime(0.0001, t0);
        env.gain.linearRampToValueAtTime(0.038, t0 + 0.008);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

        osc.connect(bp);
        bp.connect(env);
        env.connect(this.weatherNatureBus);

        osc.start(t0);
        osc.stop(t0 + dur + 0.015);
      }
    }
  }

  /** Localized Wind Gust Leaf-Rustle Swell (দমকা বাতাসে গাছের পাতার সরসর শব্দ) */
  private playWindGustRustle(ctx: AudioContext, strength = 1.0): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const dur = 1.9 + Math.random() * 1.1;
    const bufLen = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(2, bufLen, ctx.sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let prev = 0;
      for (let i = 0; i < bufLen; i++) {
        const w = Math.random() * 2 - 1;
        prev = prev * 0.78 + w * 0.22;
        d[i] = prev;
      }
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(420, now);
    bp.frequency.linearRampToValueAtTime(980 + strength * 260, now + dur * 0.42);
    bp.frequency.exponentialRampToValueAtTime(360, now + dur);
    bp.Q.value = 0.85;

    const env = ctx.createGain();
    const peak = Math.min(0.065, 0.028 * strength);
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(peak, now + dur * 0.38);
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(bp);
    bp.connect(env);
    env.connect(this.weatherNatureBus);
    src.start(now);
    src.stop(now + dur + 0.05);
  }

  private playNightCricketChirp(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const pulses = 4 + Math.floor(Math.random() * 3);
    const carrierFreq = (this.weatherTempC >= 26 ? 4150 : 3750) + Math.random() * 320;

    for (let p = 0; p < pulses; p++) {
      const t0 = now + p * 0.048;
      const dur = 0.032;
      const osc = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      const env = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(carrierFreq, t0);
      lp.type = 'lowpass';
      lp.frequency.value = 4600;

      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.024, t0 + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(lp);
      lp.connect(env);
      env.connect(this.weatherNatureBus);
      osc.start(t0);
      osc.stop(t0 + dur + 0.01);
    }

    // Rare peaceful distant owl hoot on calm nights
    if (Math.random() < 0.09) {
      const hStart = now + 0.45;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(365, hStart);
      osc.frequency.exponentialRampToValueAtTime(325, hStart + 0.42);
      env.gain.setValueAtTime(0.0001, hStart);
      env.gain.linearRampToValueAtTime(0.03, hStart + 0.08);
      env.gain.exponentialRampToValueAtTime(0.0001, hStart + 0.45);
      osc.connect(env);
      env.connect(this.weatherNatureBus);
      osc.start(hStart);
      osc.stop(hStart + 0.48);
    }
  }

  private scheduleNatureLoop(): void {
    if (this.natureTimer !== null) {
      window.clearTimeout(this.natureTimer);
      this.natureTimer = null;
    }
    if (this.sceneMode !== 'weather') return;

    const isExcessiveHeat = this.weatherIsDay && this.weatherTempC >= 30.5;
    const isHotSun =
      this.weatherIsDay &&
      (this.weatherTempC >= 28.5 || (this.weatherTempC >= 26.5 && this.sunProgress > 0.3 && this.sunProgress < 0.72));
    const isRainOrStorm = this.currentMood === 'rain' || this.currentMood === 'storm';

    const nextDelay = isRainOrStorm
      ? 2400 + Math.random() * 2600
      : this.weatherIsDay
        ? isHotSun
          ? 3200 + Math.random() * 3200
          : this.currentMood === 'clear_day'
            ? 2300 + Math.random() * 2400
            : 3400 + Math.random() * 3200
        : 1500 + Math.random() * 2200;

    this.natureTimer = window.setTimeout(() => {
      if (this.sceneMode !== 'weather') return;
      const ctx = this.ctx;
      if (ctx && ctx.state === 'running') {
        // Trigger localized gust leaf-rustle swell when breezy/windy
        if ((this.weatherWindKmh >= 11 || this.currentMood === 'storm') && Math.random() < 0.42) {
          this.playWindGustRustle(ctx, Math.min(1.8, Math.max(0.7, this.weatherWindKmh / 14)));
        }

        if (isRainOrStorm) {
          // Frogs croak lively during monsoon rain & stormy evenings/nights, with occasional sheltered sparrow by day
          if (this.weatherIsDay && this.currentMood === 'rain' && Math.random() < 0.28) {
            this.playRainShelteredSparrow(ctx);
          } else {
            this.playRainFrogChorus(ctx);
          }
        } else if (this.weatherIsDay) {
          if (this.currentMood === 'fog' || this.weatherTempC <= 19) {
            this.playMistyDawnBird(ctx);
          } else if (isExcessiveHeat) {
            if (Math.random() < 0.65) {
              this.playHotCrowCaw(ctx);
            } else {
              this.playHotMiddayCuckooOrDove(ctx);
            }
          } else if (isHotSun) {
            if (Math.random() < 0.3) {
              this.playHotCrowCaw(ctx);
            } else {
              this.playHotMiddayCuckooOrDove(ctx);
            }
          } else if (this.currentMood === 'cloudy') {
            this.playCloudyDayBird(ctx);
          } else if (this.currentMood === 'clear_day') {
            this.playMorningSongbird(ctx);
          }
        } else {
          // Calm/cloudy/foggy night: crickets + rare owl + humid post-rain frog
          if (this.weatherTempC >= 22 && Math.random() < 0.16) {
            this.playRainFrogChorus(ctx);
          } else {
            this.playNightCricketChirp(ctx);
          }
        }
      }
      this.scheduleNatureLoop();
    }, nextDelay);
  }

  private applySceneAudioState(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    if (this.rainGroupGain) {
      const stormActive = this.sceneMode === 'storm' && !this.isRainMuted;
      this.rainGroupGain.gain.setTargetAtTime(stormActive ? 1.0 : 0, now, 0.2);
    }

    if (this.weatherGroupGain) {
      const weatherActive = this.sceneMode === 'weather';
      this.weatherGroupGain.gain.setTargetAtTime(weatherActive ? 1.0 : 0, now, 0.25);
    }

    if (this.weatherBreezeGain && this.weatherBreezeFilter) {
      const windNorm = Math.max(0.25, Math.min(1.6, this.weatherWindKmh / 12));
      const baseBreeze =
        this.currentMood === 'fog'
          ? 0.08
          : this.currentMood === 'clear_night'
            ? 0.09
            : this.currentMood === 'storm'
              ? 0.22
              : 0.13;
      this.weatherBreezeGain.gain.setTargetAtTime(baseBreeze * windNorm, now, 0.4);
      this.weatherBreezeFilter.frequency.setTargetAtTime(300 + windNorm * 220, now, 0.4);
    }

    if (this.weatherRainGain) {
      const weatherRainLevel =
        this.sceneMode === 'weather'
          ? this.currentMood === 'storm'
            ? 0.24
            : this.currentMood === 'rain'
              ? 0.19
              : 0
          : 0;
      this.weatherRainGain.gain.setTargetAtTime(weatherRainLevel, now, 0.35);
    }

    if (this.sceneMode === 'weather') {
      if (this.natureTimer === null) this.scheduleNatureLoop();
    } else if (this.natureTimer !== null) {
      window.clearTimeout(this.natureTimer);
      this.natureTimer = null;
    }
  }

  public unlockAndStart(mood: WeatherMood = 'rain'): boolean {
    this.currentMood = mood;
    const ctx = this.ensureContext();
    if (!ctx) return false;
    this.setWeatherMood(mood);
    this.buildRainGraph(ctx);
    this.buildWeatherGraph(ctx);
    this.applySceneAudioState();
    return ctx.state === 'running';
  }

  public setSceneMode(
    scene: SceneAudioMode,
    options?: {
      weatherMood?: WeatherMood;
      isDay?: boolean;
      windKmh?: number | null;
      temperatureC?: number | null;
      sunProgress?: number;
    }
  ): void {
    this.sceneMode = scene;
    if (options?.weatherMood) this.currentMood = options.weatherMood;
    if (typeof options?.isDay === 'boolean') this.weatherIsDay = options.isDay;
    if (typeof options?.windKmh === 'number') this.weatherWindKmh = options.windKmh;
    if (typeof options?.temperatureC === 'number') this.weatherTempC = options.temperatureC;
    if (typeof options?.sunProgress === 'number') this.sunProgress = options.sunProgress;

    this.isRainMuted = scene !== 'storm';
    if (this.ctx) {
      this.buildRainGraph(this.ctx);
      this.buildWeatherGraph(this.ctx);
      this.setWeatherMood(this.currentMood);
      this.applySceneAudioState();
    }
  }

  public setWeatherMood(mood: WeatherMood): void {
    this.currentMood = mood;
    if (!this.rainMoodGain || !this.ctx) return;
    this.rainMoodGain.gain.setTargetAtTime(this.moodToGain(mood), this.ctx.currentTime, 0.35);
    this.applySceneAudioState();
  }

  /**
   * Controls whether the default storm-video rain & thunder bus is muted
   */
  public setRainMuted(muted: boolean): void {
    this.isRainMuted = muted;
    this.applySceneAudioState();
  }

  /**
   * Soft, gentle rolling cloud thunder rumble synced with lightning flash (মৃদু মৃদু মেঘের গর্জন)
   */
  public triggerThunder(intensity = 1.0, targetBus: 'storm' | 'weather' = 'storm'): void {
    if (targetBus === 'storm' && (this.isRainMuted || this.sceneMode !== 'storm')) return;
    if (targetBus === 'weather' && this.sceneMode !== 'weather') return;
    const ctx = this.ensureContext();
    const bus = targetBus === 'weather' ? this.weatherNatureBus : this.thunderBus;
    if (!ctx || !bus || ctx.state !== 'running') return;

    const startAt = ctx.currentTime;
    const duration = 4.5;

    // Gentle, deep rolling cloud thunder buffer (smooth brown-filtered clouds, zero sharp static snap)
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const thunderBuffer = ctx.createBuffer(2, bufferSize, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = thunderBuffer.getChannelData(ch);
      let lastOut = 0;
      let smoothOut = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        lastOut = (lastOut + 0.055 * white) / 1.055;
        smoothOut = smoothOut * 0.7 + lastOut * 0.3;
        data[i] = Math.max(-1, Math.min(1, smoothOut * 6.5));
      }
    }

    const src = ctx.createBufferSource();
    src.buffer = thunderBuffer;

    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.setValueAtTime(280, startAt);
    rumbleFilter.frequency.exponentialRampToValueAtTime(75, startAt + duration);

    // Gentle echoing rolling contour: soft cloud swell -> rolling valleys -> fading distant murmur
    const env = ctx.createGain();
    const peak = Math.min(0.82, 0.72 * intensity);
    env.gain.setValueAtTime(0.01, startAt);
    env.gain.linearRampToValueAtTime(peak, startAt + 0.09);
    env.gain.exponentialRampToValueAtTime(peak * 0.45, startAt + 0.65);
    env.gain.linearRampToValueAtTime(peak * 0.72, startAt + 1.15);
    env.gain.exponentialRampToValueAtTime(peak * 0.28, startAt + 2.05);
    env.gain.linearRampToValueAtTime(peak * 0.42, startAt + 2.55);
    env.gain.exponentialRampToValueAtTime(0.001, startAt + duration);

    src.connect(rumbleFilter);
    rumbleFilter.connect(env);
    env.connect(bus);

    src.start(startAt);
    src.stop(startAt + duration);
  }

  /**
   * Mild, soft rocket launch whoosh in Birthday Mode
   */
  public triggerFireworkLaunch(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.birthdayBus || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    const dur = 0.42;

    const noiseSize = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, noiseSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < noiseSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(520, now);
    bp.frequency.exponentialRampToValueAtTime(1650, now + dur);
    bp.Q.value = 3.5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(bp);
    bp.connect(gain);
    gain.connect(this.birthdayBus);

    src.start(now);
    src.stop(now + dur);
  }

  /**
   * Mild, pleasant sky firework bloom & soft crackles in Birthday Mode
   */
  public triggerFireworkBurst(intensity = 1.0): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.birthdayBus || ctx.state !== 'running') return;

    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.24);

    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.38 * intensity, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(thumpGain);
    thumpGain.connect(this.birthdayBus);
    osc.start(now);
    osc.stop(now + 0.3);

    const blastDur = 0.5;
    const blastBuf = ctx.createBuffer(2, Math.floor(ctx.sampleRate * blastDur), ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = blastBuf.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.12));
      }
    }
    const blastSrc = ctx.createBufferSource();
    blastSrc.buffer = blastBuf;

    const blastFilter = ctx.createBiquadFilter();
    blastFilter.type = 'lowpass';
    blastFilter.frequency.setValueAtTime(920, now);
    blastFilter.frequency.exponentialRampToValueAtTime(180, now + blastDur);

    const blastGain = ctx.createGain();
    blastGain.gain.setValueAtTime(0.4 * intensity, now);
    blastGain.gain.exponentialRampToValueAtTime(0.001, now + blastDur);

    blastSrc.connect(blastFilter);
    blastFilter.connect(blastGain);
    blastGain.connect(this.birthdayBus);
    blastSrc.start(now);

    const crackleCount = 5;
    for (let k = 0; k < crackleCount; k++) {
      const delay = 0.08 + k * 0.075 + Math.random() * 0.04;
      const t = now + delay;
      const cLen = Math.floor(ctx.sampleRate * 0.045);
      const cBuf = ctx.createBuffer(1, cLen, ctx.sampleRate);
      const cData = cBuf.getChannelData(0);
      for (let i = 0; i < cLen; i++) {
        cData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.01));
      }
      const cSrc = ctx.createBufferSource();
      cSrc.buffer = cBuf;

      const cFilter = ctx.createBiquadFilter();
      cFilter.type = 'bandpass';
      cFilter.frequency.value = 1800 + Math.random() * 1100;
      cFilter.Q.value = 1.5;

      const cGain = ctx.createGain();
      cGain.gain.setValueAtTime((0.14 - k * 0.015) * intensity, t);
      cGain.gain.exponentialRampToValueAtTime(0.001, t + 0.042);

      cSrc.connect(cFilter);
      cFilter.connect(cGain);
      cGain.connect(this.birthdayBus);
      cSrc.start(t);
    }
  }

  /**
   * Loud, warm foreground melody note played through the shared unlocked AudioContext
   */
  public playMusicNote(freq: number, warmPad = false): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.musicBus || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    const dur = warmPad ? 1.85 : 1.4;

    const mainOsc = ctx.createOscillator();
    const overtoneOsc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const noteGain = ctx.createGain();

    mainOsc.type = 'triangle';
    mainOsc.frequency.setValueAtTime(freq, now);

    overtoneOsc.type = 'sine';
    overtoneOsc.frequency.setValueAtTime(freq * 2, now);

    const overtoneGain = ctx.createGain();
    overtoneGain.gain.value = 0.25;

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2400, now);
    filter.frequency.exponentialRampToValueAtTime(750, now + dur);

    noteGain.gain.setValueAtTime(0.0005, now);
    noteGain.gain.linearRampToValueAtTime(0.34, now + 0.025);
    noteGain.gain.exponentialRampToValueAtTime(0.0005, now + dur);

    mainOsc.connect(filter);
    overtoneOsc.connect(overtoneGain);
    overtoneGain.connect(filter);
    filter.connect(noteGain);
    noteGain.connect(this.musicBus);

    mainOsc.start(now);
    overtoneOsc.start(now);
    mainOsc.stop(now + dur + 0.05);
    overtoneOsc.stop(now + dur + 0.05);
  }
}

export const stormAudio = new StormAudioEngine();
