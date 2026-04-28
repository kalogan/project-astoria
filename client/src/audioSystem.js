// audioSystem.js — procedural SFX via Web Audio API.
//
// ── DESIGN PHILOSOPHY (Astonia-style) ─────────────────────────────────────────
//   • Zero files — all sounds synthesised at runtime from oscillators + noise.
//   • Short + dry — most sounds are 50–150 ms; no reverb.
//   • Responsive — hit/damage sounds play with no delay; attack delayed ~80ms
//     to align with animation wind-up peak (design spec).
//   • Spam-safe — per-sound cooldowns drop duplicate triggers silently.
//   • Variation — every synthesised note is pitch/gain-varied ±10% so rapid
//     repetition never sounds mechanical.
//
// ── SIGNAL CHAIN ──────────────────────────────────────────────────────────────
//   AudioContext
//     └─ masterGain  ← setVolume() controls this
//          └─ per-note GainNode  ← synthesis node fan-in
//               └─ oscillator / noise source
//
// ── VOLUME HIERARCHY ─────────────────────────────────────────────────────────
//   hit  0.35  >  magic 0.25  >  attack 0.20  >  UI 0.15  >  step 0.05
//
// ── PUBLIC API ───────────────────────────────────────────────────────────────
//   audioSys.setContext({ player })
//   audioSys.subscribe(eventBus)
//   await audioSys.preload()           ← no-op now; kept for API compat
//   audioSys.tickFootstep(delta, bool) ← call each frame
//   audioSys.play(soundId)
//   audioSys.playAt(soundId, pos)
//   audioSys.testPlay(soundId)

// ── Sound routing table ───────────────────────────────────────────────────────
// Maps logical sound IDs (same keys the event subscriptions use) to synth types
// and per-sound cooldowns (ms).  These IDs are the contract with subscribe().
const SYNTH_MAP = {
  'combat.attack':        { type: 'attack',    cooldownMs:  80, vol: 0.20 },
  'combat.hit':           { type: 'hit',       cooldownMs:  80, vol: 0.35 },
  'combat.enemyHit':      { type: 'enemyHit',  cooldownMs:  80, vol: 0.28 },
  'combat.death':         { type: 'death',     cooldownMs: 400, vol: 0.40 },
  'ui.confirm':           { type: 'confirm',   cooldownMs: 100, vol: 0.15 },
  'ui.click':             { type: 'click',     cooldownMs:  60, vol: 0.12 },
  'interaction.teleport': { type: 'teleport',  cooldownMs: 500, vol: 0.25 },
  'interaction.altar':    { type: 'altar',     cooldownMs: 500, vol: 0.22 },
  'reward.jewel':         { type: 'reward',    cooldownMs: 800, vol: 0.30 },
  'reward.complete':      { type: 'levelUp',   cooldownMs:1000, vol: 0.30 },
  'movement.step':        { type: 'step',      cooldownMs:   0, vol: 0.05 },
  // Ability-specific sounds (routed via ABILITY_SOUNDS below)
  'magic.lightning':      { type: 'lightning', cooldownMs:  80, vol: 0.25 },
  'magic.fireball':       { type: 'fireball',  cooldownMs:  80, vol: 0.25 },
  'magic.shield':         { type: 'shield',    cooldownMs: 300, vol: 0.20 },
  'magic.pulse':          { type: 'pulse',     cooldownMs: 200, vol: 0.22 },
  'magic.warcry':         { type: 'warcry',    cooldownMs: 300, vol: 0.30 },
  'magic.missile':        { type: 'lightning', cooldownMs:  80, vol: 0.20 },
};

