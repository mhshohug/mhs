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
  private isThunderMuted = false;
  private sceneMode: SceneAudioMode = 'storm';
  private currentMood: WeatherMood = 'rain';
  private weatherIsDay = true;
  private weatherWindKmh = 8;
  private weatherTempC = 25;
  private sunProgress = 0.5;
  private weatherRainIntensity = 0;
  private weatherHasThunder = false;
  private natureTimer: number | null = null;
  private thunderTimer: number | null = null;
  private lastThunderAt = 0;
  private thunderDeck: number[] = [];
  private lastThunderArchetype = -1;
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

  public setRainMuted(muted: boolean): void {
    this.isRainMuted = muted;
    this.ensureContext();
    this.applySceneAudioState();
  }

  public getRainMuted(): boolean {
    return this.isRainMuted;
  }

  public setThunderMuted(muted: boolean): void {
    this.isThunderMuted = muted;
    const ctx = this.ensureContext();
    this.applySceneAudioState();
    if (!muted && ctx) {
      const canThunder =
        this.sceneMode === 'storm' ||
        (this.sceneMode === 'weather' && this.weatherHasThunder);
      if (canThunder) {
        window.setTimeout(() => {
          this.triggerThunder(
            this.sceneMode === 'weather' ? Math.max(0.65, this.weatherRainIntensity) : 0.98,
            'immediate'
          );
        }, 80);
      }
    }
  }

  public getThunderMuted(): boolean {
    return this.isThunderMuted;
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
      this.thunderBus.gain.value = this.isThunderMuted ? 0 : 1.28;

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
      this.rainGroupGain.connect(this.masterGain);
      // Connect thunderBus directly to masterGain so rain & thunder mute states are 100% independent
      this.thunderBus.connect(this.masterGain);

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

    // 1. Silky, airy drizzle curtain on leaves (smooth stereo pink/brown wash without harsh hiss or mud)
    const washLen = sampleRate * 6;
    const washBuf = ctx.createBuffer(2, washLen, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = washBuf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, smooth = 0;
      for (let i = 0; i < washLen; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.996 * b0 + white * 0.025;
        b1 = 0.978 * b1 + white * 0.032;
        b2 = 0.920 * b2 + white * 0.048;
        const pink = b0 + b1 + b2 + white * 0.022;
        smooth = smooth * 0.52 + pink * 0.48;
        data[i] = Math.max(-0.85, Math.min(0.85, smooth * 0.95));
      }
    }

    const drizzleWashSrc = ctx.createBufferSource();
    drizzleWashSrc.buffer = washBuf;
    drizzleWashSrc.loop = true;

    const drizzleHighpass = ctx.createBiquadFilter();
    drizzleHighpass.type = 'highpass';
    drizzleHighpass.frequency.value = 280;

    const drizzleFilter = ctx.createBiquadFilter();
    drizzleFilter.type = 'lowpass';
    drizzleFilter.frequency.value = 2100;

    const drizzleWashGain = ctx.createGain();
    drizzleWashGain.gain.value = 0.44;

    drizzleWashSrc.connect(drizzleHighpass);
    drizzleHighpass.connect(drizzleFilter);
    drizzleFilter.connect(drizzleWashGain);
    drizzleWashGain.connect(this.rainMoodGain);
    drizzleWashSrc.start();

    // 2. Delicate micro-patter of raindrops hitting leaves (brief filtered noise taps, NO pitched bubble blops)
    const dropLen = sampleRate * 6;
    const dropBuf = ctx.createBuffer(2, dropLen, sampleRate);
    const numDroplets = 620;
    for (let d = 0; d < numDroplets; d++) {
      const ch = d % 2;
      const data = dropBuf.getChannelData(ch);
      const startSample = Math.floor(Math.random() * (dropLen - sampleRate * 0.02));
      const tapLen = Math.floor(sampleRate * (0.0018 + Math.random() * 0.0032));
      const amp = 0.06 + Math.random() * 0.14;
      let prev = 0;
      for (let j = 0; j < tapLen && startSample + j < dropLen; j++) {
        const t = j / sampleRate;
        const env = Math.exp(-t / 0.0011);
        const raw = Math.random() * 2 - 1;
        // Soft leaf-tap impulse without sinusoidal bubble pitch
        prev = prev * 0.45 + raw * 0.55;
        data[startSample + j] += prev * env * amp;
      }
    }

    const dropSrc = ctx.createBufferSource();
    dropSrc.buffer = dropBuf;
    dropSrc.loop = true;

    const dropBand = ctx.createBiquadFilter();
    dropBand.type = 'bandpass';
    dropBand.frequency.value = 1850;
    dropBand.Q.value = 0.65;

    const dropGain = ctx.createGain();
    dropGain.gain.value = 0.42;

    dropSrc.connect(dropBand);
    dropBand.connect(dropGain);
    dropGain.connect(this.rainMoodGain);
    dropSrc.start();

    // Feed soft drizzle + leaf droplets into Weather Mode live-rain bus too
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

  public unlockAndStart(mood: WeatherMood = 'rain'): void {
    this.currentMood = mood;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    if (!this.isRainGraphBuilt) this.buildRainGraph(ctx);
    if (!this.isWeatherGraphBuilt) this.buildWeatherGraph(ctx);
    this.applySceneAudioState();
  }

  public setSceneMode(
    mode: SceneAudioMode,
    opts?: {
      weatherMood?: WeatherMood;
      isDay?: boolean;
      windKmh?: number | null;
      temperatureC?: number | null;
      sunProgress?: number | null;
      rainIntensity?: number;
      hasThunder?: boolean;
    }
  ): void {
    this.sceneMode = mode;
    if (opts) {
      if (opts.weatherMood) this.currentMood = opts.weatherMood;
      if (typeof opts.isDay === 'boolean') this.weatherIsDay = opts.isDay;
      if (typeof opts.windKmh === 'number') this.weatherWindKmh = opts.windKmh;
      if (typeof opts.temperatureC === 'number') this.weatherTempC = opts.temperatureC;
      if (typeof opts.sunProgress === 'number') this.sunProgress = opts.sunProgress;
      if (typeof opts.rainIntensity === 'number') this.weatherRainIntensity = opts.rainIntensity;
      if (typeof opts.hasThunder === 'boolean') this.weatherHasThunder = opts.hasThunder;
    }
    const ctx = this.ensureContext();
    if (ctx) {
      if (!this.isRainGraphBuilt) this.buildRainGraph(ctx);
      if (!this.isWeatherGraphBuilt) this.buildWeatherGraph(ctx);
      this.applySceneAudioState();
      if (mode === 'weather') {
        this.scheduleNatureLoop();
      }
    }
  }

  private nextThunderArchetypeIdx(variant?: string): number {
    // Distant / audio-only rumbles favor richer rolling/distant archetypes, still varied via shuffle
    if (variant === 'distant') {
      const distantPool = [2, 4, 6, 7, 9];
      const filtered = distantPool.filter((id) => id !== this.lastThunderArchetype);
      const pick = filtered[Math.floor(Math.random() * filtered.length)] ?? 7;
      this.lastThunderArchetype = pick;
      return pick;
    }

    if (this.thunderDeck.length === 0) {
      const fresh = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      for (let i = fresh.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = fresh[i];
        fresh[i] = fresh[j];
        fresh[j] = tmp;
      }
      // Guarantee no consecutive repeat across deck boundaries
      if (fresh[0] === this.lastThunderArchetype) {
        const swapIdx = 1 + Math.floor(Math.random() * (fresh.length - 1));
        const tmp = fresh[0];
        fresh[0] = fresh[swapIdx];
        fresh[swapIdx] = tmp;
      }
      this.thunderDeck = fresh;
    }

    const idx = this.thunderDeck.shift()!;
    this.lastThunderArchetype = idx;
    return idx;
  }

  public triggerThunder(intensity = 1.0, variant?: string): void {
    const ctx = this.ensureContext();
    const isMuted = this.sceneMode === 'storm' && this.isThunderMuted;
    if (!ctx || ctx.state !== 'running' || isMuted) return;

    const nowMs = Date.now();
    if (variant !== 'immediate' && nowMs - this.lastThunderAt < 2600) {
      return;
    }
    this.lastThunderAt = nowMs;

    const now = ctx.currentTime;
    const archetypes = [
      'close_deep_clap',        // 0: Firm, warm close "গুমম..." + echoing rolls (no sharp snap)
      'double_gum_slam',        // 1: Classic distinct "গুম... গুম!" double collision
      'triple_sky_roll',        // 2: Three clear rolling impacts panning across the sky
      'staggered_cloud_bump',   // 3: Natural uneven "গুম-গুম... গুম!" cluster
      'canyon_echo_cascade',    // 4: Long cascading horizon echoes
      'lone_warm_boom',         // 5: Single clean, calm mid-distance "গুরুম..." + echo
      'gathering_storm_swell',  // 6: Quiet build-up peaking into a broad cloud swell
      'distant_horizon_mutter', // 7: Far-off soft rolling mutter
      'wide_cloud_sweep',       // 8: Broad stereo sweep across cloud layers
      'rolling_monsoon_rumble', // 9: Continuous undulating monsoon "গুরুম-গুরুম..."
    ] as const;

    const styleIdx = this.nextThunderArchetypeIdx(variant);
    const style = archetypes[styleIdx];

    const jitter = () => (Math.random() - 0.5) * 0.16;

    let dur = 5.6;
    let impactTimes: number[] = [0.08, 1.25];
    let impactStrengths: number[] = [1.0, 0.8];
    let attackSec = 0.11;
    let decayScale = 0.72;
    let startCutoff = 680;
    let midCutoff = 320;
    let endCutoff = 185;
    let echoDelaySec = 0.14;
    let echoGainAmount = 0.24;

    switch (style) {
      case 'close_deep_clap':
        dur = 5.5 + Math.random() * 1.5;
        impactTimes = [0.05, 0.72 + Math.random() * 0.2, 1.85 + Math.random() * 0.35, 3.1 + Math.random() * 0.4];
        impactStrengths = [1.05, 0.88, 0.58, 0.34];
        attackSec = 0.085;
        decayScale = 0.68;
        startCutoff = 780 + Math.random() * 110;
        midCutoff = 350;
        endCutoff = 195;
        echoDelaySec = 0.11;
        echoGainAmount = 0.26;
        break;
      case 'double_gum_slam':
        dur = 5.0 + Math.random() * 1.4;
        impactTimes = [0.08, 1.28 + Math.random() * 0.38, 2.75 + Math.random() * 0.35];
        impactStrengths = [1.0, 0.96, 0.36];
        attackSec = 0.11;
        decayScale = 0.58;
        startCutoff = 690 + Math.random() * 100;
        midCutoff = 330;
        endCutoff = 185;
        echoDelaySec = 0.13;
        echoGainAmount = 0.24;
        break;
      case 'triple_sky_roll':
        dur = 6.2 + Math.random() * 1.6;
        impactTimes = [0.09, 0.95 + jitter(), 2.05 + jitter(), 3.35 + Math.random() * 0.3];
        impactStrengths = [0.95, 0.84, 0.72, 0.42];
        attackSec = 0.12;
        decayScale = 0.66;
        startCutoff = 710 + Math.random() * 110;
        midCutoff = 340;
        endCutoff = 190;
        echoDelaySec = 0.15;
        echoGainAmount = 0.25;
        break;
      case 'staggered_cloud_bump':
        dur = 5.4 + Math.random() * 1.5;
        impactTimes = [0.06, 0.54 + Math.random() * 0.14, 1.55 + Math.random() * 0.25, 2.7 + Math.random() * 0.3];
        impactStrengths = [0.82, 1.02, 0.76, 0.44];
        attackSec = 0.095;
        decayScale = 0.56;
        startCutoff = 740 + Math.random() * 100;
        midCutoff = 345;
        endCutoff = 195;
        echoDelaySec = 0.12;
        echoGainAmount = 0.26;
        break;
      case 'canyon_echo_cascade':
        dur = 7.6 + Math.random() * 2.0;
        impactTimes = [0.08, 0.95 + jitter(), 1.98 + jitter(), 3.15 + jitter(), 4.5 + jitter()];
        impactStrengths = [0.98, 0.78, 0.66, 0.5, 0.34];
        attackSec = 0.115;
        decayScale = 0.74;
        startCutoff = 660 + Math.random() * 90;
        midCutoff = 315;
        endCutoff = 180;
        echoDelaySec = 0.18;
        echoGainAmount = 0.28;
        break;
      case 'lone_warm_boom':
        dur = 4.2 + Math.random() * 1.2;
        impactTimes = [0.1, 1.32 + Math.random() * 0.32];
        impactStrengths = [0.98, 0.54];
        attackSec = 0.11;
        decayScale = 0.6;
        startCutoff = 640 + Math.random() * 90;
        midCutoff = 310;
        endCutoff = 180;
        echoDelaySec = 0.14;
        echoGainAmount = 0.22;
        break;
      case 'gathering_storm_swell':
        dur = 6.6 + Math.random() * 1.8;
        impactTimes = [0.18, 1.15 + Math.random() * 0.22, 2.35 + Math.random() * 0.3, 3.7 + Math.random() * 0.35];
        impactStrengths = [0.56, 0.98, 0.88, 0.44];
        attackSec = 0.2;
        decayScale = 0.82;
        startCutoff = 580 + Math.random() * 80;
        midCutoff = 300;
        endCutoff = 175;
        echoDelaySec = 0.17;
        echoGainAmount = 0.24;
        break;
      case 'distant_horizon_mutter':
        dur = 6.0 + Math.random() * 1.8;
        impactTimes = [0.24, 1.45 + Math.random() * 0.32, 2.85 + Math.random() * 0.4, 4.25 + Math.random() * 0.35];
        impactStrengths = [0.72, 0.86, 0.62, 0.38];
        attackSec = 0.18;
        decayScale = 0.78;
        startCutoff = 540 + Math.random() * 80;
        midCutoff = 285;
        endCutoff = 170;
        echoDelaySec = 0.19;
        echoGainAmount = 0.22;
        break;
      case 'wide_cloud_sweep':
        dur = 6.4 + Math.random() * 1.6;
        impactTimes = [0.07, 0.85 + jitter(), 1.82 + jitter(), 3.05 + jitter()];
        impactStrengths = [0.9, 0.96, 0.78, 0.48];
        attackSec = 0.11;
        decayScale = 0.68;
        startCutoff = 720 + Math.random() * 100;
        midCutoff = 335;
        endCutoff = 190;
        echoDelaySec = 0.15;
        echoGainAmount = 0.26;
        break;
      case 'rolling_monsoon_rumble':
      default:
        dur = 6.8 + Math.random() * 1.8;
        impactTimes = [0.1, 0.95 + jitter(), 1.9 + jitter(), 2.95 + jitter(), 4.15 + jitter()];
        impactStrengths = [0.84, 0.94, 0.82, 0.64, 0.4];
        attackSec = 0.14;
        decayScale = 0.74;
        startCutoff = 650 + Math.random() * 90;
        midCutoff = 315;
        endCutoff = 180;
        echoDelaySec = 0.16;
        echoGainAmount = 0.25;
        break;
    }

    const sr = ctx.sampleRate;
    const totalSamples = Math.floor(sr * dur);
    const bodyBuf = ctx.createBuffer(2, totalSamples, sr);

    // Build smooth, natural multi-octave atmospheric cloud rumble (no sharp clicks, no oscillators)
    for (let ch = 0; ch < 2; ch++) {
      const chData = bodyBuf.getChannelData(ch);
      let b0 = 0;
      let b1 = 0;
      let brown = 0;
      // Slow random-walk organic air-pocket turbulence (~6-14 Hz smoothed) instead of cyclic LFO or pops
      let turbRaw = 0;
      let turbSmooth = 0.85;
      let maxVal = 0.0001;
      const channelOffset = ch === 0 ? 0 : 0.022 + Math.random() * 0.028;

      for (let i = 0; i < totalSamples; i++) {
        const t = i / sr;
        const w = Math.random() * 2 - 1;

        // Warm atmospheric pink-brown spectrum
        brown = brown * 0.974 + w * 0.095;
        b0 = 0.988 * b0 + w * 0.068;
        b1 = 0.915 * b1 + w * 0.105;
        const textured = brown * 0.48 + b0 * 0.34 + b1 * 0.18;

        // Smooth natural rolling cloud turbulence ("গুরুম... গুরুম...")
        if ((i & 63) === 0) {
          turbRaw = 0.68 + Math.random() * 0.52;
        }
        turbSmooth = turbSmooth * 0.996 + turbRaw * 0.004;

        let envSum = 0;
        for (let k = 0; k < impactTimes.length; k++) {
          const dt = t - (impactTimes[k] + (k % 2 === 1 ? channelOffset : 0));
          if (dt >= 0) {
            // Rounded S-curve rise (eliminates any "ঠাস ঠুস" percussive pop)
            const rise = Math.min(1, dt / attackSec);
            const smoothAttack = rise * rise * (3 - 2 * rise);
            const tau = (0.42 + k * 0.18) * decayScale * (dur / 5.5);
            envSum += smoothAttack * Math.exp(-dt / tau) * impactStrengths[k];
          }
        }

        const val = textured * Math.min(1.25, envSum) * turbSmooth;
        chData[i] = val;
        const abs = Math.abs(val);
        if (abs > maxVal) maxVal = abs;
      }

      const normFactor = 0.9 / maxVal;
      for (let i = 0; i < totalSamples; i++) {
        chData[i] *= normFactor;
      }
    }

    const bodySrc = ctx.createBufferSource();
    bodySrc.buffer = bodyBuf;

    // 1. Cut heavy sub-bass (<82 Hz) so rumble isn't muddy/boomy and stays clear at modest volume
    const bodyHighpass = ctx.createBiquadFilter();
    bodyHighpass.type = 'highpass';
    bodyHighpass.frequency.value = 82;
    bodyHighpass.Q.value = 0.72;

    // 2. Natural air absorption sweep (warm, never harsh static hiss)
    const bodyLowpass = ctx.createBiquadFilter();
    bodyLowpass.type = 'lowpass';
    bodyLowpass.Q.value = 0.85;
    bodyLowpass.frequency.setValueAtTime(startCutoff, now);
    bodyLowpass.frequency.exponentialRampToValueAtTime(midCutoff, now + dur * 0.45);
    bodyLowpass.frequency.exponentialRampToValueAtTime(endCutoff, now + dur);

    // 3. Warm hollow "গুম গুম" cloud body zone (155-230 Hz) + mid readability (380-460 Hz)
    const gumBody = ctx.createBiquadFilter();
    gumBody.type = 'peaking';
    gumBody.frequency.value = 165 + Math.random() * 55;
    gumBody.Q.value = 0.9;
    gumBody.gain.value = 5.4;

    const midClarity = ctx.createBiquadFilter();
    midClarity.type = 'peaking';
    midClarity.frequency.value = 390 + Math.random() * 80;
    midClarity.Q.value = 0.85;
    midClarity.gain.value = 3.0;

    const bodyGain = ctx.createGain();
    const ampScale = Math.max(0.5, Math.min(1.25, intensity));
    const masterAmp = (variant === 'distant' ? 0.7 : 0.88) * ampScale;
    bodyGain.gain.setValueAtTime(0.001, now);
    bodyGain.gain.linearRampToValueAtTime(masterAmp, now + 0.06);
    bodyGain.gain.setValueAtTime(masterAmp, now + dur * 0.82);
    bodyGain.gain.exponentialRampToValueAtTime(0.0005, now + dur);

    const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    if (panner) {
      const startPan = (Math.random() - 0.5) * 0.7;
      panner.pan.setValueAtTime(startPan, now);
      panner.pan.linearRampToValueAtTime(-startPan * 0.65, now + dur * 0.78);
    }

    // 4. Soft acoustic sky-reflection path (delayed mid-band cloud hall echo for 3D depth)
    const echoDelay = ctx.createDelay(0.5);
    echoDelay.delayTime.value = echoDelaySec;
    const echoFilter = ctx.createBiquadFilter();
    echoFilter.type = 'bandpass';
    echoFilter.frequency.value = 280 + Math.random() * 90;
    echoFilter.Q.value = 0.6;
    const echoGain = ctx.createGain();
    echoGain.gain.value = echoGainAmount;

    bodySrc.connect(bodyHighpass);
    bodyHighpass.connect(bodyLowpass);
    bodyLowpass.connect(gumBody);
    gumBody.connect(midClarity);
    midClarity.connect(bodyGain);

    bodyGain.connect(echoDelay);
    echoDelay.connect(echoFilter);
    echoFilter.connect(echoGain);
    echoGain.connect(this.thunderBus ?? ctx.destination);

    if (panner) {
      bodyGain.connect(panner);
      panner.connect(this.thunderBus ?? ctx.destination);
    } else {
      bodyGain.connect(this.thunderBus ?? ctx.destination);
    }

    bodySrc.start(now);
    bodySrc.stop(now + dur + 0.35);
  }

  public triggerFireworkLaunch(): void {
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running' || !this.birthdayBus) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.45);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    osc.connect(gain);
    gain.connect(this.birthdayBus);
    osc.start(now);
    osc.stop(now + 0.52);
  }

  public triggerFireworkBurst(intensity = 1.0): void {
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running' || !this.birthdayBus) return;
    const now = ctx.currentTime;
    const bufferSize = ctx.sampleRate * 0.4;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1200;
    filter.Q.value = 1.0;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.18 * intensity, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.birthdayBus);

    noise.start(now);
    noise.stop(now + 0.4);
  }

  public playMusicNote(freqOrNote: number | string, isCalm = true): void {
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running' || !this.musicBus) return;
    const now = ctx.currentTime;
    const freq = typeof freqOrNote === 'number' ? freqOrNote : 440;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = isCalm ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(freq, now);

    filter.type = 'lowpass';
    filter.frequency.value = 2400;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(isCalm ? 0.12 : 0.18, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus);

    osc.start(now);
    osc.stop(now + 0.9);
  }


  private applySceneAudioState(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    if (this.rainGroupGain) {
      const stormRainActive = this.sceneMode === 'storm' && !this.isRainMuted;
      this.rainGroupGain.gain.setTargetAtTime(stormRainActive ? 1.0 : 0, now, 0.2);
    }

    const isThunderScene =
      this.sceneMode === 'storm' ||
      (this.sceneMode === 'weather' && this.weatherHasThunder);

    if (this.thunderBus) {
      const thunderAllowed =
        this.sceneMode === 'storm'
          ? !this.isThunderMuted
          : this.sceneMode === 'weather' && this.weatherHasThunder;
      const thunderGain = thunderAllowed ? 1.28 : 0;
      this.thunderBus.gain.setTargetAtTime(thunderGain, now, 0.2);
    }

    if (this.weatherGroupGain) {
      const weatherActive = this.sceneMode === 'weather';
      this.weatherGroupGain.gain.setTargetAtTime(weatherActive ? 1.0 : 0, now, 0.25);
    }

    if (this.weatherBreezeGain && this.weatherBreezeFilter) {
      const wKmh = Math.max(0, this.weatherWindKmh);
      const windNorm = wKmh < 6 ? 0 : Math.min(1.4, Math.pow((wKmh - 5) / 24, 1.15));
      const baseBreeze =
        this.currentMood === 'fog'
          ? 0.06
          : this.currentMood === 'clear_night'
            ? 0.08
            : this.currentMood === 'storm'
              ? 0.28
              : 0.16;
      const targetGain = wKmh < 6 ? 0.001 : baseBreeze * windNorm;
      this.weatherBreezeGain.gain.setTargetAtTime(targetGain, now, 0.4);
      this.weatherBreezeFilter.frequency.setTargetAtTime(260 + windNorm * 240, now, 0.4);
    }

    if (this.weatherRainGain) {
      const rInt = Math.max(0, Math.min(1, this.weatherRainIntensity));
      // Strictly automatic live rain intensity scaling: silent at 0, light drizzle ~0.06, moderate ~0.18, heavy storm ~0.31
      const weatherRainLevel =
        this.sceneMode === 'weather' && rInt > 0.01
          ? 0.025 + Math.pow(rInt, 1.35) * 0.285
          : 0;
      this.weatherRainGain.gain.setTargetAtTime(weatherRainLevel, now, 0.35);
    }

    if (this.sceneMode === 'weather') {
      if (this.natureTimer === null) this.scheduleNatureLoop();
    } else if (this.natureTimer !== null) {
      window.clearTimeout(this.natureTimer);
      this.natureTimer = null;
    }

    if (isThunderScene && (this.sceneMode === 'weather' || !this.isThunderMuted)) {
      if (this.thunderTimer === null) this.scheduleThunderLoop();
    } else if (this.thunderTimer !== null) {
      window.clearTimeout(this.thunderTimer);
      this.thunderTimer = null;
    }
  }

  private scheduleThunderLoop(): void {
    if (this.thunderTimer !== null) {
      window.clearTimeout(this.thunderTimer);
      this.thunderTimer = null;
    }
    const isThunderActive =
      (this.sceneMode === 'storm' && !this.isThunderMuted) ||
      (this.sceneMode === 'weather' && this.weatherHasThunder);

    if (!isThunderActive) return;

    const isWeatherStorm = this.sceneMode === 'weather' && this.currentMood === 'storm';
    const isWeatherHeavyRainOnly = this.sceneMode === 'weather' && this.currentMood !== 'storm';

    // Independent cloud rumbles (without lightning flashes) interleaved organically
    const delay = isWeatherHeavyRainOnly
      ? 14000 + Math.random() * 14000
      : 7200 + Math.random() * 7600;

    this.thunderTimer = window.setTimeout(() => {
      const activeNow =
        (this.sceneMode === 'storm' && !this.isThunderMuted) ||
        (this.sceneMode === 'weather' && this.weatherHasThunder);
      const minGapMs = isWeatherHeavyRainOnly ? 12000 : 5600;
      if (activeNow && Date.now() - this.lastThunderAt > minGapMs) {
        const ctx = this.ctx;
        if (ctx && ctx.state === 'running') {
          const isDistantStandalone = isWeatherHeavyRainOnly || (!isWeatherStorm && Math.random() < 0.45);
          const intensity = isWeatherHeavyRainOnly
            ? 0.52 + Math.random() * 0.25
            : 0.68 + Math.random() * 0.48;
          this.triggerThunder(intensity, isDistantStandalone ? 'distant' : undefined);
        }
      }
      this.scheduleThunderLoop();
    }, delay);
  }

  // Exquisite, authentic melodious procedural bird calls (Doyel, Kokil, Myna, Sparrow, Tuntuni)
  public playDoyelSong(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // Sweet liquid flute-like whistle phrases typical of the Oriental Magpie-Robin (দোয়েল)
    const notes = [1900, 2350, 2100, 2700, 2400];
    notes.forEach((freq, idx) => {
      const t0 = now + idx * 0.11;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.25, t0 + 0.05);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.95, t0 + 0.1);

      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.045, t0 + 0.02);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);

      osc.connect(env);
      env.connect(this.weatherNatureBus!);

      osc.start(t0);
      osc.stop(t0 + 0.13);
    });
  }

  public playKoelCall(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // Deep, resonant, hauntingly beautiful Asian Koel (কোকিল) dual-note call: "কুউ... কুউ..."
    for (let r = 0; r < 2; r++) {
      const t0 = now + r * 0.48;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(740, t0);
      osc.frequency.exponentialRampToValueAtTime(910, t0 + 0.28);

      filter.type = 'lowpass';
      filter.frequency.value = 1800;

      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.065, t0 + 0.08);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);

      osc.connect(filter);
      filter.connect(env);
      env.connect(this.weatherNatureBus!);

      osc.start(t0);
      osc.stop(t0 + 0.45);
    }
  }

  public playMynaSong(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // Cheerful, conversational rich warbles of the Common Myna (ময়না)
    const pitches = [1400, 1850, 1600, 2100, 1950];
    pitches.forEach((p, i) => {
      const t0 = now + i * 0.09;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(p, t0);
      osc.frequency.linearRampToValueAtTime(p * 1.12, t0 + 0.06);

      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.035, t0 + 0.015);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);

      osc.connect(env);
      env.connect(this.weatherNatureBus!);
      osc.start(t0);
      osc.stop(t0 + 0.09);
    });
  }

  public playSparrowChirp(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // Light, delicate, cheerful House Sparrow (চড়ুই) double chips: "চিক-চিক"
    for (let c = 0; c < 2; c++) {
      const t0 = now + c * 0.08;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(3400 + c * 180, t0);
      osc.frequency.exponentialRampToValueAtTime(3900, t0 + 0.04);

      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.028, t0 + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);

      osc.connect(env);
      env.connect(this.weatherNatureBus!);
      osc.start(t0);
      osc.stop(t0 + 0.07);
    }
  }

  public playTuntuniSong(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // Lively, bright, repeating rhythmic trill of the Common Tailorbird (টুনটুনি): "চিচিপ... চিচিপ..."
    for (let k = 0; k < 4; k++) {
      const t0 = now + k * 0.07;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'triangle';
      const f = k % 2 === 0 ? 2600 : 3100;
      osc.frequency.setValueAtTime(f, t0);
      osc.frequency.linearRampToValueAtTime(f * 1.08, t0 + 0.04);

      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.032, t0 + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);

      osc.connect(env);
      env.connect(this.weatherNatureBus!);
      osc.start(t0);
      osc.stop(t0 + 0.065);
    }
  }

  public playShalikMelody(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // Joyful conversational trill of the Shalik (শালিক)
    const notes = [1600, 1950, 1750, 2200];
    notes.forEach((f, i) => {
      const t0 = now + i * 0.12;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t0);
      osc.frequency.linearRampToValueAtTime(f * 1.14, t0 + 0.07);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.038, t0 + 0.02);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
      osc.connect(env);
      env.connect(this.weatherNatureBus!);
      osc.start(t0);
      osc.stop(t0 + 0.11);
    });
  }

  public playBulbulSong(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // Sweet, rhythmic, bubbly double-phrase song of the Bulbul (বুলবুলি)
    const pitches = [2100, 2500, 2300, 2800];
    pitches.forEach((p, idx) => {
      const t0 = now + idx * 0.09;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(p, t0);
      osc.frequency.exponentialRampToValueAtTime(p * 1.18, t0 + 0.05);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.04, t0 + 0.015);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
      osc.connect(env);
      env.connect(this.weatherNatureBus!);
      osc.start(t0);
      osc.stop(t0 + 0.085);
    });
  }

  public playDoveCall(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // Soft, soothing, low cooing call of the Spotted Dove (ঘুঘু)
    for (let d = 0; d < 3; d++) {
      const t0 = now + d * 0.35;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(420, t0);
      osc.frequency.exponentialRampToValueAtTime(460, t0 + 0.2);
      filter.type = 'lowpass';
      filter.frequency.value = 1200;
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.05, t0 + 0.06);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      osc.connect(filter);
      filter.connect(env);
      env.connect(this.weatherNatureBus!);
      osc.start(t0);
      osc.stop(t0 + 0.32);
    }
  }

  public playBabuiSong(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // Delicate, bright woven chirps of the Babui (বাবুই)
    const notes = [3100, 3500, 3300, 3800];
    notes.forEach((f, i) => {
      const t0 = now + i * 0.06;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t0);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.025, t0 + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
      osc.connect(env);
      env.connect(this.weatherNatureBus!);
      osc.start(t0);
      osc.stop(t0 + 0.055);
    });
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
    const isRainOrStorm =
      this.currentMood === 'rain' ||
      this.currentMood === 'storm' ||
      this.weatherRainIntensity > 0.05;

    const nextDelay = isRainOrStorm
      ? 2200 + Math.random() * 2400
      : this.weatherIsDay
        ? isHotSun
          ? 2800 + Math.random() * 2800
          : this.currentMood === 'clear_day'
            ? 2100 + Math.random() * 2200
            : 3000 + Math.random() * 3000
        : 1400 + Math.random() * 2000;

    this.natureTimer = window.setTimeout(() => {
      if (this.sceneMode !== 'weather') return;
      const ctx = this.ctx;
      if (ctx && ctx.state === 'running') {
        if ((this.weatherWindKmh >= 11 || this.currentMood === 'storm') && Math.random() < 0.42) {
          this.playWindGustRustle(ctx, Math.min(1.8, Math.max(0.7, this.weatherWindKmh / 14)));
        }

        if (isRainOrStorm) {
          if (this.weatherIsDay && this.currentMood === 'rain' && Math.random() < 0.28) {
            this.playRainShelteredSparrow(ctx);
          } else {
            this.playRainFrogChorus(ctx);
          }
        } else if (this.weatherIsDay) {
          const isHot = this.weatherTempC >= 31;
          const isColdOrFoggy = this.weatherTempC <= 19 || this.currentMood === 'fog';
          const r = Math.random();

          if (isHot) {
            // Hot summer: quieter, lazy calls like Koel and Dove
            if (r < 0.45) this.playKoelCall(ctx);
            else if (r < 0.8) this.playDoveCall(ctx);
            else this.playMynaSong(ctx);
          } else if (isColdOrFoggy) {
            // Winter / Foggy: quiet misty morning visitors (Dove, Sparrow, Tuntuni)
            if (r < 0.4) this.playDoveCall(ctx);
            else if (r < 0.7) this.playSparrowChirp(ctx);
            else this.playTuntuniSong(ctx);
          } else {
            // Normal pleasant weather: full active symphony of all 9 birds
            if (r < 0.12) this.playDoyelSong(ctx);      // দোয়েল
            else if (r < 0.24) this.playKoelCall(ctx);  // কোকিল
            else if (r < 0.36) this.playMynaSong(ctx);  // ময়না
            else if (r < 0.48) this.playSparrowChirp(ctx); // চড়ুই
            else if (r < 0.60) this.playTuntuniSong(ctx); // টুনটুনি
            else if (r < 0.72) this.playShalikMelody(ctx); // শালিক
            else if (r < 0.84) this.playBulbulSong(ctx); // বুলবুলি
            else if (r < 0.92) this.playDoveCall(ctx);  // ঘুঘু
            else this.playBabuiSong(ctx);              // বাবুই
          }
        } else {
          // Night time: crickets
          this.playNightCricketChirp(ctx);
        }
      }
      this.scheduleNatureLoop();
    }, nextDelay);
  }
}

export const stormAudio = new StormAudioEngine();


