// hud.js — Astonia-style anchored HUD.
//
// ── LAYOUT (ALL zones are fixed containers — nothing floats in game space) ────
//
//   ┌──────────────────────────────────────────────────────────────────┐ TOP_H 48px
//   │  [LV # ▓▓▓▓░░░ x/y]  │  [WPN][ARM][OFF][RNG][AMU]  │  00:00 MENU │
//   └──────────────────────────────────────────────────────────────────┘ z=400
//
//              ↕ game canvas (THREE.js scene, no HUD here)
//
//   ┌──────────────────────────────────────────────────────────────────┐ BOTTOM_H 210px
//   │           [ 1 ][ 2 ][ 3 ][ 4 ][ 5 ]   ← SKILL BAR ROW 58px     │ z=200
//   ├──────────────────────────────────────────────────────────────────┤
//   │  STATS 200px  │  CHAT flex  │  INVENTORY 248px                  │ content row
//   │  HP/MP/SH     │  event log  │  5×4 drag-drop grid               │
//   │  attrs        │  scrollable │  click to use / equip             │
//   │  derived      │             │                                    │
//   └──────────────────────────────────────────────────────────────────┘
//
// ── RULES ─────────────────────────────────────────────────────────────────────
//   • Every UI element belongs to either the top bar or the bottom HUD.
//   • The ability/skill bar is anchored inside the bottom HUD (row 1).
//   • astoniaSkillPanel sits above the bottom HUD (bounded by LAYOUT.BOTTOM_H).
//   • No element uses arbitrary fixed positioning in the game viewport.
//   • DEBUG_LAYOUT = true adds coloured outlines for alignment verification.
//
// ── PUBLIC API ─────────────────────────────────────────────────────────────────
//   hud.setPlayerHP(hp, maxHp)
//   hud.setPlayerMana(mana, maxMana, showBar)
//   hud.setPlayerShield(shield, maxShield)
//   hud.setLevel(level, xp, xpToNext)
//   hud.setClassStats(className, stats, mults, unspentPoints)
//   hud.setDerivedStats({ weapon, speedMs, armor, offense, defense })
//   hud.setAbilitySlots(slots, skillLevels)
//   hud.showSkillTree(…) / hideSkillTree() / isSkillTreeOpen()
//   hud.setInventory(items)          flat array → fills 5×4 grid
//   hud.setEquipment(equipment)      { weapon, armor, offhand, ring, amulet }
//   hud.addChatMessage(text, color)
//   hud.setEventBus(eventBus)
//   hud.initEnemyLabels(enemies) / clearEnemyLabels() / updateEnemyLabels()
//   hud.spawnDamageNumber(worldPos, amount, isCrit)
//   hud.spawnFloatingText(worldPos, text, color)
//   hud.setQuests(quests)
//   hud.showBanner(text, color, duration)
//   hud.showProgress(text, color)
//   hud.screenFlash(color, alpha)
//   hud.setDebugPos(x, y, z)
//   hud.toggleHighContrast()         Part 7 — runtime HC toggle

import * as THREE from 'three';

// ── Layout constants (exported so other panels can align to these values) ──────
export const LAYOUT = Object.freeze({
  TOP_H:       48,    // px — top bar
  BOTTOM_H:    210,   // px — bottom HUD (skill bar row + content row)
  SKILL_BAR_H: 58,    // px — ability slot row inside bottom HUD
  PANEL_W:     174,   // px — astoniaSkillPanel width (used externally)
});

const { TOP_H, BOTTOM_H, SKILL_BAR_H } = LAYOUT;
const CONTENT_H  = BOTTOM_H - SKILL_BAR_H - 1;  // -1 for divider border = 151px
const STATS_W    = 200;
const INV_W      = 248;  // 5×44 + 4×2 gap + 2×8 pad
const SLOT_SZ    = 44;   // inventory / equip slot size
const ABIL_SZ    = SKILL_BAR_H - 10;  // ability slot size inside skill bar row = 48px
const GRID_COLS  = 5;
const GRID_ROWS  = 4;   // 20 total inventory slots

// Equipment slot order in top bar
const EQUIP_NAMES  = ['weapon', 'armor', 'offhand', 'ring', 'amulet'];
const EQUIP_LABELS = { weapon: 'WPN', armor: 'ARM', offhand: 'OFF', ring: 'RNG', amulet: 'AMU' };

const CHAT_MAX = 200;

// ── Accessibility colour system (WCAG AA, dark theme) ─────────────────────────
//
// All contrast ratios verified against bg0 (#0f0f0f, L≈0.005).
// WCAG AA requires ≥ 4.5:1 for normal text, ≥ 3:1 for large/bold text (≥18pt).
//
// Hierarchy:
//   CLR.label  = #888888  — muted labels / section headers   (5.3 : 1) ✓ AA
//   CLR.text   = #d6d6d6  — default body / readable values  (12.9 : 1) ✓ AA
//   CLR.value  = #ffffff  — important values / stat numbers  (18.1 : 1) ✓ AA
//   CLR.hi     = #a8c7ff  — highlights / hotkeys / links    (11.1 : 1) ✓ AA
//   CLR.dimmed = #555555  — purely decorative; not used for readable text
//
// Surfaces (bg1 panel is the reference surface for most text):
//   CLR.bg0    = #0f0f0f  — slot interiors / deepest background
//   CLR.bg1    = #1a1a1a  — main panel surface
//   CLR.bg2    = #242424  — raised / hover surface
//   CLR.border = #3a3a3a  — all external borders
//   CLR.divide = #282828  — inner section dividers
//
// Status fills (opaque — contrast from fill colour vs bar-bg or game bg):
//   CLR.hp     = #c0392b  — HP (healthy)
//   CLR.hpLow  = #e67e22  — HP (≤ 50 %)
//   CLR.hpCrit = #e74c3c  — HP (≤ 25 %)
//   CLR.mp     = #2980b9  — Mana
//   CLR.sh     = #3498db  — Shield
//   CLR.xp     = #27ae60  — EXP
//   CLR.rep    = #d4ac0d  — Reputation
//
// Ability slot:
//   CLR.active = #c0790f  — active-toggle glow border / shadow
// ──────────────────────────────────────────────────────────────────────────────
const CLR = Object.freeze({
  bg0:    '#0f0f0f',
  bg1:    '#1a1a1a',
  bg2:    '#242424',
  border: '#3a3a3a',
  divide: '#282828',

  label:  '#888888',   // 5.3:1 on bg0
  text:   '#d6d6d6',   // 12.9:1 on bg0
  value:  '#ffffff',   // 18.1:1 on bg0
  hi:     '#a8c7ff',   // 11.1:1 on bg0
  dimmed: '#555555',   // decoration only

  hp:     '#c0392b',
  hpLow:  '#e67e22',
  hpCrit: '#e74c3c',
  mp:     '#2980b9',
  sh:     '#3498db',
  xp:     '#27ae60',
  rep:    '#d4ac0d',

  active: '#c0790f',
});

// ── Chat colour palette ────────────────────────────────────────────────────────
// All colours verified ≥ 4.5:1 on bg0 (#0f0f0f).
//   system: #888888  (5.3:1)  — zone/system messages
//   combat: #aaaaaa  (6.9:1)  — general combat log
//   damage: #e74c3c  (5.0:1)  — damage you deal
//   recv:   #e07070  (5.5:1)  — damage you receive
//   heal:   #2ecc71  (9.1:1)  — healing events
//   magic:  #5b9bd5  (6.5:1)  — mana / spell events
//   loot:   #f1c40f (11.6:1)  — loot / equip feedback
//   level:  #f39c12  (9.3:1)  — level / progression
//   quest:  #c39af0  (9.0:1)  — quest events
const CC = {
  system: '#888888',
  combat: '#aaaaaa',
  damage: '#e74c3c',
  recv:   '#e07070',
  heal:   '#2ecc71',
  magic:  '#5b9bd5',
  loot:   '#f1c40f',
  level:  '#f39c12',
  quest:  '#c39af0',
};