// Ability id → sound id mapping (used in skill_cast handler)
const ABILITY_SOUNDS = {
  fireball:        'magic.fireball',
  lightning_ball:  'magic.lightning',
  lightning_bolt:  'magic.lightning',
  magic_missile:   'magic.missile',
  lightning_pulse: 'magic.pulse',
  magic_shield:    'magic.shield',
  warcry:          'magic.warcry',
  war_cry:         'magic.warcry',
  surround_hit:    'combat.attack',
  parry:           'ui.click',
  backstab:        'combat.attack',
  dash:            'combat.attack',
  charge:          'combat.attack',
  slash:           'combat.attack',
};

// All exported sound IDs — used by __debug.audio.testAll in main.js
export const ALL_SOUND_IDS = Object.keys(SYNTH_MAP);

const MAX_DISTANCE  = 22;
const STEP_INTERVAL = 0.34;  // seconds between footstep sounds

// ── AudioSystem ───────────────────────────────────────────────────────────────

export class AudioSystem {
  constructor() {
    this._ctx        = null;
    this._masterGain = null;
    this._lastPlayed = new Map();  // soundId → performance.now()
    this._player     = null;
    this._volume     = 0.65;
    this.enabled     = true;
    this._debug      = false;
    this._stepTimer  = 0;
  }

  // ── Context wiring ─────────────────────────────────────────────────────────

  setContext({ player }) {
    this._player = player;
  }

  // ── Initialisation ─────────────────────────────────────────────────────────

