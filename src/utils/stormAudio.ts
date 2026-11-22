import { SceneId } from '../data/sceneCatalog';
import { BengalSixSeason } from './bengaliCalendar';
import { WeatherMood } from './rajshahiWeather';

type UnlockListener = (unlocked: boolean) => void;

/**
 * Unified Web Audio Engine:
 * - Natural, non-harsh soft Rainfall (warm downpour wash + realistic discrete water droplets, NO harsh static hiss)
 * - Soft ambient Thunder synced with lightning (always softer than songs, always running on normal days)
 * - Mild/Gentle Birthday Firework sounds (always softer than birthday songs, always running in Birthday mode)
 * - Scene-strict, Bengali-season-aware natural ambience (melodious birds, water lapping, surf, cozy train/bus interior cabin)
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
  private seaSurfGain: GainNode | null = null;
  private seaSurfFilter: BiquadFilterNode | null = null;
  private cabinHumGain: GainNode | null = null;
  private cabinHumFilter: BiquadFilterNode | null = null;
  private weatherRainGain: GainNode | null = null;
  private rainFilterNode: BiquadFilterNode | null = null;
  private rainWashGainNode: GainNode | null = null;
  private rainDropGainNode: GainNode | null = null;
  private rainSteadyFoliageGain: GainNode | null = null;
  private rainHeavyBodyGain: GainNode | null = null;
  private rainGustSheetGain: GainNode | null = null;
  private dropletSplashPool: AudioBuffer[] = [];
  private weatherNatureBus: GainNode | null = null;
  private birthdayBus: GainNode | null = null;
  private musicBus: GainNode | null = null;

  private isRainGraphBuilt = false;
  private isWeatherGraphBuilt = false;
  private isRainMuted = false;
  private isThunderMuted = false;
  private sceneMode: SceneAudioMode = 'storm';
  private sceneId: SceneId = 'forest';
  private bengaliSeason: BengalSixSeason = 'hemonto';
  private currentMood: WeatherMood = 'rain';
  private weatherIsDay = true;
  private weatherWindKmh = 8;
  private weatherTempC = 25;
  private sunProgress = 0.5;
  private weatherRainIntensity = 0;
  private weatherHasThunder = false;
  private natureTimer: number | null = null;
  private thunderTimer: number | null = null;
  private rainDropletTimer: number | null = null;
  private lastThunderAt = 0;
  private thunderDeck: number[] = [];
  private lastThunderArchetype = -1;
  private lastNetSplashAt = 0;
  private lastRailClickAt = 0;
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

      this.seaSurfFilter = ctx.createBiquadFilter();
      this.seaSurfFilter.type = 'lowpass';
      this.seaSurfFilter.frequency.value = 480;
      this.seaSurfFilter.Q.value = 0.6;

      this.seaSurfGain = ctx.createGain();
      this.seaSurfGain.gain.value = 0;

      this.cabinHumFilter = ctx.createBiquadFilter();
      this.cabinHumFilter.type = 'lowpass';
      this.cabinHumFilter.frequency.value = 145;
      this.cabinHumFilter.Q.value = 0.7;

      this.cabinHumGain = ctx.createGain();
      this.cabinHumGain.gain.value = 0;

      this.weatherRainGain = ctx.createGain();
      this.weatherRainGain.gain.value = 0;

      this.weatherNatureBus = ctx.createGain();
      this.weatherNatureBus.gain.value = 0.75;

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
      this.seaSurfFilter.connect(this.seaSurfGain);
      this.seaSurfGain.connect(this.weatherGroupGain);
      this.cabinHumFilter.connect(this.cabinHumGain);
      this.cabinHumGain.connect(this.weatherGroupGain);
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

  /**
   * Paint realistic wet-leaf micro-splash impulses into a stereo AudioBuffer.
   * Uses band-shaped noise bursts (3–9ms) with Marshall-Palmer power-law drop distribution:
   * - ZERO periodic sine oscillators (eliminates "টক টক" wooden knocking completely)
   * - ZERO continuous broadband hiss (eliminates "ফশ ফশ" static hiss completely)
   */
  private paintLeafSplashes(
    buf: AudioBuffer,
    count: number,
    ampMin: number,
    ampMax: number,
    allowRustleTail: boolean
  ): void {
    const sampleRate = buf.sampleRate;
    const bufLen = buf.length;

    for (let d = 0; d < count; d++) {
      const ch = d % buf.numberOfChannels;
      const data = buf.getChannelData(ch);
      // Power-law Marshall-Palmer distribution: mostly tiny drops, fewer large heavy drops
      const size = Math.pow(Math.random(), 2.5);
      const durSec = 0.0032 + size * 0.0062;
      const tapSamples = Math.floor(sampleRate * durSec);
      const startSample = Math.floor(Math.random() * (bufLen - tapSamples - Math.floor(sampleRate * 0.025)));
      const amp = ampMin + (ampMax - ampMin) * (0.25 + size * 0.75);

      // Larger drops have softer warmer lowpass smoothing; fine mist drops are lightly crisper
      const alpha = 0.22 + (1 - size) * 0.34;
      const decaySec = 0.00075 + size * 0.0018;
      let lp = 0;
      let hp = 0;

      for (let j = 0; j < tapSamples && startSample + j < bufLen; j++) {
        const t = j / sampleRate;
        const white = Math.random() * 2 - 1;
        lp = lp * (1 - alpha) + white * alpha;
        hp = hp * 0.91 + lp * 0.09; // Gentle sub-bass removal -> crisp wet splash without thud
        const splash = lp - hp;
        const attack = Math.min(1, t / 0.00045);
        const env = attack * Math.exp(-t / decaySec);
        const nextVal = data[startSample + j] + splash * env * amp;
        data[startSample + j] = Math.max(-0.92, Math.min(0.92, nextVal));
      }

      // Soft gentle leaf-shiver rustle tail on ~18% of larger drops
      if (allowRustleTail && size > 0.72 && Math.random() < 0.22) {
        const tailSamples = Math.floor(sampleRate * 0.018);
        let tailLp = 0;
        let tailHp = 0;
        for (let k = 0; k < tailSamples && startSample + tapSamples + k < bufLen; k++) {
          const t = k / sampleRate;
          const white = Math.random() * 2 - 1;
          tailLp = tailLp * 0.86 + white * 0.14;
          tailHp = tailHp * 0.94 + tailLp * 0.06;
          const tailEnv = Math.exp(-t / 0.0065) * 0.16;
          const nextVal = data[startSample + tapSamples + k] + (tailLp - tailHp) * tailEnv * amp;
          data[startSample + tapSamples + k] = Math.max(-0.92, Math.min(0.92, nextVal));
        }
      }
    }
  }

  private buildRainGraph(ctx: AudioContext): void {
    if (this.isRainGraphBuilt || !this.rainMoodGain) return;
    this.isRainGraphBuilt = true;

    const sampleRate = ctx.sampleRate;

    // 1. Sparse quiet leaf-drizzle bed (for ঝিরি ঝিরি / গুঁড়ি গুঁড়ি বৃষ্টি - silent gaps between drops)
    const drizzleBuf = ctx.createBuffer(2, sampleRate * 7, sampleRate);
    this.paintLeafSplashes(drizzleBuf, 95, 0.30, 0.68, true);

    const drizzleSrc = ctx.createBufferSource();
    drizzleSrc.buffer = drizzleBuf;
    drizzleSrc.loop = true;

    const drizzleHp = ctx.createBiquadFilter();
    drizzleHp.type = 'highpass';
    drizzleHp.frequency.value = 340;

    const drizzleLp = ctx.createBiquadFilter();
    drizzleLp.type = 'lowpass';
    drizzleLp.frequency.value = 2300;
    drizzleLp.Q.value = 0.5;

    const dropGain = ctx.createGain();
    dropGain.gain.value = 0;
    this.rainDropGainNode = dropGain;

    drizzleSrc.connect(drizzleHp);
    drizzleHp.connect(drizzleLp);
    drizzleLp.connect(dropGain);
    dropGain.connect(this.rainMoodGain);
    drizzleSrc.start();

    // 2. Steady forest-canopy leaf patter (for হালকা থেকে মাঝারি বৃষ্টি - organic Marshall-Palmer texture)
    const steadyBuf = ctx.createBuffer(2, sampleRate * 7, sampleRate);
    this.paintLeafSplashes(steadyBuf, 3200, 0.20, 0.54, true);

    const steadySrc = ctx.createBufferSource();
    steadySrc.buffer = steadyBuf;
    steadySrc.loop = true;

    const steadyHp = ctx.createBiquadFilter();
    steadyHp.type = 'highpass';
    steadyHp.frequency.value = 280;

    const steadyLp = ctx.createBiquadFilter();
    steadyLp.type = 'lowpass';
    steadyLp.frequency.value = 2200;
    steadyLp.Q.value = 0.52;

    const steadyGain = ctx.createGain();
    steadyGain.gain.value = 0;
    this.rainSteadyFoliageGain = steadyGain;

    steadySrc.connect(steadyHp);
    steadyHp.connect(steadyLp);
    steadyLp.connect(steadyGain);
    steadyGain.connect(this.rainMoodGain);
    steadySrc.start();

    // 3. Warm monsoon canopy downpour bed (smooth brown/pink water wash + dense foliage splashes for মাঝারি-ভারী ও ঝুম বৃষ্টি)
    const washLen = sampleRate * 6;
    const washBuf = ctx.createBuffer(2, washLen, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = washBuf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, smooth = 0;
      for (let i = 0; i < washLen; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.996 * b0 + white * 0.020;
        b1 = 0.980 * b1 + white * 0.024;
        b2 = 0.935 * b2 + white * 0.028;
        const warm = b0 + b1 + b2;
        smooth = smooth * 0.76 + warm * 0.24;
        data[i] = Math.max(-0.65, Math.min(0.65, smooth * 0.85));
      }
    }
    this.paintLeafSplashes(washBuf, 5200, 0.12, 0.30, false);

    const downpourSrc = ctx.createBufferSource();
    downpourSrc.buffer = washBuf;
    downpourSrc.loop = true;

    const downpourHp = ctx.createBiquadFilter();
    downpourHp.type = 'highpass';
    downpourHp.frequency.value = 180;

    // Dual-stage warm lowpass prevents any harsh static hiss
    const downpourFilter = ctx.createBiquadFilter();
    downpourFilter.type = 'lowpass';
    downpourFilter.frequency.value = 1250;
    downpourFilter.Q.value = 0.5;

    const downpourCap = ctx.createBiquadFilter();
    downpourCap.type = 'lowpass';
    downpourCap.frequency.value = 1780;
    downpourCap.Q.value = 0.5;

    const washGain = ctx.createGain();
    washGain.gain.value = 0;

    this.rainFilterNode = downpourFilter;
    this.rainWashGainNode = washGain;

    downpourSrc.connect(downpourHp);
    downpourHp.connect(downpourFilter);
    downpourFilter.connect(downpourCap);
    downpourCap.connect(washGain);
    washGain.connect(this.rainMoodGain);
    downpourSrc.start();

    // 4. Deep earthy jungle-floor resonance (only emerges in মাঝারি-ভারী ও ঝুম বৃষ্টি)
    const heavyBodyFilter = ctx.createBiquadFilter();
    heavyBodyFilter.type = 'bandpass';
    heavyBodyFilter.frequency.value = 370;
    heavyBodyFilter.Q.value = 0.8;

    const heavyBodyGain = ctx.createGain();
    heavyBodyGain.gain.value = 0;
    this.rainHeavyBodyGain = heavyBodyGain;

    downpourSrc.connect(heavyBodyFilter);
    heavyBodyFilter.connect(heavyBodyGain);
    heavyBodyGain.connect(this.rainMoodGain);

    // 5. Monsoon canopy rain-wave surge (only for ঝুম বৃষ্টি / ঝড়)
    const gustBand = ctx.createBiquadFilter();
    gustBand.type = 'bandpass';
    gustBand.frequency.value = 640;
    gustBand.Q.value = 0.72;

    const gustModGain = ctx.createGain();
    gustModGain.gain.value = 0.55;

    const gustLfo = ctx.createOscillator();
    const gustLfoDepth = ctx.createGain();
    gustLfo.type = 'sine';
    gustLfo.frequency.value = 0.18;
    gustLfoDepth.gain.value = 0.42;
    gustLfo.connect(gustLfoDepth);
    gustLfoDepth.connect(gustModGain.gain);
    gustLfo.start();

    const gustSheetGain = ctx.createGain();
    gustSheetGain.gain.value = 0;
    this.rainGustSheetGain = gustSheetGain;

    downpourSrc.connect(gustBand);
    gustBand.connect(gustModGain);
    gustModGain.connect(gustSheetGain);
    gustSheetGain.connect(this.rainMoodGain);

    // 6. Pool of 14 distinct natural wet-leaf & branch-drip splash micro-buffers (zero oscillators!)
    this.dropletSplashPool = [];
    for (let p = 0; p < 14; p++) {
      const dur = 0.022 + (p % 4) * 0.005;
      const buf = ctx.createBuffer(1, Math.floor(sampleRate * dur), sampleRate);
      const d = buf.getChannelData(0);
      const dropSize = (p % 7) / 6; // varied mist -> broad leaf -> heavy branch drip
      const splashLen = Math.floor(sampleRate * (0.003 + dropSize * 0.006));
      const alpha = 0.24 + (1 - dropSize) * 0.34;
      const decaySec = 0.0008 + dropSize * 0.0019;
      let lp = 0;
      let hp = 0;
      for (let i = 0; i < splashLen; i++) {
        const t = i / sampleRate;
        const white = Math.random() * 2 - 1;
        lp = lp * (1 - alpha) + white * alpha;
        hp = hp * 0.91 + lp * 0.09;
        const env = Math.min(1, t / 0.0004) * Math.exp(-t / decaySec);
        d[i] = (lp - hp) * env * 0.85;
      }
      // Subtle 14ms wet leaf shiver tail on larger branch drops
      if (dropSize > 0.5) {
        let tLp = 0;
        let tHp = 0;
        for (let i = splashLen; i < d.length; i++) {
          const t = (i - splashLen) / sampleRate;
          const white = Math.random() * 2 - 1;
          tLp = tLp * 0.86 + white * 0.14;
          tHp = tHp * 0.94 + tLp * 0.06;
          d[i] = (tLp - tHp) * Math.exp(-t / 0.006) * 0.18;
        }
      }
      this.dropletSplashPool.push(buf);
    }

    // Feed all 5 clean rain texture layers into Weather Mode live-rain bus too
    if (this.weatherRainGain) {
      dropGain.connect(this.weatherRainGain);
      steadyGain.connect(this.weatherRainGain);
      washGain.connect(this.weatherRainGain);
      heavyBodyGain.connect(this.weatherRainGain);
      gustSheetGain.connect(this.weatherRainGain);
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

    // Synthesized rhythmic ocean swell & receding shore surf for Sea scene
    if (this.seaSurfFilter) {
      const surfMod = ctx.createGain();
      surfMod.gain.value = 0.62;
      const surfLfo = ctx.createOscillator();
      surfLfo.type = 'sine';
      surfLfo.frequency.value = 0.14; // ~7s wave rolling period
      const surfLfoDepth = ctx.createGain();
      surfLfoDepth.gain.value = 0.36;
      surfLfo.connect(surfLfoDepth);
      surfLfoDepth.connect(surfMod.gain);

      const surfCutoffLfo = ctx.createOscillator();
      surfCutoffLfo.type = 'sine';
      surfCutoffLfo.frequency.value = 0.14;
      const surfCutoffDepth = ctx.createGain();
      surfCutoffDepth.gain.value = 340;
      surfCutoffLfo.connect(surfCutoffDepth);
      surfCutoffDepth.connect(this.seaSurfFilter.frequency);

      breezeSrc.connect(surfMod);
      surfMod.connect(this.seaSurfFilter);
      surfLfo.start();
      surfCutoffLfo.start();
    }

    if (this.cabinHumFilter) {
      breezeSrc.connect(this.cabinHumFilter);
    }

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

  /** Gentle peaceful night owl & soft wind ambiance for serene rural/hill nights (zero harsh cricket hiss) */
  private playSoftNightOwl(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const panSide = Math.random() < 0.5 ? -0.45 : 0.45;
    let target: AudioNode = this.weatherNatureBus;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = panSide;
      panner.connect(this.weatherNatureBus);
      target = panner;
    }

    const calls = Math.random() < 0.45 ? 2 : 1;
    for (let c = 0; c < calls; c++) {
      const hStart = now + c * 0.62;
      const osc = ctx.createOscillator();
      const overtone = ctx.createOscillator();
      const oGain = ctx.createGain();
      const env = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(355 - c * 18, hStart);
      osc.frequency.exponentialRampToValueAtTime(302 - c * 14, hStart + 0.46);

      overtone.type = 'sine';
      overtone.frequency.setValueAtTime(710 - c * 36, hStart);
      overtone.frequency.exponentialRampToValueAtTime(604 - c * 28, hStart + 0.46);
      oGain.gain.value = 0.09;

      env.gain.setValueAtTime(0.0001, hStart);
      env.gain.linearRampToValueAtTime(0.03, hStart + 0.08);
      env.gain.exponentialRampToValueAtTime(0.0001, hStart + 0.5);

      osc.connect(env);
      overtone.connect(oGain);
      oGain.connect(env);
      env.connect(target);

      osc.start(hStart);
      overtone.start(hStart);
      osc.stop(hStart + 0.52);
      overtone.stop(hStart + 0.52);
    }
  }

  /** Soft natural water lapping ripple for River, Haor, and Village Pond */
  private playWaterLapRipple(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const dur = 0.85;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp = lp * 0.88 + (Math.random() * 2 - 1) * 0.12;
      const t = i / len;
      ch[i] = lp * Math.sin(t * Math.PI);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(320, now);
    bp.frequency.linearRampToValueAtTime(520, now + 0.35);
    bp.frequency.exponentialRampToValueAtTime(240, now + dur);
    bp.Q.value = 1.4;
    const env = ctx.createGain();
    env.gain.value = 0.045;
    src.connect(bp);
    bp.connect(env);
    env.connect(this.weatherNatureBus);
    src.start(now);
  }

  /** Authentic sweet Summer & Spring Indian Cuckoo / Bou-Kotha-Kao ("বউ কথা কও") flute cadence */
  private playBouKothaKao(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const phrase = [
      { off: 0, f0: 1580, f1: 1720, d: 0.13 },
      { off: 0.17, f0: 1420, f1: 1280, d: 0.14 },
      { off: 0.36, f0: 1640, f1: 1860, d: 0.15 },
      { off: 0.56, f0: 1940, f1: 1540, d: 0.22 },
    ];
    phrase.forEach((n) => {
      const t0 = now + n.off;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(n.f0, t0);
      osc.frequency.exponentialRampToValueAtTime(n.f1, t0 + n.d);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.042, t0 + 0.025);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + n.d);
      osc.connect(env);
      env.connect(this.weatherNatureBus!);
      osc.start(t0);
      osc.stop(t0 + n.d + 0.02);
    });
  }

  /** Monsoon Hawk-Cuckoo / Papia ("পাপিয়া / চোখ গেলো") ascending expressive triple phrase */
  private playPapiaCall(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const steps = [1.0, 1.14, 1.30];
    steps.forEach((mult, idx) => {
      const t0 = now + idx * 0.44;
      const base = 1520 * mult;
      [0, 0.14].forEach((subOff, si) => {
        const st = t0 + subOff;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(si === 0 ? base : base * 1.18, st);
        osc.frequency.exponentialRampToValueAtTime(si === 0 ? base * 1.15 : base * 0.94, st + 0.13);
        env.gain.setValueAtTime(0.0001, st);
        env.gain.linearRampToValueAtTime(0.036, st + 0.02);
        env.gain.exponentialRampToValueAtTime(0.0001, st + 0.14);
        osc.connect(env);
        env.connect(this.weatherNatureBus!);
        osc.start(st);
        osc.stop(st + 0.15);
      });
    });
  }

  /** River / Pond Kingfisher (মাছরাঙা) bright clear whistle trill */
  private playKingfisherCall(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const t0 = now + i * 0.085;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      const f = 3100 - i * 95;
      osc.frequency.setValueAtTime(f, t0);
      osc.frequency.exponentialRampToValueAtTime(f * 0.84, t0 + 0.065);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.032, t0 + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
      osc.connect(env);
      env.connect(this.weatherNatureBus);
      osc.start(t0);
      osc.stop(t0 + 0.08);
    }
  }

  /** Monsoon Marsh Dahuk / White-breasted Waterhen ("ডাহুক") mellow resonant dusk/rain call */
  private playDahukCall(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const t0 = now + i * 0.28;
      const osc = ctx.createOscillator();
      const bp = ctx.createBiquadFilter();
      const env = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(640 - i * 35, t0);
      osc.frequency.exponentialRampToValueAtTime(480 - i * 25, t0 + 0.18);
      bp.type = 'bandpass';
      bp.frequency.value = 780;
      bp.Q.value = 2.0;
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.038, t0 + 0.03);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      osc.connect(bp);
      bp.connect(env);
      env.connect(this.weatherNatureBus);
      osc.start(t0);
      osc.stop(t0 + 0.22);
    }
  }

  /** Winter Migratory Teal / Wetland Bird soft musical whistle over cold Haor & rivers */
  private playWinterMigratoryCall(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const t0 = now + i * 0.26;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      const f = 1780 + i * 160;
      osc.frequency.setValueAtTime(f, t0);
      osc.frequency.exponentialRampToValueAtTime(f * 1.18, t0 + 0.09);
      osc.frequency.exponentialRampToValueAtTime(f * 0.92, t0 + 0.18);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.032, t0 + 0.025);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.19);
      osc.connect(env);
      env.connect(this.weatherNatureBus);
      osc.start(t0);
      osc.stop(t0 + 0.21);
    }
  }

  /** Gentle interior rail/coach clack pulse for Train & Bus windows */
  private playCabinRhythmTick(ctx: AudioContext, isTrain: boolean): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const pulses = isTrain ? [0, 0.14, 0.56, 0.7] : [0];
    pulses.forEach((off) => {
      const t0 = now + off;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(isTrain ? 92 : 68, t0);
      osc.frequency.exponentialRampToValueAtTime(48, t0 + 0.09);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(isTrain ? 0.022 : 0.014, t0 + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
      osc.connect(env);
      env.connect(this.weatherNatureBus!);
      osc.start(t0);
      osc.stop(t0 + 0.11);
    });
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
      sceneId?: SceneId;
      bengaliSeason?: BengalSixSeason;
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
      if (opts.sceneId) this.sceneId = opts.sceneId;
      else if (mode === 'storm') this.sceneId = 'forest';
      if (opts.bengaliSeason) this.bengaliSeason = opts.bengaliSeason;
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
      const windNorm = wKmh < 8 ? 0 : Math.min(1.3, Math.pow((wKmh - 7) / 26, 1.15));
      const baseBreeze =
        this.currentMood === 'fog'
          ? 0.04
          : this.currentMood === 'clear_night'
            ? 0.045
            : this.currentMood === 'storm'
              ? 0.22
              : 0.09;
      // Keep gentle wind hiss muted during light drizzle so individual raindrops remain crystal clear
      const rainBreezeDuck =
        this.weatherRainIntensity > 0.02 && this.weatherRainIntensity < 0.55 && wKmh < 18 ? 0.25 : 1;
      const targetGain = wKmh < 8 ? 0.0005 : baseBreeze * windNorm * rainBreezeDuck;
      this.weatherBreezeGain.gain.setTargetAtTime(targetGain, now, 0.4);
      this.weatherBreezeFilter.frequency.setTargetAtTime(240 + windNorm * 180, now, 0.4);
    }

    if (this.seaSurfGain && this.seaSurfFilter) {
      const isSea = this.sceneMode === 'weather' && this.sceneId === 'sea';
      const wKmh = Math.max(0, this.weatherWindKmh);
      const wavePower = 0.075 + Math.min(0.11, wKmh * 0.0038) + (this.currentMood === 'storm' ? 0.05 : 0);
      this.seaSurfGain.gain.setTargetAtTime(isSea ? wavePower : 0, now, 0.5);
      this.seaSurfFilter.frequency.setTargetAtTime(420 + Math.min(360, wKmh * 12), now, 0.5);
    }

    if (this.cabinHumGain && this.cabinHumFilter) {
      const isInteriorVehicle =
        this.sceneMode === 'weather' && (this.sceneId === 'train' || this.sceneId === 'bus');
      this.cabinHumGain.gain.setTargetAtTime(isInteriorVehicle ? 0.072 : 0, now, 0.35);
      this.cabinHumFilter.frequency.setTargetAtTime(this.sceneId === 'train' ? 148 : 115, now, 0.35);
    }

    const rInt = Math.max(0, Math.min(1, this.weatherRainIntensity));
    const effectiveRain = this.sceneMode === 'storm' ? Math.max(0.7, rInt || 0.78) : rInt;

    // Proportional density-driven forest rain textures (quieter when sparser, fuller when denser):
    if (this.rainFilterNode) {
      // Smooth canopy warmth: 650Hz (light) -> 1100Hz (moderate) -> 1580Hz (heavy downpour)
      const cutoff = 650 + Math.pow(effectiveRain, 1.05) * 930;
      this.rainFilterNode.frequency.setTargetAtTime(cutoff, now, 0.35);
    }
    if (this.rainDropGainNode) {
      // Sparse quiet leaf-drizzle bed: delicate in ঝিরি ঝিরি (<0.25), richer in গুঁড়ি গুঁড়ি & হালকা
      const dropLevel =
        effectiveRain <= 0.015
          ? 0
          : effectiveRain <= 0.25
            ? 0.14 + (effectiveRain / 0.25) * 0.26
            : effectiveRain <= 0.56
              ? 0.40 + ((effectiveRain - 0.25) / 0.31) * 0.32
              : 0.72;
      this.rainDropGainNode.gain.setTargetAtTime(dropLevel, now, 0.35);
    }
    if (this.rainSteadyFoliageGain) {
      // Steady leaf-patter chorus: OFF in ঝিরি ঝিরি (<=0.23), soft in গুঁড়ি গুঁড়ি, full in হালকা/মাঝারি/ঝুম
      const steadyLevel =
        effectiveRain <= 0.23
          ? 0
          : effectiveRain <= 0.38
            ? ((effectiveRain - 0.23) / 0.15) * 0.28
            : effectiveRain <= 0.65
              ? 0.28 + ((effectiveRain - 0.38) / 0.27) * 0.58
              : 0.86 + ((effectiveRain - 0.65) / 0.35) * 0.14;
      this.rainSteadyFoliageGain.gain.setTargetAtTime(steadyLevel, now, 0.35);
    }
    if (this.rainWashGainNode) {
      // Canopy downpour body: OFF in drizzle (<=0.38), softly supportive in হালকা, lush in মাঝারি & ঝুম
      const washLevel =
        effectiveRain <= 0.38
          ? 0
          : effectiveRain <= 0.58
            ? ((effectiveRain - 0.38) / 0.20) * 0.22
            : 0.22 + ((effectiveRain - 0.58) / 0.42) * 0.72;
      this.rainWashGainNode.gain.setTargetAtTime(washLevel, now, 0.35);
    }
    if (this.rainHeavyBodyGain) {
      // Deep earthy ground-rain weight ONLY enters cleanly in মাঝারি-ভারী ও ঝুম বৃষ্টি (> 0.56)
      const bodyLevel = effectiveRain > 0.56 ? Math.pow((effectiveRain - 0.56) / 0.44, 1.1) * 0.85 : 0;
      this.rainHeavyBodyGain.gain.setTargetAtTime(bodyLevel, now, 0.4);
    }
    if (this.rainGustSheetGain) {
      // Sweeping monsoon canopy wave surge ONLY active in ঝুম বৃষ্টি / ঝড় (> 0.72)
      const gustLevel = effectiveRain > 0.72 ? Math.pow((effectiveRain - 0.72) / 0.28, 1.1) * 0.62 : 0;
      this.rainGustSheetGain.gain.setTargetAtTime(gustLevel, now, 0.4);
    }

    if (this.weatherRainGain) {
      // Volume strictly tracks live rainfall density: gentle & quiet for trace drizzle (0.14), fuller for downpour (0.48)
      const weatherRainLevel =
        this.sceneMode === 'weather' && rInt > 0.012
          ? Math.min(0.50, 0.12 + Math.pow(rInt, 0.85) * 0.38)
          : 0;
      this.weatherRainGain.gain.setTargetAtTime(weatherRainLevel, now, 0.35);
    }

    const dropletsNeeded =
      (this.sceneMode === 'weather' && rInt > 0.015) ||
      (this.sceneMode === 'storm' && !this.isRainMuted);
    if (dropletsNeeded) {
      if (this.rainDropletTimer === null) this.scheduleRainDroplets();
    } else if (this.rainDropletTimer !== null) {
      window.clearTimeout(this.rainDropletTimer);
      this.rainDropletTimer = null;
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

  /**
   * Natural wet-leaf micro-splash droplet from pool (ZERO sine/triangle woodblock knocks, ZERO hiss).
   * Volume and playback rate scale naturally with live rainfall density.
   */
  private triggerSingleRaindrop(ctx: AudioContext, intensity: number): void {
    const outBus = this.sceneMode === 'weather' ? this.weatherRainGain : this.rainMoodGain;
    if (!outBus || ctx.state !== 'running' || this.dropletSplashPool.length === 0) return;

    const now = ctx.currentTime;
    const poolIdx = Math.floor(Math.random() * this.dropletSplashPool.length);
    const src = ctx.createBufferSource();
    src.buffer = this.dropletSplashPool[poolIdx];
    src.playbackRate.value = 0.84 + Math.random() * 0.34;

    // Gentle foliage frequency shaping (low Q so it never rings or knocks like wood)
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 950 + Math.random() * 1450;
    bp.Q.value = 0.55;

    const env = ctx.createGain();
    // Softer drops in drizzle, fuller heavy-branch drops in stronger rain
    const baseAmp = 0.16 + Math.min(1, intensity) * 0.34;
    env.gain.value = baseAmp * (0.55 + Math.random() * 0.65);

    src.connect(bp);
    bp.connect(env);

    if (typeof ctx.createStereoPanner === 'function') {
      const pan = ctx.createStereoPanner();
      pan.pan.value = (Math.random() - 0.5) * 1.45;
      env.connect(pan);
      pan.connect(outBus);
    } else {
      env.connect(outBus);
    }

    src.start(now);
  }

  private scheduleRainDroplets(): void {
    if (this.rainDropletTimer !== null) {
      window.clearTimeout(this.rainDropletTimer);
      this.rainDropletTimer = null;
    }

    const rInt = Math.max(0, Math.min(1, this.weatherRainIntensity));
    const effective = this.sceneMode === 'storm' ? Math.max(0.7, rInt || 0.78) : rInt;
    const active =
      (this.sceneMode === 'weather' && rInt > 0.015) ||
      (this.sceneMode === 'storm' && !this.isRainMuted);
    if (!active) return;

    // Distinct droplet spacing across all 5 live weather rain levels:
    // ঝিরি ঝিরি (<0.25): calm sparse drips (170-480ms) | গুঁড়ি গুঁড়ি (0.25-0.38): soft drips (90-210ms)
    // হালকা (0.38-0.56): steady leaf drips (48-115ms) | মাঝারি (0.56-0.78): continuous (32-68ms) | ঝুম (>0.78): dense (24-48ms)
    const minDelay =
      effective < 0.25 ? 170 : effective < 0.38 ? 90 : effective < 0.56 ? 48 : effective < 0.78 ? 32 : 24;
    const jitterDelay =
      effective < 0.25 ? 310 : effective < 0.38 ? 120 : effective < 0.56 ? 67 : effective < 0.78 ? 36 : 24;
    const delay = minDelay + Math.random() * jitterDelay;

    this.rainDropletTimer = window.setTimeout(() => {
      const ctx = this.ctx;
      if (ctx && ctx.state === 'running') {
        const nowEffective =
          this.sceneMode === 'storm' ? Math.max(0.7, this.weatherRainIntensity || 0.78) : this.weatherRainIntensity;
        this.triggerSingleRaindrop(ctx, nowEffective);
        if (nowEffective >= 0.42 && Math.random() < 0.4) {
          this.triggerSingleRaindrop(ctx, nowEffective);
        }
      }
      this.scheduleRainDroplets();
    }, delay);
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


  /** Coastal seagull / tern cries for Sea shore scenes */
  public playSeaGullCall(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const calls = 2 + (Math.random() < 0.45 ? 1 : 0);
    for (let i = 0; i < calls; i++) {
      const t0 = now + i * 0.34;
      const dur = 0.28;
      const osc = ctx.createOscillator();
      const bp = ctx.createBiquadFilter();
      const env = ctx.createGain();
      osc.type = 'sawtooth';
      const f = 1450 + Math.random() * 240;
      osc.frequency.setValueAtTime(f * 0.88, t0);
      osc.frequency.linearRampToValueAtTime(f * 1.24, t0 + 0.07);
      osc.frequency.exponentialRampToValueAtTime(f * 0.72, t0 + dur);
      bp.type = 'bandpass';
      bp.frequency.value = f * 1.15;
      bp.Q.value = 3.2;
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.032, t0 + 0.035);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(bp);
      bp.connect(env);
      env.connect(this.weatherNatureBus);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }
  }

  /** Urban rooftop Pigeon cooing ("বাক-বাকুম") */
  public playPigeonCoo(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const f = 295 + Math.random() * 40;
    const notes = [0, 0.16, 0.36];
    notes.forEach((off, idx) => {
      const t0 = now + off;
      const dur = idx === 2 ? 0.24 : 0.12;
      const osc = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const modG = ctx.createGain();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f * (idx === 1 ? 1.14 : 1.0), t0);
      osc.frequency.exponentialRampToValueAtTime(f * 0.86, t0 + dur);
      mod.type = 'sine';
      mod.frequency.value = 26;
      modG.gain.value = 14;
      mod.connect(modG);
      modG.connect(osc.frequency);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.038, t0 + 0.03);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(env);
      env.connect(this.weatherNatureBus!);
      osc.start(t0);
      mod.start(t0);
      osc.stop(t0 + dur + 0.02);
      mod.stop(t0 + dur + 0.02);
    });
  }

  /** Reedland / shore White Egret (সাদা বক) short resonant croak/squawk */
  public playEgretCall(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const pulses = Math.random() < 0.4 ? 2 : 1;
    for (let i = 0; i < pulses; i++) {
      const t0 = now + i * 0.28;
      const dur = 0.21;
      const osc = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const modG = ctx.createGain();
      const bp = ctx.createBiquadFilter();
      const env = ctx.createGain();

      osc.type = 'sawtooth';
      const baseF = 430 + Math.random() * 85;
      osc.frequency.setValueAtTime(baseF * 1.12, t0);
      osc.frequency.exponentialRampToValueAtTime(baseF * 0.78, t0 + dur);

      mod.type = 'sine';
      mod.frequency.value = 38;
      modG.gain.value = 34;
      mod.connect(modG);
      modG.connect(osc.frequency);

      bp.type = 'bandpass';
      bp.frequency.value = 880;
      bp.Q.value = 2.6;

      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.036, t0 + 0.025);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(bp);
      bp.connect(env);
      env.connect(this.weatherNatureBus);

      osc.start(t0);
      mod.start(t0);
      osc.stop(t0 + dur + 0.02);
      mod.stop(t0 + dur + 0.02);
    }
  }

  /** Hill & coastal Brahminy Kite / Eagle (চিল) clear high descending whistle */
  public playEagleCall(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const calls = Math.random() < 0.35 ? 2 : 1;
    for (let i = 0; i < calls; i++) {
      const t0 = now + i * 0.62;
      const dur = 0.48;
      const osc = ctx.createOscillator();
      const vibrato = ctx.createOscillator();
      const vibG = ctx.createGain();
      const bp = ctx.createBiquadFilter();
      const env = ctx.createGain();

      osc.type = 'triangle';
      const f = 2250 + Math.random() * 260;
      osc.frequency.setValueAtTime(f * 0.94, t0);
      osc.frequency.linearRampToValueAtTime(f * 1.06, t0 + 0.09);
      osc.frequency.exponentialRampToValueAtTime(f * 0.64, t0 + dur);

      vibrato.type = 'sine';
      vibrato.frequency.value = 18;
      vibG.gain.value = 32;
      vibrato.connect(vibG);
      vibG.connect(osc.frequency);

      bp.type = 'bandpass';
      bp.frequency.value = f * 0.9;
      bp.Q.value = 2.4;

      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.034, t0 + 0.055);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(bp);
      bp.connect(env);
      env.connect(this.weatherNatureBus);

      osc.start(t0);
      vibrato.start(t0);
      osc.stop(t0 + dur + 0.02);
      vibrato.stop(t0 + dur + 0.02);
    }
  }

  /** Coastal Sandpiper (বাটান) rapid bright shore peeps along receding surf */
  public playSandpiperCall(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const chips = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < chips; i++) {
      const t0 = now + i * 0.085;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      const f = 3150 - i * 130 + Math.random() * 140;
      osc.frequency.setValueAtTime(f, t0);
      osc.frequency.exponentialRampToValueAtTime(f * 1.18, t0 + 0.03);
      osc.frequency.exponentialRampToValueAtTime(f * 0.9, t0 + 0.07);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.026, t0 + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.075);
      osc.connect(env);
      env.connect(this.weatherNatureBus);
      osc.start(t0);
      osc.stop(t0 + 0.08);
    }
  }

  /** Coastal Tern (পানচিল) sharp breezy descending cry */
  public playTernCall(ctx: AudioContext): void {
    if (!this.weatherNatureBus || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const count = Math.random() < 0.5 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const t0 = now + i * 0.24;
      const osc = ctx.createOscillator();
      const bp = ctx.createBiquadFilter();
      const env = ctx.createGain();
      osc.type = 'sawtooth';
      const f = 2100 + Math.random() * 220;
      osc.frequency.setValueAtTime(f, t0);
      osc.frequency.exponentialRampToValueAtTime(f * 0.68, t0 + 0.17);
      bp.type = 'bandpass';
      bp.frequency.value = f * 0.85;
      bp.Q.value = 3.5;
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(0.028, t0 + 0.018);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      osc.connect(bp);
      bp.connect(env);
      env.connect(this.weatherNatureBus);
      osc.start(t0);
      osc.stop(t0 + 0.19);
    }
  }

  /** Natural river/haor cast-net water splash when fisherman throws ঝাঁকি জাল into water */
  public triggerNetSplash(panX = 0): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.weatherNatureBus) return;
    if (this.sceneMode !== 'weather') return;
    if (this.sceneId !== 'river' && this.sceneId !== 'haor') return;
    const wallNow = Date.now();
    if (wallNow - this.lastNetSplashAt < 3800) return;
    this.lastNetSplashAt = wallNow;

    const now = ctx.currentTime;
    const outNode = this.weatherNatureBus;

    const connectWithPan = (node: AudioNode) => {
      if (typeof ctx.createStereoPanner === 'function') {
        const pan = ctx.createStereoPanner();
        pan.pan.value = Math.max(-0.85, Math.min(0.85, panX));
        node.connect(pan);
        pan.connect(outNode);
      } else {
        node.connect(outNode);
      }
    };

    // 1) Low buoyant water cavity plop/thud
    const thudOsc = ctx.createOscillator();
    const thudEnv = ctx.createGain();
    thudOsc.type = 'sine';
    thudOsc.frequency.setValueAtTime(175, now);
    thudOsc.frequency.exponentialRampToValueAtTime(62, now + 0.24);
    thudEnv.gain.setValueAtTime(0.0001, now);
    thudEnv.gain.linearRampToValueAtTime(0.16, now + 0.018);
    thudEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    thudOsc.connect(thudEnv);
    connectWithPan(thudEnv);
    thudOsc.start(now);
    thudOsc.stop(now + 0.3);

    // 2) Wide conical spray splash burst (filtered noise + droplet spray cluster)
    const splashLen = Math.floor(ctx.sampleRate * 0.45);
    const buf = ctx.createBuffer(1, splashLen, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < splashLen; i++) {
      const envT = i / splashLen;
      const decay = Math.exp(-envT * 5.2);
      ch[i] = (Math.random() * 2 - 1) * decay;
    }
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1150, now);
    bp.frequency.exponentialRampToValueAtTime(480, now + 0.42);
    bp.Q.value = 0.85;
    const sGain = ctx.createGain();
    sGain.gain.setValueAtTime(0.0001, now);
    sGain.gain.linearRampToValueAtTime(0.22, now + 0.02);
    sGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.44);
    noiseSrc.connect(bp);
    bp.connect(sGain);
    connectWithPan(sGain);
    noiseSrc.start(now);

    // 3) Secondary sparkling water droplet splatters from pre-built natural droplet pool
    if (this.dropletSplashPool.length > 0) {
      for (let d = 0; d < 4; d++) {
        const dSrc = ctx.createBufferSource();
        dSrc.buffer = this.dropletSplashPool[Math.floor(Math.random() * this.dropletSplashPool.length)];
        dSrc.playbackRate.value = 0.85 + Math.random() * 0.4;
        const dGain = ctx.createGain();
        dGain.gain.value = 0.14 + Math.random() * 0.12;
        dSrc.connect(dGain);
        connectWithPan(dGain);
        dSrc.start(now + 0.04 + d * 0.055);
      }
    }
  }

  /** Very soft, gentle distant rhythmic rail-joint click-clack ("খুব অল্প করে, খুব আস্তে করে") + warm steel bridge resonance when train crosses railbridge */
  public triggerTrainRumbleTick(panX = 0): void {
    if (this.sceneMode !== 'weather' || this.sceneId !== 'railbridge') return;
    const ctx = this.ctx;
    const outNode = this.weatherNatureBus;
    if (!ctx || !outNode || ctx.state !== 'running') return;
    const nowMs = performance.now();
    if (nowMs - this.lastRailClickAt < 580) return;
    this.lastRailClickAt = nowMs;

    const now = ctx.currentTime;
    const clampedPan = Math.max(-0.75, Math.min(0.75, panX));

    const connectWithPan = (node: AudioNode) => {
      if (typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(clampedPan, now);
        node.connect(panner);
        panner.connect(outNode);
      } else {
        node.connect(outNode);
      }
    };

    // Double subtle rail-joint "da-dum" wheel click (front & rear bogie axles passing expansion joint)
    [0, 0.13].forEach((offset, idx) => {
      const clickLen = Math.floor(ctx.sampleRate * 0.045);
      const buf = ctx.createBuffer(1, clickLen, ctx.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < clickLen; i++) {
        ch[i] = (Math.random() * 2 - 1) * Math.exp(-(i / clickLen) * 8.5);
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(idx === 0 ? 410 : 350, now + offset);
      bp.Q.value = 2.2;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.linearRampToValueAtTime(0.022, now + offset + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.044);

      src.connect(bp);
      bp.connect(gain);
      connectWithPan(gain);
      src.start(now + offset);
    });

    // Barely perceptible soft warm steel truss bridge hum
    const rumbleOsc = ctx.createOscillator();
    const rumbleGain = ctx.createGain();
    rumbleOsc.type = 'triangle';
    rumbleOsc.frequency.setValueAtTime(74, now);
    rumbleGain.gain.setValueAtTime(0.0001, now);
    rumbleGain.gain.linearRampToValueAtTime(0.015, now + 0.08);
    rumbleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    rumbleOsc.connect(rumbleGain);
    connectWithPan(rumbleGain);
    rumbleOsc.start(now);
    rumbleOsc.stop(now + 0.48);
  }

  private scheduleNatureLoop(): void {
    if (this.natureTimer !== null) {
      window.clearTimeout(this.natureTimer);
      this.natureTimer = null;
    }
    if (this.sceneMode !== 'weather') return;

    const isHotSun =
      this.weatherIsDay &&
      (this.weatherTempC >= 28.5 || (this.weatherTempC >= 26.5 && this.sunProgress > 0.3 && this.sunProgress < 0.72));
    const isRainOrStorm =
      this.currentMood === 'rain' ||
      this.currentMood === 'storm' ||
      this.weatherRainIntensity > 0.05;

    const isInteriorCabin = this.sceneId === 'train' || this.sceneId === 'bus';
    const nextDelay = isInteriorCabin
      ? 1450 + Math.random() * 900
      : isRainOrStorm
        ? 2400 + Math.random() * 2500
        : this.weatherIsDay
          ? isHotSun
            ? 2700 + Math.random() * 2500
            : this.currentMood === 'clear_day'
              ? 1950 + Math.random() * 2000
              : 2800 + Math.random() * 2600
          : 3400 + Math.random() * 3200;

    this.natureTimer = window.setTimeout(() => {
      if (this.sceneMode !== 'weather') return;
      const ctx = this.ctx;
      if (ctx && ctx.state === 'running') {
        const isUrban = this.sceneId === 'city' || this.sceneId === 'rooftop';
        const isSea = this.sceneId === 'sea';
        const isWaterland = this.sceneId === 'river' || this.sceneId === 'haor';
        const isHill = this.sceneId === 'mountain';
        const isTea = this.sceneId === 'teagarden';
        const season = this.bengaliSeason;

        // Inside Train or Bus cabin: strictly cozy vehicle interior rhythm — zero outdoor crickets/frogs/birds!
        if (isInteriorCabin) {
          this.playCabinRhythmTick(ctx, this.sceneId === 'train');
          this.scheduleNatureLoop();
          return;
        }

        if ((this.weatherWindKmh >= 11 || this.currentMood === 'storm') && Math.random() < 0.42) {
          this.playWindGustRustle(ctx, Math.min(1.8, Math.max(0.7, this.weatherWindKmh / 14)));
        }

        if (isRainOrStorm) {
          // During rain/storm: soft sheltered sparrow/dahuk/papia & monsoon frogs (near rural waterlands/village, not ocean/city)
          if (this.weatherIsDay && this.currentMood === 'rain' && this.weatherRainIntensity < 0.65) {
            const rainRoll = Math.random();
            if (isUrban) {
              if (rainRoll < 0.55) this.playRainShelteredSparrow(ctx);
              else this.playPigeonCoo(ctx);
            } else if (!isSea) {
              if (rainRoll < 0.26) this.playRainShelteredSparrow(ctx);
              else if (season === 'barsha' && rainRoll < 0.48) this.playPapiaCall(ctx);
              else if ((isWaterland || season === 'barsha') && rainRoll < 0.68) this.playDahukCall(ctx);
              else if (rainRoll < 0.82) this.playDoveCall(ctx);
              else this.playRainFrogChorus(ctx);
            }
          } else if (!isUrban && !isSea) {
            this.playRainFrogChorus(ctx);
          }
        } else if (this.weatherIsDay) {
          const isHot = this.weatherTempC >= 31 || season === 'grishmo';
          const isWinterMist = this.weatherTempC <= 19 || this.currentMood === 'fog' || season === 'sheet';
          const r = Math.random();

          if (isSea) {
            // Coastal ecosystem: Seagulls, Terns, Sandpipers, Kites, Shore Egrets
            if (r < 0.34) this.playSeaGullCall(ctx);
            else if (r < 0.56) this.playTernCall(ctx);
            else if (r < 0.76) this.playSandpiperCall(ctx);
            else if (r < 0.90) this.playEagleCall(ctx);
            else this.playEgretCall(ctx);
          } else if (isUrban) {
            // City & Rooftop: melodious pigeons, sparrows, mynas, bulbuls, occasional cuckoo/crow
            if (this.sceneId === 'rooftop') {
              if (r < 0.32) this.playPigeonCoo(ctx);
              else if (r < 0.56) this.playSparrowChirp(ctx);
              else if (r < 0.74) this.playBulbulSong(ctx);
              else if (r < 0.88) this.playMynaSong(ctx);
              else if (season === 'basanta' || season === 'grishmo') this.playKoelCall(ctx);
              else this.playHotCrowCaw(ctx);
            } else {
              if (r < 0.24) this.playPigeonCoo(ctx);
              else if (r < 0.50) this.playSparrowChirp(ctx);
              else if (r < 0.72) this.playMynaSong(ctx);
              else if (r < 0.86) this.playShalikMelody(ctx);
              else this.playHotCrowCaw(ctx);
            }
          } else if (isWaterland) {
            // River & Haor: Gentle water ripples + Kingfisher, Egret, Doyel, Dahuk (Monsoon), Migratory whistle (Winter)
            if (r < 0.22) this.playWaterLapRipple(ctx);
            else if (r < 0.40) this.playKingfisherCall(ctx);
            else if (r < 0.56) this.playEgretCall(ctx);
            else if (isWinterMist && r < 0.76) this.playWinterMigratoryCall(ctx);
            else if (season === 'barsha' && r < 0.76) this.playDahukCall(ctx);
            else if (r < 0.88) this.playDoyelSong(ctx);
            else this.playDoveCall(ctx);
          } else if (isHill) {
            // Misty Mountains: High soaring Kite, Mountain flute, Bulbul, Summer/Spring Cuckoo & Bou-Kotha-Kao
            if (r < 0.26) this.playEagleCall(ctx);
            else if (r < 0.46) this.playMistyDawnBird(ctx);
            else if (r < 0.64) this.playBulbulSong(ctx);
            else if ((season === 'grishmo' || season === 'basanta') && r < 0.84) this.playBouKothaKao(ctx);
            else if (season === 'barsha' && r < 0.84) this.playPapiaCall(ctx);
            else this.playDoveCall(ctx);
          } else if (isTea) {
            // Lush Tea Garden: Doyel, Bulbul, Tuntuni, Seasonal Cuckoo/Bou-Kotha-Kao/Papia
            if (r < 0.22) this.playDoyelSong(ctx);
            else if (r < 0.42) this.playBulbulSong(ctx);
            else if (r < 0.58) this.playTuntuniSong(ctx);
            else if ((season === 'grishmo' || season === 'basanta') && r < 0.78) this.playKoelCall(ctx);
            else if (season === 'barsha' && r < 0.78) this.playPapiaCall(ctx);
            else if (isWinterMist && r < 0.78) this.playWinterMigratoryCall(ctx);
            else this.playDoveCall(ctx);
          } else {
            // Village & Railbridge: Season-specific rich melodious Bengali birdsong!
            if (season === 'basanta' && r < 0.34) {
              if (r < 0.19) this.playKoelCall(ctx);
              else this.playBouKothaKao(ctx);
            } else if ((season === 'grishmo' || isHot) && r < 0.38) {
              if (r < 0.16) this.playKoelCall(ctx);
              else if (r < 0.29) this.playBouKothaKao(ctx);
              else this.playDoveCall(ctx);
            } else if (season === 'barsha' && r < 0.38) {
              if (r < 0.20) this.playPapiaCall(ctx);
              else this.playDahukCall(ctx);
            } else if (isWinterMist && r < 0.34) {
              if (r < 0.18) this.playMistyDawnBird(ctx);
              else this.playDoveCall(ctx);
            } else if (r < 0.48) {
              this.playDoyelSong(ctx);
            } else if (r < 0.60) {
              this.playBulbulSong(ctx);
            } else if (r < 0.71) {
              this.playTuntuniSong(ctx);
            } else if (r < 0.81) {
              this.playShalikMelody(ctx);
            } else if (r < 0.90) {
              this.playMynaSong(ctx);
            } else if (r < 0.96) {
              this.playBabuiSong(ctx);
            } else {
              this.playSparrowChirp(ctx);
            }
          }
        } else {
          // Calm Realistic Night Ambience — ZERO harsh cricket chirps anywhere!
          if (isWaterland) {
            if (Math.random() < 0.52) this.playWaterLapRipple(ctx);
            else if (Math.random() < 0.25) this.playSoftNightOwl(ctx);
          } else if (isSea || isUrban) {
            // Coastal surf / peaceful city night breeze runs continuously
          } else if (Math.random() < 0.35) {
            this.playSoftNightOwl(ctx);
          }
        }
      }
      this.scheduleNatureLoop();
    }, nextDelay);
  }
}

export const stormAudio = new StormAudioEngine();