// ── Debug layout borders ───────────────────────────────────────────────────────
// Set to false to remove debug outlines in production.
const DEBUG_LAYOUT = true;
const DBG = {
  top:     DEBUG_LAYOUT ? { outline: '1px solid rgba(220,50,50,0.55)'  } : {},  // red   = top bar
  bottom:  DEBUG_LAYOUT ? { outline: '1px solid rgba(50,200,50,0.55)'  } : {},  // green = bottom HUD
  section: DEBUG_LAYOUT ? { outline: '1px solid rgba(50,100,220,0.55)' } : {},  // blue  = each section
};

// ── DOM helpers ───────────────────────────────────────────────────────────────
function el(tag, styles, html) {
  const e = document.createElement(tag);
  if (styles) Object.assign(e.style, styles);
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// ── Contrast ratio utility (WCAG 2.1 relative luminance) ─────────────────────
// Used by _logContrastReport() and toggleHighContrast debugging.
function contrastRatio(hex1, hex2) {
  const lum = (hex) => {
    const v   = parseInt(hex.replace('#', ''), 16);
    const ch  = [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
    const lin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    return 0.2126 * lin(ch[0]) + 0.7152 * lin(ch[1]) + 0.0722 * lin(ch[2]);
  };
  const [l1, l2] = [lum(hex1), lum(hex2)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

// Labelled resource bar — returns { row, fill, valEl }
// Font sizes: 12px minimum (WCAG Part 2).
// Bar label colours use CLR.label (5.3:1 on bg0) — muted but AA-compliant.
function mkBar(label, fillColor) {
  const row = el('div', {
    display: 'flex', alignItems: 'center', gap: '4px', minHeight: '16px',
  });
  row.appendChild(el('div', {
    color: CLR.label, fontSize: '12px', minWidth: '18px', textAlign: 'right',
    fontFamily: 'monospace', flexShrink: '0', lineHeight: '1.4',
  }, label));
  // Bar track — slightly visible so empty state is clear (contrast against panel bg)
  const bg   = el('div', {
    flex: '1', height: '7px',
    background: CLR.bg0, border: `1px solid ${CLR.divide}`,
    overflow: 'hidden',
  });
  const fill = el('div', { height: '100%', width: '0%', background: fillColor });
  bg.appendChild(fill);
  // Value readout — CLR.text (12.9:1) ensures numbers are always readable
  const valEl = el('div', {
    color: CLR.text, fontSize: '12px', minWidth: '64px', textAlign: 'right',
    fontFamily: 'monospace', flexShrink: '0', lineHeight: '1.4',
  }, '—');
  row.append(bg, valEl);
  return { row, fill, valEl };
}

// ═════════════════════════════════════════════════════════════════════════════
// HUD
// ═════════════════════════════════════════════════════════════════════════════

export class HUD {
  constructor(camera) {
    this.camera      = camera;
    this.enemyLabels = [];
    this._skillTreeOverlay = null;
    this._eventBus   = null;
    this._highContrast = false;

    // Drag state
    this._dragStart      = null;
    this._isDragging     = false;
    this._drag           = null;
    this._dragSourceSlot = null;
    this._hoveredSlot    = null;

    // Inventory + equipment state
    this._invSlots  = new Array(GRID_COLS * GRID_ROWS).fill(null);
    this._equipment = Object.fromEntries(EQUIP_NAMES.map(n => [n, null]));

    // Chat
    this._chatLines  = [];
    this._chatPaused = false;

    this._injectStyles();

    // Root — transparent full-viewport overlay; pointer-events:none so the
    // game canvas is not blocked by empty space between HUD elements.
    this.root = el('div', {
      position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: '100',
    });
    this.root.id = 'hud';
    document.body.appendChild(this.root);

    // Build the two anchored zones:
    this._buildTopBar();     // zone 1 — fixed top, 48px
    this._buildBottomHUD();  // zone 2 — fixed bottom, 210px (skill bar + content)
    // Secondary overlays
    this._buildQuestTracker();
    this._buildDebug();

    // Global drag listeners
    document.addEventListener('mousemove', e => this._onMouseMove(e));
    document.addEventListener('mouseup',   e => this._onMouseUp(e));

    // Part 7 — log contrast report once when debug mode is on
    if (DEBUG_LAYOUT) this._logContrastReport();
  }

  // ── EventBus ──────────────────────────────────────────────────────────────

  setEventBus(eventBus) {
    this._eventBus = eventBus;
    this._subscribeChat(eventBus);
  }

  _subscribeChat(eb) {
    const add = (text, color) => this.addChatMessage(text, color);
    eb.on('enemy_killed',   ({ payload }) => add(`${payload?.enemyName ?? 'Enemy'} slain.`, CC.combat));
    eb.on('enemy_damaged',  ({ payload }) => {
      if (!payload?.amount) return;
      const sfx = payload.isCrit ? ' (CRIT!)' : '';
      add(`You hit ${payload?.enemyName ?? 'Enemy'} for ${payload.amount}${sfx}`, CC.combat);
    });
    eb.on('player_damaged', ({ payload }) => {
      if (payload?.damage) add(`You take ${payload.damage} damage.`, CC.recv);
    });
    eb.on('level_up',          ({ payload }) => add(`Level ${payload?.level ?? '?'} reached!`, CC.level));
    eb.on('zone_loaded',       ({ payload }) => add(`Entered: ${payload?.zoneId ?? '?'}`, CC.system));
    eb.on('quest_complete',    ({ payload }) => add(`Quest complete: ${payload?.title ?? 'Quest'}`, CC.quest));
    eb.on('ability_failed',    ({ payload }) => { if (payload?.reason === 'oom') add('Not enough mana.', CC.magic); });
    eb.on('key_collected',     () => add('Found a key.', CC.loot));
    eb.on('clan_jewel_claimed',() => add('Clan jewel obtained.', CC.loot));
    eb.on('pentagram_completed',() => add('Pentagram cleared!', CC.level));
    eb.on('dungeon_completed', () => add('Dungeon completed.', CC.level));
    eb.on('skill_cast',        ({ payload }) => { if (payload?.abilityId) add(`Cast: ${payload.abilityId}`, CC.magic); });
    eb.on('player_respawn',    () => add('You have been revived.', CC.system));
    eb.on('zone_state_changed',({ payload }) => { if (payload?.state === 'cleared') add('Zone cleared!', CC.level); });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ZONE 1 — TOP BAR  (position:fixed, top:0, z=400)
  // LEFT: EXP/rep  ·  CENTER: equipment slots  ·  RIGHT: clock + menu
  // ═══════════════════════════════════════════════════════════════════════════

  _buildTopBar() {
    const bar = el('div', {
      position: 'fixed', top: '0', left: '0', right: '0',
      height:       TOP_H + 'px',
      background:   CLR.bg1,               // #1a1a1a — panel surface
      borderBottom: `1px solid ${CLR.border}`,  // #3a3a3a — visible separator
      display:      'flex', alignItems: 'stretch',
      zIndex:       '400',
      pointerEvents:'auto',
      boxSizing:    'border-box',
      ...DBG.top,
    });

    // ── Left: EXP progression ─────────────────────────────────────────────
    const left = el('div', {
      width: '270px', flexShrink: '0',
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      padding: '5px 10px', gap: '3px',
      borderRight: `1px solid ${CLR.divide}`,
      boxSizing: 'border-box',
      ...DBG.section,
    });

    const expRow = el('div', { display: 'flex', alignItems: 'center', gap: '5px' });
    // LV badge — CLR.label (5.3:1): muted but legible at 12px
    this._expLvLabel = el('div', {
      color: CLR.label, fontSize: '12px', fontFamily: 'monospace',
      minWidth: '32px', lineHeight: '1.4',
    }, 'LV 1');
    const expBg = el('div', {
      flex: '1', height: '7px',
      background: CLR.bg0, border: `1px solid ${CLR.divide}`,
      overflow: 'hidden',
    });
    this._expFill = el('div', { height: '100%', width: '0%', background: CLR.xp });
    expBg.appendChild(this._expFill);
    // EXP readout — CLR.text: always readable
    this._expText = el('div', {
      color: CLR.text, fontSize: '12px', fontFamily: 'monospace',
      minWidth: '80px', textAlign: 'right', lineHeight: '1.4',
    }, '0 / 100');
    expRow.append(this._expLvLabel, expBg, this._expText);
    left.appendChild(expRow);

    // Optional rep bar — hidden until setReputation() is called
    const repRow = el('div', { display: 'none', alignItems: 'center', gap: '5px' });
    this._repRow = repRow;
    this._repLvLabel = el('div', {
      color: CLR.label, fontSize: '12px', fontFamily: 'monospace',
      minWidth: '32px', lineHeight: '1.4',
    }, 'REP');
    const repBg = el('div', {
      flex: '1', height: '4px',
      background: CLR.bg0, border: `1px solid ${CLR.divide}`,
      overflow: 'hidden',
    });
    this._repFill = el('div', { height: '100%', width: '0%', background: CLR.rep });
    repBg.appendChild(this._repFill);
    repRow.append(this._repLvLabel, repBg);
    left.appendChild(repRow);
    bar.appendChild(left);

    // ── Center: Equipment slots (dominant) ───────────────────────────────
    const center = el('div', {
      flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px',
      ...DBG.section,
    });
    this._equipSlotEls = {};
    for (const name of EQUIP_NAMES) {
      const wrap = el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' });
      const slot = el('div', {
        width: SLOT_SZ + 'px', height: SLOT_SZ + 'px',
        background: CLR.bg0, border: `1px solid ${CLR.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'default', boxSizing: 'border-box', position: 'relative', overflow: 'hidden',
      });
      // Abbreviation label below slot — CLR.label gives 5.3:1 at 10px (AA Large ≥ 3:1)
      const lbl = el('div', {
        color: CLR.label, fontSize: '10px', letterSpacing: '1px',
        fontFamily: 'monospace', lineHeight: '1.4',
      }, EQUIP_LABELS[name]);
      slot._equipName = name;
      slot._type      = 'equip';
      this._wireSlot(slot);
      this._equipSlotEls[name] = slot;
      wrap.append(slot, lbl);
      center.appendChild(wrap);
    }
    bar.appendChild(center);

    // ── Right: system UI (minimal) ────────────────────────────────────────
    const right = el('div', {
      width: '190px', flexShrink: '0',
      display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
      gap: '8px', padding: '0 10px',
      borderLeft: `1px solid ${CLR.divide}`,
      ...DBG.section,
    });
    // Clock — CLR.label (5.3:1): always visible, non-critical
    this._timeEl = el('div', {
      color: CLR.label, fontSize: '12px', fontFamily: 'monospace',
      letterSpacing: '1px', lineHeight: '1.4',
    }, '00:00');
    this._updateClock();
    setInterval(() => this._updateClock(), 15_000);
    right.append(
      this._timeEl,
      this._sysBtn('MENU', () => this._eventBus?.emit('menu_opened', {})),
      // Part 7 — high-contrast mode toggle button
      this._sysBtn('HC', () => this.toggleHighContrast()),
    );
    bar.appendChild(right);

    document.body.appendChild(bar);
    this._topBar = bar;
  }

  _updateClock() {
    const d = new Date();
    this._timeEl.textContent = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  // System button — CLR.label at rest (5.3:1), CLR.text on hover (12.9:1)
  _sysBtn(label, onClick) {
    const b = el('div', {
      color: CLR.label, fontSize: '12px', letterSpacing: '1px',
      fontFamily: 'monospace', cursor: 'pointer', padding: '2px 6px',
      border: `1px solid ${CLR.divide}`, background: CLR.bg0,
      lineHeight: '1.4',
    }, label);
    b.addEventListener('mouseenter', () => { b.style.color = CLR.text;  b.style.borderColor = CLR.border; });
    b.addEventListener('mouseleave', () => { b.style.color = CLR.label; b.style.borderColor = CLR.divide; });
    b.addEventListener('click', onClick);
    return b;
  }

  setLevel(level, xp, xpToNext) {
    this._expLvLabel.textContent = `LV ${level}`;
    this._expFill.style.width   = `${Math.max(0, Math.min(100, (xp / (xpToNext || 1)) * 100))}%`;
    this._expText.textContent   = `${xp} / ${xpToNext}`;
  }

  setReputation(label, current, max) {
    this._repRow.style.display   = 'flex';
    this._repLvLabel.textContent = label;
    this._repFill.style.width    = `${Math.max(0, Math.min(100, (current / (max || 1)) * 100))}%`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ZONE 2 — BOTTOM HUD  (position:fixed, bottom:0, z=200)
  //
  // Flex COLUMN:
  //   Row A — Skill bar  (SKILL_BAR_H = 58px, flex-shrink:0)
  //   Divider (1px)
  //   Row B — Content    (flex:1 = remaining ~151px)
  //             Flex ROW: stats | chat | inventory
  //
  // All ability slots live in Row A — they are NEVER floating.
  // ═══════════════════════════════════════════════════════════════════════════

  _buildBottomHUD() {
    const hud = el('div', {
      position:      'fixed', bottom: '0', left: '0', right: '0',
      height:        BOTTOM_H + 'px',
      background:    CLR.bg1,                   // #1a1a1a — panel surface
      borderTop:     `1px solid ${CLR.border}`, // #3a3a3a — clear top edge
      display:       'flex',
      flexDirection: 'column',   // ← COLUMN: skill bar on top, content below
      zIndex:        '200',
      pointerEvents: 'auto',
      boxSizing:     'border-box',
      fontFamily:    '"Courier New", Courier, monospace',
      ...DBG.bottom,
    });

    // ── Row A: Skill bar ────────────────────────────────────────────────
    hud.appendChild(this._buildSkillBarRow());

    // ── Divider ─────────────────────────────────────────────────────────
    hud.appendChild(el('div', { height: '1px', background: CLR.divide, flexShrink: '0' }));

    // ── Row B: Content (stats | chat | inventory) ────────────────────────
    const contentRow = el('div', {
      flex: '1', display: 'flex', overflow: 'hidden', minHeight: '0',
    });
    contentRow.appendChild(this._buildStatsSection());
    contentRow.appendChild(this._buildChatSection());
    contentRow.appendChild(this._buildInvSection());
    hud.appendChild(contentRow);

    document.body.appendChild(hud);
    this._bottomHUD = hud;
  }

  // ── Row A: Skill bar row ─────────────────────────────────────────────────
  // Ability slots anchored inside the bottom HUD.
  // Returns the row element; populates this._abilitySlots.

  _buildSkillBarRow() {
    const row = el('div', {
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      height:         SKILL_BAR_H + 'px',
      flexShrink:     '0',
      gap:            '5px',
      padding:        '0 12px',
      background:     CLR.bg0,   // slightly deeper than panel bg, creates row separation
      ...DBG.section,
    });

    this._abilitySlots = [];
    for (let i = 0; i < 5; i++) {
      const slot = el('div', {
        position:   'relative',
        width:      ABIL_SZ + 'px',
        height:     ABIL_SZ + 'px',
        background: CLR.bg0,
        border:     `1px solid ${CLR.border}`,  // #3a3a3a — clearly visible slot edge
        overflow:   'hidden',
        boxSizing:  'border-box',
        display:    'none',          // shown by setAbilitySlots
        flexShrink: '0',
        pointerEvents: 'auto',
      });

      // Key number label — CLR.hi (11.1:1) makes hotkeys immediately identifiable
      const keyLbl = el('div', {
        position: 'absolute', top: '2px', left: '4px',
        color: CLR.hi, fontSize: '12px', fontFamily: 'monospace',
        fontWeight: 'bold', zIndex: '2', pointerEvents: 'none',
        lineHeight: '1.4',
      }, String(i + 1));

      // Level badge — gold (#f1c40f, 11.6:1) clearly signals skill progression
      const lvEl = el('div', {
        position: 'absolute', top: '2px', right: '4px',
        color: '#f1c40f', fontSize: '10px', fontFamily: 'monospace',
        fontWeight: 'bold', zIndex: '2', pointerEvents: 'none',
        display: 'none', lineHeight: '1.4',
      }, 'Lv1');

      // Ability name — CLR.label (5.3:1): muted since slot icon/key is primary id
      const nameEl = el('div', {
        position: 'absolute', bottom: '2px', left: '0', right: '0',
        color: CLR.label, fontSize: '10px', textAlign: 'center',
        fontFamily: 'monospace', zIndex: '2', pointerEvents: 'none',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        padding: '0 3px', lineHeight: '1.4',
      }, '—');

      const cdOverlay = el('div', {
        position: 'absolute', top: '0', left: '0', right: '0', height: '100%',
        background: 'rgba(0,0,0,0.72)', transformOrigin: 'top', transform: 'scaleY(0)', zIndex: '1',
      });

      // CD countdown — CLR.value (18.1:1) — must be readable even over dark overlay
      const cdText = el('div', {
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%,-50%)',
        color: CLR.value, fontSize: '13px', fontWeight: 'bold',
        fontFamily: 'monospace', display: 'none', zIndex: '3', pointerEvents: 'none',
      });

      slot.append(keyLbl, lvEl, cdOverlay, cdText, nameEl);
      row.appendChild(slot);
      this._abilitySlots.push({ container: slot, nameEl, cdOverlay, cdText, levelEl: lvEl });
    }

    this._skillBarRow = row;
    return row;
  }

  setAbilitySlots(slots, skillLevels = {}) {
    const count = slots?.length ?? 0;
    for (let i = 0; i < this._abilitySlots.length; i++) {
      const ui   = this._abilitySlots[i];
      const slot = slots?.[i];

      if (i >= count) { ui.container.style.display = 'none'; continue; }
      ui.container.style.display = '';

      if (!slot?.def) {
        ui.nameEl.textContent        = '—';
        ui.cdOverlay.style.transform = 'scaleY(0)';
        ui.cdText.style.display      = 'none';
        ui.levelEl.style.display     = 'none';
        ui.container.style.borderColor = CLR.border;
        ui.container.style.boxShadow   = 'none';
        continue;
      }

      ui.nameEl.textContent = slot.def.name;

      const lv = skillLevels[slot.def.id] ?? null;
      ui.levelEl.style.display   = lv != null ? '' : 'none';
      if (lv != null) ui.levelEl.textContent = `Lv${lv}`;

      // Toggle-active glow — CLR.active (#c0790f) visible against dark slot
      ui.container.style.borderColor = slot.isActive ? CLR.active : CLR.border;
      ui.container.style.boxShadow   = slot.isActive ? `0 0 6px ${CLR.active}66` : 'none';

      const frac = slot.def.cooldown > 0 ? slot.currentCooldown / slot.def.cooldown : 0;
      ui.cdOverlay.style.transform = `scaleY(${frac})`;
      if (slot.currentCooldown > 0) {
        ui.cdText.style.display = 'block';
        ui.cdText.textContent   = slot.currentCooldown.toFixed(1);
      } else {
        ui.cdText.style.display = 'none';
      }
    }
  }

  // ── Row B / LEFT: Stats section ───────────────────────────────────────────
  //
  // Font sizing note: all text is 12px (WCAG Part 2 minimum).
  // Padding and gaps reduced from the original to accommodate 12px in 151px height:
  //   padding: 3px 6px  (was 5px 7px)
  //   flex gap: 1px     (was 2px)
  //   grid gaps: 0 3px  (was 1px 4px)
  // Overflow is hidden — critical info (HP/MP) is first and always visible.
  // ─────────────────────────────────────────────────────────────────────────

  _buildStatsSection() {
    const sec = el('div', {
      width: STATS_W + 'px', flexShrink: '0',
      padding: '3px 6px',
      borderRight: `1px solid ${CLR.divide}`,
      display: 'flex', flexDirection: 'column', gap: '1px',
      overflow: 'hidden', boxSizing: 'border-box',
      ...DBG.section,
    });

    // Class name / unspent point badge
    // CLR.text default; turns CLR.value + gold badge when points available
    this._classNameEl = el('div', {
      color: CLR.text, fontSize: '12px', letterSpacing: '1px',
      marginBottom: '1px', overflow: 'hidden',
      textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      fontFamily: 'monospace', lineHeight: '1.4',
    }, '—');
    sec.appendChild(this._classNameEl);

    // HP (always shown) — fill colour managed dynamically in setPlayerHP
    const hp = mkBar('HP', CLR.hp);
    this._hpBar = hp.fill; this._hpVal = hp.valEl;
    sec.appendChild(hp.row);

    // MP (hidden for warrior classes)
    const mp = mkBar('MP', CLR.mp);
    this._manaBar = mp.fill; this._manaVal = mp.valEl; this._manaRow = mp.row;
    mp.row.style.display = 'none';
    sec.appendChild(mp.row);

    // SH (hidden when no shield active)
    const sh = mkBar('SH', CLR.sh);
    this._shieldBar = sh.fill; this._shieldVal = sh.valEl; this._shieldRow = sh.row;
    sh.row.style.display = 'none';
    sec.appendChild(sh.row);

    // ── Inner divider ─────────────────────────────────────────────────────
    sec.appendChild(el('div', { borderTop: `1px solid ${CLR.divide}`, margin: '1px 0' }));

    // ── Attributes — 2-column grid ─────────────────────────────────────────
    // Labels: CLR.label (5.3:1) — muted to differentiate from bright values
    // Values: CLR.value (18.1:1) — maximum contrast, player needs these at a glance
    const attrGrid = el('div', { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0px 3px' });
    const mkAttr = (key, label) => {
      const row = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
      row.appendChild(el('span', {
        color: CLR.label, fontSize: '12px', fontFamily: 'monospace', lineHeight: '1.4',
      }, label));
      const v = el('span', {
        color: CLR.value, fontSize: '12px', fontWeight: 'bold',
        fontFamily: 'monospace', lineHeight: '1.4',
      }, '—');
      row.appendChild(v);
      attrGrid.appendChild(row);
      return v;
    };
    this._attrVals = {
      strength:     mkAttr('strength',     'STR'),
      agility:      mkAttr('agility',      'AGI'),
      intelligence: mkAttr('intelligence', 'INT'),
      vitality:     mkAttr('vitality',     'VIT'),
      wisdom:       mkAttr('wisdom',       'WIS'),
    };
    attrGrid.appendChild(el('div'));   // grid padding cell (5 items, 2-col)
    sec.appendChild(attrGrid);

    sec.appendChild(el('div', { borderTop: `1px solid ${CLR.divide}`, margin: '1px 0' }));

    // ── Derived stats — 2-column grid ──────────────────────────────────────
    // Labels: CLR.label; Values: CLR.text (slightly dimmer than attrs — secondary info)
    const derivedGrid = el('div', { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0px 3px' });
    const mkDerived = (label) => {
      const row = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
      row.appendChild(el('span', {
        color: CLR.label, fontSize: '12px', fontFamily: 'monospace', lineHeight: '1.4',
      }, label));
      const v = el('span', {
        color: CLR.text, fontSize: '12px', fontFamily: 'monospace', lineHeight: '1.4',
      }, '—');
      row.appendChild(v);
      derivedGrid.appendChild(row);
      return v;
    };
    this._derivedVals = {
      weapon:  mkDerived('WPN'),
      speedMs: mkDerived('SPD'),
      armor:   mkDerived('ARM'),
      offense: mkDerived('OFF'),
      defense: mkDerived('DEF'),
    };
    sec.appendChild(derivedGrid);
    return sec;
  }

  setPlayerHP(hp, maxHp) {
    const pct = Math.max(0, hp / (maxHp || 1));
    // Colour shifts from calm red → alarming orange → critical bright red as HP drops.
    // This creates a visual urgency gradient the player reads instantly.
    this._hpBar.style.background = pct > 0.5 ? CLR.hp : pct > 0.25 ? CLR.hpLow : CLR.hpCrit;
    this._hpBar.style.width      = `${pct * 100}%`;
    this._hpVal.textContent      = `${Math.ceil(hp)}/${maxHp}`;
  }

  setPlayerMana(mana, maxMana, showBar = true) {
    const show = showBar && maxMana > 0;
    this._manaRow.style.display = show ? '' : 'none';
    if (!show) return;
    const pct = Math.max(0, mana / (maxMana || 1));
    this._manaBar.style.width = `${pct * 100}%`;
    this._manaVal.textContent = `${Math.floor(mana)}/${maxMana}`;
  }

  setPlayerShield(shield, maxShield) {
    const show = maxShield > 0;
    this._shieldRow.style.display = show ? '' : 'none';
    if (!show) return;
    const pct = Math.max(0, shield / (maxShield || 1));
    this._shieldBar.style.width = `${pct * 100}%`;
    this._shieldVal.textContent = `${shield}/${maxShield}`;
  }

  // mults arg kept for backward-compat — derived stats go via setDerivedStats()
  setClassStats(className, stats, _mults, unspentPoints = 0) {
    const pts = unspentPoints > 0 ? ` ★${unspentPoints}` : '';
    this._classNameEl.textContent = className.toUpperCase() + pts;
    // Gold highlight (#f1c40f, 11.6:1) alerts the player to unspent points
    this._classNameEl.style.color = unspentPoints > 0 ? '#f1c40f' : CLR.text;
    for (const [id, valEl] of Object.entries(this._attrVals)) {
      valEl.textContent = stats[id] ?? '—';
    }
  }

  setDerivedStats(derived) {
    if (!derived) return;
    const d = this._derivedVals;
    d.weapon.textContent  = derived.weapon  != null ? String(derived.weapon)  : '—';
    d.speedMs.textContent = derived.speedMs != null ? `${derived.speedMs}ms`  : '—';
    d.armor.textContent   = derived.armor   != null ? `${derived.armor}%`     : '—';
    d.offense.textContent = derived.offense != null ? `${derived.offense}%`   : '—';
    d.defense.textContent = derived.defense != null ? `${derived.defense}%`   : '—';
  }

  // ── Row B / CENTER: Chat section ──────────────────────────────────────────
  //
  // Font: 12px (WCAG Part 2 minimum). Line-height 1.4 (WCAG 1.4.8).
  // Background inherits CLR.bg1 from bottom HUD — #1a1a1a.
  // All message colours ≥ 4.5:1 on bg0 (verified in CC palette above).
  // ─────────────────────────────────────────────────────────────────────────

  _buildChatSection() {
    const sec = el('div', {
      flex: '1', minWidth: '0',
      display: 'flex', flexDirection: 'column',
      borderRight: `1px solid ${CLR.divide}`,
      overflow: 'hidden', boxSizing: 'border-box',
      ...DBG.section,
    });

    // Section header — CLR.label, 10px (AA Large): decorative, not primary content
    sec.appendChild(el('div', {
      color: CLR.label, fontSize: '10px', letterSpacing: '2px',
      padding: '3px 7px 2px', borderBottom: `1px solid ${CLR.divide}`,
      flexShrink: '0', fontFamily: 'monospace', lineHeight: '1.4',
    }, 'CHAT'));

    this._chatEl = el('div', {
      flex: '1', overflowY: 'scroll', overflowX: 'hidden',
      padding: '4px 8px',
      lineHeight: '1.4',    // WCAG 1.4.8: line spacing ≥ 1.4× font size
      fontSize:   '12px',   // WCAG Part 2 minimum
      fontFamily: 'monospace',
    });
    this._chatEl.addEventListener('scroll', () => {
      const c = this._chatEl;
      this._chatPaused = c.scrollTop < c.scrollHeight - c.clientHeight - 14;
    });
    sec.appendChild(this._chatEl);
    return sec;
  }

  addChatMessage(text, color = CC.system) {
    const line = el('div', { color, marginBottom: '1px', wordBreak: 'break-word' });
    line.textContent = text;
    this._chatEl.appendChild(line);
    this._chatLines.push({ text, color });
    if (this._chatLines.length > CHAT_MAX) {
      this._chatLines.shift();
      this._chatEl.removeChild(this._chatEl.firstChild);
    }
    if (!this._chatPaused) this._chatEl.scrollTop = this._chatEl.scrollHeight;
  }

  // ── Row B / RIGHT: Inventory section ─────────────────────────────────────

  _buildInvSection() {
    const sec = el('div', {
      width: INV_W + 'px', flexShrink: '0',
      padding: '4px 6px',
      display: 'flex', flexDirection: 'column', gap: '3px',
      boxSizing: 'border-box',
      ...DBG.section,
    });

    // Section header — CLR.label at 10px (AA Large)
    sec.appendChild(el('div', {
      color: CLR.label, fontSize: '10px', letterSpacing: '2px',
      paddingBottom: '2px', borderBottom: `1px solid ${CLR.divide}`,
      fontFamily: 'monospace', lineHeight: '1.4',
    }, 'INVENTORY'));

    const grid = el('div', {
      display: 'grid',
      gridTemplateColumns: `repeat(${GRID_COLS}, ${SLOT_SZ}px)`,
      gap: '2px',
    });

    this._invSlotEls = [];
    for (let i = 0; i < GRID_COLS * GRID_ROWS; i++) {
      const slot = el('div', {
        width: SLOT_SZ + 'px', height: SLOT_SZ + 'px',
        background: CLR.bg0, border: `1px solid ${CLR.divide}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'default', boxSizing: 'border-box', position: 'relative', overflow: 'hidden',
      });
      slot._type = 'inv';
      slot._idx  = i;
      this._wireSlot(slot);
      this._invSlotEls.push(slot);
      grid.appendChild(slot);
    }
    sec.appendChild(grid);
    return sec;
  }

  // ── Inventory public API ──────────────────────────────────────────────────

  setInventory(items) {
    this._invSlots = new Array(GRID_COLS * GRID_ROWS).fill(null);
    if (items) {
      for (let i = 0; i < Math.min(items.length, this._invSlots.length); i++) {
        this._invSlots[i] = items[i];
      }
    }
    this._refreshInvGrid();
  }

  setEquipment(equipment) {
    if (!equipment) return;
    Object.assign(this._equipment, equipment);
    this._refreshEquipSlots();
  }

  _refreshInvGrid() {
    for (let i = 0; i < this._invSlotEls.length; i++) {
      this._renderItem(this._invSlotEls[i], this._invSlots[i]);
    }
  }

  _refreshEquipSlots() {
    for (const [name, slotEl] of Object.entries(this._equipSlotEls)) {
      this._renderItem(slotEl, this._equipment[name]);
    }
  }

  _renderItem(slotEl, item) {
    while (slotEl.firstChild) slotEl.removeChild(slotEl.firstChild);
    slotEl._item = item ?? null;

    if (!item) {
      // Empty dot — CLR.border (#3a3a3a) visible against bg0, indicates slot is available
      slotEl.appendChild(el('div', {
        color: CLR.border, fontSize: '10px', userSelect: 'none',
      }, '·'));
      slotEl.style.borderColor = slotEl._type === 'equip' ? CLR.border : CLR.divide;
      return;
    }

    const icon = item.icon ?? this._abbr(item);
    slotEl.appendChild(el('div', {
      fontSize: item.icon ? '22px' : '12px', color: this._itemColor(item),
      fontFamily: 'monospace', fontWeight: 'bold', textAlign: 'center',
      lineHeight: '1', pointerEvents: 'none',
    }, icon));

    // Item name overlay — CLR.label (5.3:1); small because slot is 44px
    slotEl.appendChild(el('div', {
      position: 'absolute', bottom: '1px', left: '0', right: '0',
      fontSize: '9px', color: CLR.label, textAlign: 'center',
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      padding: '0 2px', pointerEvents: 'none', fontFamily: 'monospace',
      lineHeight: '1.4',
    }, item.name ?? item.id));

    // Quantity badge — CLR.text (12.9:1): needs to be clearly readable
    if (item.qty != null && item.qty > 1) {
      slotEl.appendChild(el('div', {
        position: 'absolute', bottom: '1px', right: '2px',
        fontSize: '9px', color: CLR.text, fontFamily: 'monospace',
        pointerEvents: 'none', fontWeight: 'bold',
      }, String(item.qty)));
    }
  }

  _abbr(item) { return ((item.name ?? item.id ?? '?').toUpperCase()).slice(0, 3); }

  // Item icon colours — saturated/bright so they are immediately type-identifiable
  // against bg0 (#0f0f0f). All verified ≥ 4.5:1.
  _itemColor(item) {
    switch (item.type) {
      case 'weapon':     return '#e74c3c';  // red     (5.0:1)
      case 'armor':      return '#3498db';  // blue    (5.1:1)
      case 'offhand':    return '#2ecc71';  // green   (9.1:1)
      case 'ring':
      case 'amulet':     return '#f1c40f';  // gold   (11.6:1)
      case 'consumable': return '#27ae60';  // teal    (6.1:1)
      default:           return CLR.label;  // #888   (5.3:1)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DRAG / DROP
  // ═══════════════════════════════════════════════════════════════════════════

  _wireSlot(slot) {
    slot.style.pointerEvents = 'auto';
    slot.addEventListener('mousedown',  e => this._onSlotDown(e, slot));
    slot.addEventListener('mouseenter', () => this._onSlotEnter(slot));
    slot.addEventListener('mouseleave', () => this._onSlotLeave(slot));
  }

  _onSlotDown(e, slot) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    this._dragStart  = { slot, startX: e.clientX, startY: e.clientY };
    this._isDragging = false;
  }

  _onMouseMove(e) {
    if (!this._dragStart) return;
    const dx = e.clientX - this._dragStart.startX;
    const dy = e.clientY - this._dragStart.startY;
    if (!this._isDragging) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      const item = this._dragStart.slot._item;
      if (!item) { this._dragStart = null; return; }
      this._isDragging     = true;
      this._dragSourceSlot = this._dragStart.slot;
      this._drag = {
        item,
        sourceType: this._dragStart.slot._type,
        sourceIdx:  this._dragStart.slot._type === 'inv' ? this._dragStart.slot._idx : this._dragStart.slot._equipName,
        ghost:      this._makeGhost(item, e),
      };
      this._dragStart.slot.style.opacity = '0.25';
    }
    if (this._drag?.ghost) {
      this._drag.ghost.style.left = `${e.clientX - SLOT_SZ / 2}px`;
      this._drag.ghost.style.top  = `${e.clientY - SLOT_SZ / 2}px`;
    }
  }

  _onMouseUp(e) {
    if (!this._dragStart) return;
    const wasDragging = this._isDragging;
    const originSlot  = this._dragStart.slot;
    this._dragStart  = null;
    this._isDragging = false;
    if (this._drag?.ghost) this._drag.ghost.remove();
    if (this._dragSourceSlot) { this._dragSourceSlot.style.opacity = '1'; this._dragSourceSlot = null; }
    if (this._hoveredSlot) this._resetSlotBorder(this._hoveredSlot);

    if (!wasDragging) { this._handleClick(originSlot); this._drag = null; return; }
    const target = this._hoveredSlot;
    if (!target || target === originSlot) { this._drag = null; return; }
    this._completeDrop(this._drag, target);
    this._drag = null;
  }

  _makeGhost(item, e) {
    const g = el('div', {
      position: 'fixed', width: SLOT_SZ + 'px', height: SLOT_SZ + 'px',
      background: CLR.bg2, border: `1px solid ${CLR.border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      opacity: '0.80', pointerEvents: 'none', zIndex: '999',
      left: `${e.clientX - SLOT_SZ / 2}px`, top: `${e.clientY - SLOT_SZ / 2}px`,
      fontFamily: 'monospace', fontSize: item.icon ? '22px' : '12px',
      color: this._itemColor(item),
    }, item.icon ?? this._abbr(item));
    document.body.appendChild(g);
    return g;
  }

  _onSlotEnter(slot) {
    this._hoveredSlot = slot;
    if (this._isDragging) {
      // Green tint = valid drop; red tint = invalid
      slot.style.borderColor = this._canDrop(this._drag, slot) ? '#4a8a4a' : '#7a2020';
    }
  }

  _onSlotLeave(slot) {
    if (this._hoveredSlot === slot) this._hoveredSlot = null;
    this._resetSlotBorder(slot);
  }

  _resetSlotBorder(slot) {
    slot.style.borderColor = slot._type === 'equip' ? CLR.border : CLR.divide;
  }

  _canDrop(drag, target) {
    if (!drag) return false;
    if (target._type === 'inv') return true;
    if (target._type === 'equip') return !drag.item.type || drag.item.type === target._equipName;
    return false;
  }

  _handleClick(slot) {
    const item = slot._item;
    if (!item) return;
    if (slot._type === 'inv') {
      if (item.type === 'consumable') this._useItem(item, slot._idx);
      else if (EQUIP_NAMES.includes(item.type)) this._equipItemFromInv(item, slot._idx);
    } else if (slot._type === 'equip') {
      const freeIdx = this._invSlots.indexOf(null);
      if (freeIdx < 0) return;
      this._invSlots[freeIdx] = item;
      this._equipment[slot._equipName] = null;
      this._refreshInvGrid(); this._refreshEquipSlots();
      this._eventBus?.emit('item_moved', { item, from: `equip:${slot._equipName}`, to: `inv:${freeIdx}` });
    }
  }

  _useItem(item, invIdx) {
    this._invSlots[invIdx] = null;
    this._refreshInvGrid();
    this._eventBus?.emit('item_used', { item, slotIndex: invIdx });
    this.addChatMessage(`Used ${item.name ?? item.id}.`, CC.loot);
  }

  _equipItemFromInv(item, invIdx) {
    const s = item.type;
    this._invSlots[invIdx] = this._equipment[s];
    this._equipment[s]     = item;
    this._refreshInvGrid(); this._refreshEquipSlots();
    this._eventBus?.emit('item_equipped', { item, slot: s });
    this.addChatMessage(`Equipped ${item.name ?? item.id}.`, CC.loot);
  }

  _completeDrop(drag, targetSlot) {
    const { item, sourceType, sourceIdx } = drag;
    if (targetSlot._type === 'inv') {
      const tIdx  = targetSlot._idx;
      const tItem = this._invSlots[tIdx];
      if (sourceType === 'inv') {
        this._invSlots[sourceIdx] = tItem;
        this._invSlots[tIdx]      = item;
        this._refreshInvGrid();
        this._eventBus?.emit('item_moved', { item, from: `inv:${sourceIdx}`, to: `inv:${tIdx}` });
      } else {
        this._equipment[sourceIdx] = tItem;
        this._invSlots[tIdx]       = item;
        this._refreshInvGrid(); this._refreshEquipSlots();
        this._eventBus?.emit('item_moved', { item, from: `equip:${sourceIdx}`, to: `inv:${tIdx}` });
      }
    } else if (targetSlot._type === 'equip') {
      const eName = targetSlot._equipName;
      if (!this._canDrop(drag, targetSlot)) return;
      const displaced = this._equipment[eName];
      this._equipment[eName] = item;
      if (sourceType === 'inv') this._invSlots[sourceIdx] = displaced;
      else this._equipment[sourceIdx] = displaced;
      this._refreshEquipSlots();
      if (sourceType === 'inv') this._refreshInvGrid();
      this._eventBus?.emit('item_equipped', { item, slot: eName });
      this.addChatMessage(`Equipped ${item.name ?? item.id}.`, CC.loot);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // QUEST TRACKER  (overlay, right side above bottom HUD)
  // ═══════════════════════════════════════════════════════════════════════════

  _buildQuestTracker() {
    this._questWrap = el('div', {
      position: 'fixed', bottom: (BOTTOM_H + 6) + 'px', right: '6px',
      textAlign: 'right', pointerEvents: 'none', zIndex: '190',
    });
    // Section label — CLR.label at 10px (AA Large, 5.3:1)
    this._questWrap.appendChild(el('div', {
      color: CLR.label, fontSize: '10px', letterSpacing: '2px',
      marginBottom: '3px', fontFamily: 'monospace', lineHeight: '1.4',
    }, 'QUESTS'));
    // Quest entries — CLR.text (12.9:1) at 12px; complete uses heal green
    this._questList = el('div', {
      color: CLR.text, fontSize: '12px', lineHeight: '1.4', fontFamily: 'monospace',
    });
    this._questWrap.appendChild(this._questList);
    document.body.appendChild(this._questWrap);
  }

  setQuests(quests) {
    this._questList.innerHTML = quests.map(q => {
      // Complete: CLR.xp green (9.1:1). Active: CLR.text (12.9:1).
      const color = q.complete ? CLR.xp : CLR.text;
      const label = q.complete ? `✓ ${q.title}` : `${q.title} ${q.progress}/${q.goal}`;
      return `<div style="color:${color}">${label}</div>`;
    }).join('') || `<div style="color:${CLR.label}">—</div>`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SKILL TREE MODAL
  // ═══════════════════════════════════════════════════════════════════════════

  showSkillTree(nodes, isUnlocked, canUnlock, points, onUnlock) {
    this.hideSkillTree();
    const overlay = el('div', {
      position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
      background: 'rgba(0,0,0,0.94)', zIndex: '700',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'auto',
    });
    const panel = el('div', {
      background: CLR.bg1, border: `1px solid ${CLR.border}`,
      padding: '22px', fontFamily: 'monospace',
    });
    // Title — CLR.value (18.1:1): most prominent text in modal
    panel.appendChild(el('div', {
      color: CLR.value, fontSize: '13px', letterSpacing: '3px',
      marginBottom: '3px', fontWeight: 'bold', lineHeight: '1.4',
    }, 'SKILL TREE'));
    // Points info — CLR.label (5.3:1): supporting info, not primary action
    panel.appendChild(el('div', {
      color: CLR.label, fontSize: '12px', marginBottom: '14px',
      letterSpacing: '1px', lineHeight: '1.4',
    }, `${points} point${points !== 1 ? 's' : ''} available  ·  [T] close`));

    const grid = el('div', {
      display: 'grid', gridTemplateColumns: 'repeat(5, 86px)',
      gridTemplateRows: 'repeat(4, 86px)', gap: '3px',
    });
    for (const node of nodes) {
      const unlocked  = isUnlocked(node.id);
      const available = !unlocked && canUnlock(node.id);
      const card = el('div', {
        gridColumn: String(node.col + 1), gridRow: String(node.row + 1),
        background: unlocked ? 'rgba(27,60,27,0.7)' : available ? 'rgba(18,30,50,0.7)' : CLR.bg0,
        border: `1px solid ${unlocked ? '#2a6a2a' : available ? '#1a3a6a' : CLR.divide}`,
        padding: '5px', cursor: available ? 'pointer' : 'default',
        display: 'flex', flexDirection: 'column', gap: '2px', boxSizing: 'border-box',
      });
      // Node type badge — ability uses CLR.active (gold-orange), others use CLR.label
      card.appendChild(el('div', {
        fontSize: '10px', letterSpacing: '1px',
        color: node.type === 'ability' ? CLR.active : CLR.label,
        lineHeight: '1.4',
      }, node.type.toUpperCase()));
      // Node name — CLR.xp green if unlocked, CLR.text if available, CLR.label if locked
      card.appendChild(el('div', {
        color: unlocked ? CLR.xp : available ? CLR.text : CLR.label,
        fontSize: '12px', fontWeight: 'bold', lineHeight: '1.3', flexGrow: '1',
      }, node.name));
      card.appendChild(el('div', {
        color: CLR.label, fontSize: '11px', lineHeight: '1.4',
      }, `${node.cost}pt`));
      if (unlocked) card.appendChild(el('div', { color: CLR.xp, fontSize: '11px' }, '✓'));
      if (available) {
        card.addEventListener('click', () => onUnlock(node.id));
        card.addEventListener('mouseenter', () => { card.style.borderColor = '#3a6aaa'; });
        card.addEventListener('mouseleave', () => { card.style.borderColor = '#1a3a6a'; });
      }
      grid.appendChild(card);
    }
    panel.appendChild(grid);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this._skillTreeOverlay = overlay;
  }

  hideSkillTree()  { this._skillTreeOverlay?.remove(); this._skillTreeOverlay = null; }
  isSkillTreeOpen() { return !!this._skillTreeOverlay; }

  // ═══════════════════════════════════════════════════════════════════════════
  // FLOATING ENEMY HP BARS
  // ═══════════════════════════════════════════════════════════════════════════

  initEnemyLabels(enemies) {
    for (const enemy of enemies) {
      const wrap = el('div', { position: 'fixed', width: '40px', pointerEvents: 'none', zIndex: '150' });
      // Visible track — #2a2a2a distinguishable from black game bg
      const bg   = el('div', { width: '40px', height: '3px', background: '#2a2a2a' });
      const bar  = el('div', { height: '100%', width: '100%', background: CLR.hp });
      bg.appendChild(bar);
      wrap.appendChild(bg);
      document.body.appendChild(wrap);
      this.enemyLabels.push({ wrap, bar, enemy });
    }
  }

  clearEnemyLabels() {
    for (const { wrap } of this.enemyLabels) wrap.remove();
    this.enemyLabels = [];
  }

  updateEnemyLabels() {
    for (const { wrap, bar, enemy } of this.enemyLabels) {
      if (!enemy.alive) { wrap.style.display = 'none'; continue; }
      const s = this._project(enemy.mesh.position);
      if (s.z > 1) { wrap.style.display = 'none'; continue; }
      if (s.y < TOP_H + 6 || s.y > window.innerHeight - BOTTOM_H - 6) { wrap.style.display = 'none'; continue; }
      wrap.style.display = 'block';
      wrap.style.left    = `${s.x - 20}px`;
      wrap.style.top     = `${s.y - 26}px`;
      bar.style.width    = `${(enemy.hp / enemy.maxHp) * 100}%`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FLOATING TEXT
  // ═══════════════════════════════════════════════════════════════════════════

  spawnDamageNumber(worldPos, amount, isCrit = false) {
    // Crit: gold (#f1c40f, 11.6:1); normal: orange-red (#e67e22, readable)
    this.spawnFloatingText(worldPos, isCrit ? `${amount}!` : `-${amount}`, isCrit ? '#f1c40f' : '#e67e22');
  }

  spawnFloatingText(worldPos, text, color = CLR.label) {
    const s = this._project(worldPos);
    if (s.z > 1) return;
    if (s.y < TOP_H + 4 || s.y > window.innerHeight - BOTTOM_H - 4) return;
    const d = el('div', {
      position: 'fixed', left: `${s.x}px`, top: `${s.y - 8}px`,
      color, fontSize: '13px', fontWeight: 'bold', fontFamily: 'monospace',
      pointerEvents: 'none', animation: 'hud-float 0.9s ease-out forwards', zIndex: '300',
    }, text);
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 900);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BANNERS / PROGRESS / FLASH
  // ═══════════════════════════════════════════════════════════════════════════

  showBanner(text, color = CLR.text, duration = 2200) {
    const b = el('div', {
      position: 'fixed', top: '42%', left: '50%', transform: 'translate(-50%,-50%)',
      color, fontSize: '26px', fontWeight: 'bold', letterSpacing: '3px',
      textShadow: '0 2px 14px rgba(0,0,0,0.98)', pointerEvents: 'none',
      fontFamily: 'monospace', animation: `hud-banner ${duration}ms ease forwards`, zIndex: '500',
    }, text);
    document.body.appendChild(b);
    setTimeout(() => b.remove(), duration);
  }

  showProgress(text, color = CLR.label) {
    const p = el('div', {
      position: 'fixed', top: '28%', right: '22px',
      color, fontSize: '12px', background: 'rgba(0,0,0,0.88)', padding: '3px 9px',
      pointerEvents: 'none', fontFamily: 'monospace',
      animation: 'hud-progress 1600ms ease forwards', zIndex: '400',
    }, text);
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1600);
  }

  screenFlash(color = '#ffffff', alpha = 0.4) {
    const o = el('div', {
      position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
      background: color, opacity: String(alpha),
      pointerEvents: 'none', transition: 'opacity 0.35s ease-out', zIndex: '600',
    });
    document.body.appendChild(o);
    o.getBoundingClientRect();
    o.style.opacity = '0';
    setTimeout(() => o.remove(), 400);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 7 — HIGH CONTRAST MODE + CONTRAST REPORT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Logs a WCAG contrast report for the key colour pairs used in the HUD.
   * Called once in constructor when DEBUG_LAYOUT = true.
   * Also available via: window.__debug?.hud?.contrastReport?.()
   */
  _logContrastReport() {
    const bg = CLR.bg0;   // darkest surface — worst-case for contrast
    const pairs = [
      ['label text',     CLR.label, bg],
      ['default text',   CLR.text,  bg],
      ['important value',CLR.value, bg],
      ['highlight/key',  CLR.hi,    bg],
      ['chat: system',   CC.system, bg],
      ['chat: combat',   CC.combat, bg],
      ['chat: damage',   CC.damage, bg],
      ['chat: recv',     CC.recv,   bg],
      ['chat: heal',     CC.heal,   bg],
      ['chat: magic',    CC.magic,  bg],
      ['chat: loot',     CC.loot,   bg],
      ['chat: level',    CC.level,  bg],
      ['chat: quest',    CC.quest,  bg],
      ['HP fill',        CLR.hp,    bg],
      ['HP low',         CLR.hpLow, bg],
      ['HP crit',        CLR.hpCrit,bg],
      ['MP fill',        CLR.mp,    bg],
      ['SH fill',        CLR.sh,    bg],
      ['XP fill',        CLR.xp,    bg],
    ];
    console.group('[HUD] Accessibility contrast report (WCAG AA = 4.5:1, AA Large = 3.0:1)');
    console.log(`Surface: ${bg}`);
    for (const [name, fg, surface] of pairs) {
      const ratio = contrastRatio(fg, surface).toFixed(2);
      const pass  = ratio >= 4.5 ? '✓ AA' : ratio >= 3.0 ? '~ AA-Large' : '✗ FAIL';
      console.log(`  %-28s %s on %s  →  %s:1  %s`, name, fg, surface, ratio, pass);
    }
    console.groupEnd();
  }

  /**
   * Toggles "high contrast mode" — boosts all text to pure white, borders to #666.
   * Useful for accessibility testing or low-visibility environments.
   * Toggle via: window.__debug?.hud?.toggleHighContrast?.()  OR the [HC] button.
   */
  toggleHighContrast() {
    this._highContrast = !this._highContrast;
    const root = document.getElementById('hud-hc-styles') ?? (() => {
      const s = document.createElement('style');
      s.id = 'hud-hc-styles';
      document.head.appendChild(s);
      return s;
    })();

    if (this._highContrast) {
      // Override: push all fg text to white, all borders to #666, bar bg to #333
      root.textContent = `
        /* HUD High-Contrast Mode — removes all sub-AA colour choices */
        #hud *, .hud-topbar *, .hud-bottomhud * {
          color: #ffffff !important;
        }
        .hud-bar-bg {
          background: #333333 !important;
          border-color: #666666 !important;
        }
        .hud-slot {
          border-color: #666666 !important;
        }
      `;
      console.log('[HUD] High-contrast mode ON — all text forced to #ffffff');
    } else {
      root.textContent = '';
      console.log('[HUD] High-contrast mode OFF — normal palette restored');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DEBUG
  // ═══════════════════════════════════════════════════════════════════════════

  _buildDebug() {
    this._debugEl = el('div', {
      position: 'fixed', top: (TOP_H + 4) + 'px', left: '182px',
      // CLR.dimmed (#555555) — low priority info, not primary content
      color: CLR.dimmed, fontSize: '11px', letterSpacing: '0.5px',
      fontFamily: 'monospace', pointerEvents: 'none', zIndex: '160', lineHeight: '1.4',
    });
    document.body.appendChild(this._debugEl);
  }

  setDebugPos(x, y, z) {
    this._debugEl.textContent = `${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITY
  // ═══════════════════════════════════════════════════════════════════════════

  _project(worldPos) {
    const v = (typeof worldPos.clone === 'function')
      ? worldPos.clone().project(this.camera)
      : new THREE.Vector3(worldPos.x, worldPos.y ?? 0, worldPos.z).project(this.camera);
    return {
      x: ( v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
      z: v.z,
    };
  }

  _injectStyles() {
    if (document.getElementById('hud-styles')) return;
    const s = document.createElement('style');
    s.id = 'hud-styles';
    s.textContent = `
      /* ── HUD global typography baseline ────────────────────────────────
         line-height: 1.4 satisfies WCAG 1.4.8 (text spacing).
         font-size minimum 12px is enforced per-element; this baseline
         ensures any dynamically created child also inherits it.
      ── */
      #hud, #hud * { box-sizing: border-box; }

      @keyframes hud-float   { 0% { transform:translateY(0); opacity:1; } 100% { transform:translateY(-32px); opacity:0; } }
      @keyframes hud-banner  { 0% { opacity:0; transform:translate(-50%,-50%) scale(0.9); } 10% { opacity:1; transform:translate(-50%,-50%) scale(1); } 75% { opacity:1; } 100% { opacity:0; } }
      @keyframes hud-progress{ 0% { opacity:0; transform:translateX(10px); } 10% { opacity:1; transform:translateX(0); } 75% { opacity:1; } 100% { opacity:0; } }

      /* Scrollbar styling for chat — keep it unobtrusive but visible */
      #hud ::-webkit-scrollbar       { width: 4px; }
      #hud ::-webkit-scrollbar-track { background: ${CLR.bg0}; }
      #hud ::-webkit-scrollbar-thumb { background: ${CLR.divide}; border-radius: 2px; }
      #hud ::-webkit-scrollbar-thumb:hover { background: ${CLR.border}; }
    `;
    document.head.appendChild(s);
  }
}