  _ensureContext() {
    if (this._ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { console.warn('[Audio] Web Audio API not supported'); return; }
    this._ctx = new Ctx();
    this._masterGain = this._ctx.createGain();
    this._masterGain.gain.value = this._volume;
    this._masterGain.connect(this._ctx.destination);
    if (this._debug) console.log('[Audio] AudioContext created');
  }

  /**
   * No-op — kept so main.js `await audioSys.preload()` still compiles.
   * Procedural audio needs no assets to fetch.
   */
  async preload() {
    this._ensureContext();
    console.log('[Audio] Procedural synthesis ready — no asset loading required');
  }

  // ── Public playback API ────────────────────────────────────────────────────

  play(soundId) {
    if (!this.enabled) return;
    const def = SYNTH_MAP[soundId];
    if (!def) {
      if (this._debug) console.warn(`[Audio] Unknown sound: "${soundId}"`);
      return;
    }
    if (this._onCooldown(soundId, def.cooldownMs)) return;
    this._stamp(soundId);
    this._synth(def.type, def.vol);
  }

  /**
   * Distance-attenuated play.
   * Volume falls off linearly from full at distance 0 → silent at MAX_DISTANCE.
   */
  playAt(soundId, position) {
    if (!this.enabled) return;
    const def = SYNTH_MAP[soundId];
    if (!def) return;
    if (this._onCooldown(soundId, def.cooldownMs)) return;
    this._stamp(soundId);

    let vol = def.vol;
    if (this._player?.mesh) {
      const pp   = this._player.mesh.position;
      const dx   = position.x - pp.x;
      const dz   = position.z - pp.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const t    = Math.max(0, 1 - dist / MAX_DISTANCE);
      if (t < 0.02) return;
      vol *= t;
    }

    this._synth(def.type, vol);
  }

  setVolume(level) {
    this._volume = Math.max(0, Math.min(1, level));
    if (this._masterGain) this._masterGain.gain.value = this._volume;
  }

  getVolume() { return this._volume; }

  // ── Footstep tick ──────────────────────────────────────────────────────────

  tickFootstep(delta, isMoving) {
    if (!this.enabled || !isMoving) { this._stepTimer = 0; return; }
    this._stepTimer += delta;
    if (this._stepTimer >= STEP_INTERVAL) {
      this._stepTimer -= STEP_INTERVAL;
      this._synth('step', SYNTH_MAP['movement.step'].vol);
    }
  }

  // ── EventBus integration ───────────────────────────────────────────────────

  subscribe(eventBus) {

    // ── Combat ───────────────────────────────────────────────────────────────

    // Auto-attack wind-up: delay 80ms to align with animation peak
    eventBus.on('attack_started', ({ payload }) => {
      if (payload?.source !== 'auto') return;
      setTimeout(() => {
        if (!this.enabled) return;
        if (this._onCooldown('combat.attack', 80)) return;
        this._stamp('combat.attack');
        this._synth('attack', 0.20);
      }, 80);
    });

    // skill_cast: pick synth type from ability ID; play immediately
    eventBus.on('skill_cast', ({ payload }) => {
      if (!payload?.abilityId) return;
      const soundId = ABILITY_SOUNDS[payload.abilityId] ?? 'combat.attack';
      const def     = SYNTH_MAP[soundId];
      if (!def) return;
      if (this._onCooldown(soundId, def.cooldownMs)) return;
      this._stamp(soundId);
      this._synth(def.type, def.vol);
    });

    // enemy_damaged: instant — hit feedback is the most important sound
    eventBus.on('enemy_damaged', ({ payload }) => {
      if (!this.enabled) return;
      if (this._onCooldown('combat.enemyHit', 80)) return;
      this._stamp('combat.enemyHit');
      const vol = SYNTH_MAP['combat.enemyHit'].vol;
      // Apply distance falloff if position is known
      if (payload?.position && this._player?.mesh) {
        const pp   = this._player.mesh.position;
        const dx   = payload.position.x - pp.x;
        const dz   = payload.position.z - pp.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const t    = Math.max(0, 1 - dist / MAX_DISTANCE);
        if (t < 0.02) return;
        this._synth('enemyHit', vol * t);
      } else {
        this._synth('enemyHit', vol);
      }
    });

    // enemy_killed: death sound at position
    eventBus.on('enemy_killed', ({ payload }) => {
      if (!this.enabled) return;
      if (this._onCooldown('combat.death', 400)) return;
      this._stamp('combat.death');
      this._synth('death', 0.40);
    });

    // player_damaged: sharp hit on the player (same hit synth, slightly louder)
    eventBus.on('player_damaged', () => {
      if (!this.enabled) return;
      if (this._onCooldown('combat.hit', 100)) return;
      this._stamp('combat.hit');
      this._synth('hit', 0.35);
    });

    // ── Interaction ──────────────────────────────────────────────────────────

    eventBus.on('entity_interact', ({ payload }) => {
      if (payload?.entityType === 'teleporter') this.play('interaction.teleport');
      if (payload?.entityType === 'altar')      this.play('interaction.altar');
    });
    eventBus.on('teleport_requested',  () => this.play('interaction.teleport'));
    eventBus.on('altar_interacted',    () => this.play('interaction.altar'));

    // ── Rewards ──────────────────────────────────────────────────────────────

    eventBus.on('clan_jewel_claimed',      () => this.play('reward.jewel'));
    eventBus.on('spawner_claim_completed', () => this.play('reward.jewel'));
    eventBus.on('pentagram_completed',     () => this.play('reward.complete'));
    eventBus.on('dungeon_completed',       () => this.play('reward.complete'));

    // ── UI ────────────────────────────────────────────────────────────────────

    eventBus.on('quest_complete', () => this.play('ui.confirm'));
    eventBus.on('level_up',       () => this.play('reward.complete'));

    // Ability failed (oom): brief click to signal "can't cast"
    eventBus.on('ability_failed', () => this.play('ui.click'));

    // Shield state changes
    eventBus.on('magic_shield_applied', () => this.play('magic.shield'));
    eventBus.on('shield_broken',        () => {
      if (!this.enabled) return;
      this._synth('hit', 0.28);  // sharp break sound
    });
  }

  // ── Synthesis dispatcher ───────────────────────────────────────────────────

  /**
   * Central dispatch: routes a type string to the correct synth function.
   * vol is pre-scaled by master volume inside each _synth* function.
   */
  _synth(type, vol) {
    this._ensureContext();
    if (!this._ctx) return;
    if (this._ctx.state === 'suspended') this._ctx.resume();

    const t = this._ctx.currentTime;
    const v = vol * this._volume;  // apply master volume

    if (this._debug) console.log(`[Audio] ▶ ${type}  vol=${v.toFixed(3)}`);

    switch (type) {
      case 'attack':    return this._synthAttack(t, v);
      case 'hit':       return this._synthHit(t, v);
      case 'enemyHit':  return this._synthEnemyHit(t, v);
      case 'death':     return this._synthDeath(t, v);
      case 'lightning': return this._synthLightning(t, v);
      case 'fireball':  return this._synthFireball(t, v);
      case 'shield':    return this._synthShield(t, v);
      case 'pulse':     return this._synthPulse(t, v);
      case 'warcry':    return this._synthWarcry(t, v);
      case 'step':      return this._synthStep(t, v);
      case 'confirm':   return this._synthConfirm(t, v);
      case 'click':     return this._synthClick(t, v);
      case 'teleport':  return this._synthTeleport(t, v);
      case 'altar':     return this._synthAltar(t, v);
      case 'reward':    return this._synthReward(t, v);
      case 'levelUp':   return this._synthLevelUp(t, v);
      default:
        if (this._debug) console.warn(`[Audio] No synth for type "${type}"`);
    }
  }

  // ── Synthesisers ──────────────────────────────────────────────────────────
  //
  // Naming: _synth<Type>(t, vol)
  //   t   = audioCtx.currentTime  (absolute schedule base)
  //   vol = master-scaled gain value
  //
  // All nodes are fire-and-forget: they auto-disconnect after stop() and are GC'd.

  // ── ⚔️  ATTACK — noise whoosh, ~80ms ──────────────────────────────────────
  // Very soft; not impactful — the HIT sound carries the weight.
  // Bandpass-filtered white noise gives the "air" quality of a swing.
  _synthAttack(t, vol) {
    const dur = 0.08;
    const noise = this._makeNoise(dur);
    const filt  = this._ctx.createBiquadFilter();
    filt.type            = 'bandpass';
    filt.frequency.value = _v(900, 0.15);
    filt.Q.value         = 0.6;
    const gain = this._ctx.createGain();
    gain.gain.setValueAtTime(_v(vol, 0.1), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    noise.connect(filt);
    filt.connect(gain);
    gain.connect(this._masterGain);
    noise.start(t);
    noise.stop(t + dur);
  }

  // ── 💥  HIT — square wave drop, ~70ms ────────────────────────────────────
  // MOST IMPORTANT sound in the game.
  // Square wave gives the punchy "thud"; frequency drop = impact deceleration.
  _synthHit(t, vol) {
    const dur = 0.07;
    const osc  = this._ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(_v(220, 0.1), t);
    osc.frequency.exponentialRampToValueAtTime(_v(90, 0.08), t + dur);
    const gain = this._ctx.createGain();
    gain.gain.setValueAtTime(_v(vol, 0.08), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this._masterGain);
    osc.start(t);
    osc.stop(t + dur);
  }

  // ── 🩸  ENEMY HIT — lower-pitched version of hit, ~70ms ─────────────────
  // Slightly lower and softer — distinguishes enemy hits from player hits.
  _synthEnemyHit(t, vol) {
    const dur = 0.07;
    const osc  = this._ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(_v(160, 0.10), t);
    osc.frequency.exponentialRampToValueAtTime(_v(65, 0.08), t + dur);
    const gain = this._ctx.createGain();
    gain.gain.setValueAtTime(_v(vol * 0.85, 0.08), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this._masterGain);
    osc.start(t);
    osc.stop(t + dur);
  }

  // ── 💀  DEATH — sawtooth descend, ~300ms ─────────────────────────────────
  // Sawtooth is harsher than sine — communicates "destructive" drop.
  _synthDeath(t, vol) {
    const dur = 0.30;
    const osc  = this._ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(_v(300, 0.10), t);
    osc.frequency.exponentialRampToValueAtTime(50, t + dur);
    const gain = this._ctx.createGain();
    gain.gain.setValueAtTime(_v(vol, 0.08), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this._masterGain);
    osc.start(t);
    osc.stop(t + dur);
  }

  // ── ⚡  LIGHTNING — FM sine zap, ~100ms ───────────────────────────────────
  // LFO on frequency at 35Hz gives fast pitch shimmer = electric quality.
  // Triangle wave on the LFO is softer than square (less harsh at high speed).
  _synthLightning(t, vol) {
    const dur = 0.10;
    const osc  = this._ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(_v(800, 0.15), t);
    osc.frequency.exponentialRampToValueAtTime(_v(400, 0.12), t + dur);

    // LFO for pitch shimmer
    const lfo      = this._ctx.createOscillator();
    const lfoGain  = this._ctx.createGain();
    lfo.type             = 'triangle';
    lfo.frequency.value  = _v(38, 0.15);
    lfoGain.gain.value   = _v(320, 0.20);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    const gain = this._ctx.createGain();
    gain.gain.setValueAtTime(_v(vol, 0.10), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this._masterGain);

    lfo.start(t);  lfo.stop(t + dur);
    osc.start(t);  osc.stop(t + dur);
  }

  // ── 🔥  FIREBALL — noise burst + low rumble, ~120ms ──────────────────────
  // Two layers: high-pass noise for the "whoosh", low sine for the mass/weight.
  _synthFireball(t, vol) {
    const dur = 0.12;

    // Layer 1: filtered noise burst
    const noise = this._makeNoise(dur);
    const filt  = this._ctx.createBiquadFilter();
    filt.type            = 'lowpass';
    filt.frequency.value = _v(1200, 0.15);
    const noiseGain = this._ctx.createGain();
    noiseGain.gain.setValueAtTime(_v(vol * 0.7, 0.10), t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    noise.connect(filt);
    filt.connect(noiseGain);
    noiseGain.connect(this._masterGain);
    noise.start(t);
    noise.stop(t + dur);

    // Layer 2: low sine "weight" — the fireball has mass
    const osc  = this._ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(_v(90, 0.12), t);
    osc.frequency.exponentialRampToValueAtTime(40, t + dur);
    const oscGain = this._ctx.createGain();
    oscGain.gain.setValueAtTime(_v(vol * 0.5, 0.10), t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(oscGain);
    oscGain.connect(this._masterGain);
    osc.start(t);
    osc.stop(t + dur);
  }

  // ── 🛡️  SHIELD — soft sine pulse, fade-in + fade-out, ~180ms ────────────
  // Fade-in communicates "shield forming"; gentle decay = protective.
  _synthShield(t, vol) {
    const dur     = 0.18;
    const peakAt  = 0.05;
    const osc  = this._ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(_v(520, 0.08), t);
    osc.frequency.linearRampToValueAtTime(_v(480, 0.06), t + dur);
    const gain = this._ctx.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(_v(vol, 0.08), t + peakAt);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this._masterGain);
    osc.start(t);
    osc.stop(t + dur);
  }

  // ── ⚡  PULSE — rapid fizz, ~150ms ────────────────────────────────────────
  // Lightning pulse orbiting nodes: very rapid LFO rate for a "buzzing" feel.
  _synthPulse(t, vol) {
    const dur = 0.15;
    const osc  = this._ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(_v(600, 0.15), t);
    osc.frequency.exponentialRampToValueAtTime(_v(300, 0.12), t + dur);

    const lfo     = this._ctx.createOscillator();
    const lfoGain = this._ctx.createGain();
    lfo.type             = 'square';
    lfo.frequency.value  = _v(60, 0.20);  // faster than lightning for "orbit" feel
    lfoGain.gain.value   = _v(200, 0.15);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    const gain = this._ctx.createGain();
    gain.gain.setValueAtTime(_v(vol, 0.10), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this._masterGain);

    lfo.start(t);  lfo.stop(t + dur);
    osc.start(t);  osc.stop(t + dur);
  }

  // ── 📣  WARCRY — gritty sawtooth + formant, ~150ms ───────────────────────
  // Sawtooth through a bandpass filter simulates a shouted vowel.
  // Pitch rises briefly then falls = battle cry shape.
  _synthWarcry(t, vol) {
    const dur = 0.15;
    const osc  = this._ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(_v(160, 0.08), t);
    osc.frequency.linearRampToValueAtTime(_v(210, 0.06), t + 0.04);
    osc.frequency.exponentialRampToValueAtTime(130, t + dur);

    const formant  = this._ctx.createBiquadFilter();
    formant.type          = 'bandpass';
    formant.frequency.value = 750;
    formant.Q.value         = 2.5;

    const gain = this._ctx.createGain();
    gain.gain.setValueAtTime(_v(vol, 0.08), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(formant);
    formant.connect(gain);
    gain.connect(this._masterGain);
    osc.start(t);
    osc.stop(t + dur);
  }

  // ── 👣  STEP — filtered noise tap, ~40ms, very quiet ─────────────────────
  // Low-frequency noise + aggressive rolloff so it sits below all other sounds.
  _synthStep(t, vol) {
    const dur   = 0.04;
    const noise = this._makeNoise(dur);
    const filt  = this._ctx.createBiquadFilter();
    filt.type            = 'lowpass';
    filt.frequency.value = _v(280, 0.25);  // pitch varies most — footsteps should feel organic
    const gain = this._ctx.createGain();
    gain.gain.setValueAtTime(_v(vol, 0.15), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    noise.connect(filt);
    filt.connect(gain);
    gain.connect(this._masterGain);
    noise.start(t);
    noise.stop(t + dur);
  }

  // ── ✅  CONFIRM — clean sine tone, ~50ms ─────────────────────────────────
  _synthConfirm(t, vol) {
    const dur = 0.05;
    const osc  = this._ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = _v(880, 0.05);
    const gain = this._ctx.createGain();
    gain.gain.setValueAtTime(_v(vol, 0.06), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this._masterGain);
    osc.start(t);
    osc.stop(t + dur);
  }

  // ── 🖱️  CLICK — very short sine tick, ~30ms ──────────────────────────────
  _synthClick(t, vol) {
    const dur = 0.03;
    const osc  = this._ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = _v(620, 0.08);
    const gain = this._ctx.createGain();
    gain.gain.setValueAtTime(_v(vol, 0.06), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this._masterGain);
    osc.start(t);
    osc.stop(t + dur);
  }

  // ── 🌀  TELEPORT — rising sweep, ~200ms ──────────────────────────────────
  // Ascending pitch = "going somewhere"; fade-in emphasises activation moment.
  _synthTeleport(t, vol) {
    const dur = 0.20;
    const osc  = this._ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(_v(280, 0.10), t);
    osc.frequency.exponentialRampToValueAtTime(_v(1400, 0.10), t + dur);
    const gain = this._ctx.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(_v(vol, 0.08), t + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this._masterGain);
    osc.start(t);
    osc.stop(t + dur);
  }

  // ── 🏛️  ALTAR — mystical hum, ~220ms ─────────────────────────────────────
  // Two slightly detuned sines = hollow "ceremonial" quality.
  _synthAltar(t, vol) {
    const dur = 0.22;
    [_v(320, 0.04), _v(326, 0.04)].forEach(freq => {
      const osc  = this._ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = this._ctx.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(_v(vol * 0.5, 0.06), t + 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(this._masterGain);
      osc.start(t);
      osc.stop(t + dur);
    });
  }

  // ── 💎  REWARD — bright chime pair, ~200ms ───────────────────────────────
  // Two harmonically related sines (major third) = positive reinforcement.
  _synthReward(t, vol) {
    const dur = 0.20;
    [_v(1047, 0.04), _v(1319, 0.04)].forEach((freq, i) => {
      const osc  = this._ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = this._ctx.createGain();
      gain.gain.setValueAtTime(_v(vol * 0.55, 0.06), t + i * 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur + i * 0.025);
      osc.connect(gain);
      gain.connect(this._masterGain);
      osc.start(t + i * 0.025);
      osc.stop(t + dur + i * 0.025);
    });
  }

  // ── 🏆  LEVEL UP — ascending arpeggio, ~350ms ─────────────────────────────
  // Three staggered notes (C-E-G triad) = classic RPG level-up feel.
  // Short enough to not be annoying; clear enough to register.
  _synthLevelUp(t, vol) {
    const notes    = [523, 659, 784];  // C5 – E5 – G5
    const noteLen  = 0.10;
    const spacing  = 0.08;
    notes.forEach((freq, i) => {
      const start = t + i * spacing;
      const osc   = this._ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = _v(freq, 0.02);  // very small variation so chord sounds clean
      const gain = this._ctx.createGain();
      gain.gain.setValueAtTime(_v(vol * 0.7, 0.05), start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + noteLen);
      osc.connect(gain);
      gain.connect(this._masterGain);
      osc.start(start);
      osc.stop(start + noteLen);
    });
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /**
   * Create a white-noise AudioBufferSourceNode of `duration` seconds.
   * The buffer is created fresh each call — noise cannot be reused
   * because each play needs a unique random sequence.
   */
  _makeNoise(duration) {
    const sampleRate = this._ctx.sampleRate;
    const len        = Math.ceil(sampleRate * duration);
    const buf        = this._ctx.createBuffer(1, len, sampleRate);
    const data       = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this._ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  _onCooldown(soundId, cooldownMs) {
    return (performance.now() - (this._lastPlayed.get(soundId) ?? 0)) < cooldownMs;
  }

  _stamp(soundId) {
    this._lastPlayed.set(soundId, performance.now());
  }

  // ── Debug API ──────────────────────────────────────────────────────────────

  toggle() {
    this.enabled = !this.enabled;
    console.log(`[Audio] ${this.enabled ? '🔊 ON' : '🔇 OFF'}`);
  }

  setDebug(on) {
    this._debug = !!on;
    console.log(`[Audio] debug ${this._debug ? 'ON' : 'OFF'}`);
  }

  /**
   * Test-play any sound by its ID, bypassing cooldown.
   * Usage: __debug.audio.test('combat.hit')
   */
  testPlay(soundId) {
    if (!this.enabled) return;
    const def = SYNTH_MAP[soundId];
    if (!def) { console.warn(`[Audio] Unknown sound: "${soundId}"`); return; }
    this._ensureContext();
    if (this._ctx?.state === 'suspended') this._ctx.resume();
    this._synth(def.type, def.vol);
    console.log(`[Audio] test ▶ "${soundId}"  type=${def.type}`);
  }

  inspect() {
    console.group('[AudioSystem] Procedural');
    console.log(`enabled : ${this.enabled}`);
    console.log(`volume  : ${(this._volume * 100).toFixed(0)}%`);
    console.log(`ctx     : ${this._ctx?.state ?? 'not created'}`);
    console.log(`sounds  : ${ALL_SOUND_IDS.length} registered (procedural — no files)`);
    console.groupEnd();
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

/**
 * Apply variation to a value.
 * Returns value × (1 ± amount × random), bounded so it stays positive.
 *
 * @param {number} value   — base value
 * @param {number} amount  — fractional variation range (default 0.10 = ±10%)
 */
function _v(value, amount = 0.10) {
  return value * (1 - amount + Math.random() * amount * 2);
}
