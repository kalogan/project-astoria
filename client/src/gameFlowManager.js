// Game flow manager — tracks game states and guides the player experience.
//
// States: boot → main_menu → loading → in_world → in_dungeon → game_over
//
// Also owns the onboarding tutorial (4 steps) and death screen.
// Lightweight: no DOM framework, pure event-driven.

const STATES = new Set([
  'boot', 'main_menu', 'loading', 'in_world', 'in_dungeon', 'game_over',
]);

const TUTORIAL_STEPS = [
  { id: 'move',    hint: 'Move with WASD',               trigger: 'player_moved'  },
  { id: 'attack',  hint: 'Click to attack enemies',      trigger: 'enemy_damaged' },
  { id: 'ability', hint: 'Press Q or F to use abilities', trigger: 'ability_used'  },
  { id: 'quest',   hint: 'Complete your first quest!',   trigger: 'quest_complete' },
];

export class GameFlowManager {
  constructor(hud) {
    this._hud           = hud;
    this._state         = 'boot';
    this._eventBus      = null;
    this._tutorialStep  = 0;
    this._tutorialDone  = false;
    this._tutorialEl    = null;
    this._deathOverlay  = null;
    this.enabled        = true;
  }

  init(eventBus) {
    this._eventBus = eventBus;

    eventBus.on('dungeon_started',    ()            => this._setState('in_dungeon'));
    eventBus.on('dungeon_completed',  ({ payload }) => this._onDungeonCompleted(payload));
    eventBus.on('dungeon_failed',     ()            => this._onDungeonFailed());
    eventBus.on('player_damaged',     ({ payload }) => { if (payload.hp <= 0) this._onPlayerDied(); });
    eventBus.on('level_up',           ({ payload }) => this._onLevelUp(payload));
    eventBus.on('difficulty_increased',({ payload }) => this._onDifficultyUp(payload));

    // Tutorial event watchers — each step listens for its trigger
    const watch = (trigger, stepId) => {
      eventBus.on(trigger, () => this._advanceTutorial(stepId));
    };
    for (const step of TUTORIAL_STEPS) watch(step.trigger, step.id);
  }

  // ── Public controls ───────────────────────────────────────────────────────

  getState() { return this._state; }

  startTutorial() {
    if (this._tutorialDone) return;
    this._tutorialStep = 0;
    this._showTutorialHint();
  }

  skipTutorial() {
    this._tutorialDone = true;
    this._clearTutorialHint();
    console.log('[GameFlow] Tutorial skipped');
  }

  // ── State machine ─────────────────────────────────────────────────────────

  _setState(next) {
    if (!STATES.has(next)) { console.warn(`[GameFlow] Unknown state: ${next}`); return; }
    const prev   = this._state;
    this._state  = next;
    this._eventBus?.emit('game_state_changed', { state: next, prev });
    console.log(`[GameFlow] ${prev} → ${next}`);
  }

  // ── Tutorial ──────────────────────────────────────────────────────────────

  _advanceTutorial(stepId) {
    if (!this.enabled || this._tutorialDone) return;
    const step = TUTORIAL_STEPS[this._tutorialStep];
    if (!step || step.id !== stepId) return;

    this._eventBus?.emit('tutorial_step_completed', { stepId });
    this._tutorialStep++;

    if (this._tutorialStep >= TUTORIAL_STEPS.length) {
      this._tutorialDone = true;
      this._clearTutorialHint();
      this._hud?.showBanner('Tutorial Complete!', '#2ecc71', 2200);
      this._eventBus?.emit('tutorial_completed', {});
    } else {
      this._showTutorialHint();
    }
  }

  _showTutorialHint() {
    const step = TUTORIAL_STEPS[this._tutorialStep];
    if (!step) return;

    this._clearTutorialHint();

    const el = document.createElement('div');
    Object.assign(el.style, {
      position:      'fixed',
      bottom:        '130px',
      left:          '50%',
      transform:     'translateX(-50%)',
      background:    'rgba(0,0,0,0.72)',
      color:         '#f39c12',
      fontSize:      '13px',
      padding:       '6px 18px',
      borderRadius:  '20px',
      letterSpacing: '0.5px',
      pointerEvents: 'none',
      zIndex:        '100',
      border:        '1px solid rgba(243,156,18,0.35)',
    });
    el.textContent = step.hint;
    document.body.appendChild(el);
    this._tutorialEl = el;

    this._eventBus?.emit('tutorial_step_started', { stepId: step.id, hint: step.hint });
  }

  _clearTutorialHint() {
    this._tutorialEl?.remove();
    this._tutorialEl = null;
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  _onDungeonCompleted(payload) {
    this._setState('in_world');
    this._hud?.showBanner('DUNGEON COMPLETE!', '#f39c12', 3000);
    const xp = payload.xpReward ?? 0;
    if (xp > 0) this._hud?.showProgress(`+${xp} XP`, '#2ecc71');
  }

  _onDungeonFailed() {
    this._setState('in_world');
    this._hud?.showBanner('DUNGEON FAILED', '#e74c3c', 3000);
  }

  _onLevelUp(payload) {
    this._hud?.showBanner(`LEVEL UP!  LV ${payload.level}`, '#3498db', 2400);
  }

  _onDifficultyUp(payload) {
    this._hud?.showProgress(`Difficulty: Tier ${payload.tier}`, '#9b59b6');
  }

  _onPlayerDied() {
    if (this._state === 'game_over') return;
    this._setState('game_over');
    this._showDeathScreen();
  }

  // ── Death screen ──────────────────────────────────────────────────────────

  _showDeathScreen() {
    if (this._deathOverlay) return;

    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position:       'fixed',
      top:            '0', left: '0',
      width:          '100%', height: '100%',
      background:     'rgba(0,0,0,0.75)',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      zIndex:         '999',
    });

    const title = _el('div', {
      color: '#e74c3c', fontSize: '52px', fontWeight: 'bold',
      letterSpacing: '7px', marginBottom: '28px',
    }, 'YOU DIED');

    const hint = _el('div', {
      color: '#888', fontSize: '13px', letterSpacing: '1px',
    }, 'Press R to respawn');

    overlay.append(title, hint);
    document.body.appendChild(overlay);
    this._deathOverlay = overlay;

    const onKey = (e) => {
      if (e.key.toLowerCase() !== 'r') return;
      window.removeEventListener('keydown', onKey);
      overlay.remove();
      this._deathOverlay = null;
      this._setState('in_world');
      this._eventBus?.emit('player_respawn', {});
    };
    window.addEventListener('keydown', onKey);
  }

  // ── Debug ─────────────────────────────────────────────────────────────────

  inspect() {
    console.log(`[GameFlow] state=${this._state}  tutorial=${this._tutorialStep}/${TUTORIAL_STEPS.length}  done=${this._tutorialDone}`);
  }

  forceState(s) { this._setState(s); }
}

function _el(tag, styles, text) {
  const e = document.createElement(tag);
  Object.assign(e.style, styles);
  if (text) e.textContent = text;
  return e;
}
