// astoniaSkillPanel.js — Astonia-style always-visible character stat + skill panel.
//
// ── DESIGN RULES ─────────────────────────────────────────────────────────────
//   • Always visible — NOT a modal. Toggled with [C] but defaults to shown.
//   • Data-dense, compact, monospace. No animations.
//   • Dark bg, light text, tight spacing.
//   • Sections:
//       1. RESOURCES  — HP bar + Mana bar (live, read-only)
//       2. ATTRIBUTES — STR/AGI/INT/VIT/WIS with [+] buttons (stat points)
//       3. DERIVED    — Weapon dmg, Speed, Armor, Offense, Defense (read-only)
//       4. SKILLS     — Class-specific skill list with [+] buttons (skill points)
//   • On any [+] click: allocate point immediately, re-render with live values.
//
// ── ACCESSIBILITY (WCAG AA) ───────────────────────────────────────────────────
//   Surface:  #1a1a1a  (panel bg)
//   Borders:  #3a3a3a
//   Labels:   #888888  (5.3:1 on #0f0f0f)
//   Text:     #d6d6d6  (12.9:1 on #0f0f0f)
//   Values:   #ffffff  (18.1:1 on #0f0f0f)
//   Gold:     #f1c40f  (11.6:1) — badges, unspent-point alerts
//   Min font: 12px; line-height: 1.4 (WCAG 1.4.8)
//
// ── INTEGRATION ──────────────────────────────────────────────────────────────
//   main.js:
//     import { AstoniaSkillPanel } from './astoniaSkillPanel.js';
//     const skillPanel = new AstoniaSkillPanel();
//     skillPanel.setContext({ build, player, onAllocate: () => { ... },
//                             bottomOffset: LAYOUT.BOTTOM_H, topOffset: LAYOUT.TOP_H });
//     skillPanel.show();
//     // In animate loop:  skillPanel.tick();
//   Listens to 'stat_changed' and 'class_skill_changed' on eventBus.

import { STAT_LABELS } from './buildManager.js';

// ── Colour tokens (mirrors hud.js CLR; kept local to avoid a shared import) ──
const C = {
  bg:     '#1a1a1a',   // panel surface
  bg0:    '#0f0f0f',   // slot / bar track interior
  border: '#3a3a3a',   // outer borders
  divide: '#282828',   // inner dividers / section separators
  label:  '#888888',   // muted labels    (5.3:1 on bg0)
  text:   '#d6d6d6',   // default text   (12.9:1 on bg0)
  value:  '#ffffff',   // important vals (18.1:1 on bg0)
  gold:   '#f1c40f',   // unspent-point badges, [+] buttons (11.6:1)
  hp:     '#c0392b',
  mp:     '#2980b9',
  sh:     '#3498db',
};

function el(tag, styles, text) {
  const e = document.createElement(tag);
  if (styles) Object.assign(e.style, styles);
  if (text !== undefined) e.textContent = text;
  return e;
}

// Bar track — visible background (#1a1a1a) makes empty state clear
function bar(pct, color, height = '6px') {
  const bg = el('div', {
    width: '100%', height,
    background: C.bg0,
    border: `1px solid ${C.divide}`,
    borderRadius: '2px', overflow: 'hidden',
  });
  const fill = el('div', {
    width:        `${Math.max(0, Math.min(100, pct * 100))}%`,
    height:       '100%',
    background:   color,
    borderRadius: '2px',
    transition:   'width 0.15s',
  });
  bg.appendChild(fill);
  bg._fill = fill;  // expose for live update
  return bg;
}

// ── AstoniaSkillPanel ─────────────────────────────────────────────────────────

export class AstoniaSkillPanel {
  constructor() {
    this._panel        = null;
    this._build        = null;
    this._player       = null;
    this._onAllocate   = null;
    this._eventBus     = null;
    this._visible      = false;
    this._bottomOffset = 0;
    this._topOffset    = 0;
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────

  setContext({ build, player, onAllocate, eventBus, bottomOffset = 0, topOffset = 0 }) {
    this._build        = build;
    this._player       = player;
    this._onAllocate   = onAllocate;
    this._eventBus     = eventBus;
    this._bottomOffset = bottomOffset;
    this._topOffset    = topOffset;
  }

  // ── Visibility ─────────────────────────────────────────────────────────────

  show() {
    if (this._panel) this._panel.remove();
    this._visible = true;
    this._render();
  }

  hide() {
    this._panel?.remove();
    this._panel   = null;
    this._visible = false;
  }

  toggle() {
    this._visible ? this.hide() : this.show();
  }

  isVisible() { return this._visible; }

  /**
   * Call each frame to update HP/MP bars in real time without full re-render.
   * Only updates the bar fill widths — cheap.
   */
  tick() {
    if (!this._panel || !this._player || !this._build) return;
    const hp  = this._hpFill;
    const mp  = this._mpFill;
    if (hp) hp.style.width = `${Math.max(0, (this._player.hp / this._player.maxHp) * 100)}%`;
    if (mp) {
      const pool = this._build.getManaPool();
      if (pool > 0) mp.style.width = `${Math.max(0, (this._build.getCurrentMana() / pool) * 100)}%`;
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  _render() {
    if (!this._build) return;

    const bot = this._bottomOffset;
    const top = this._topOffset;
    const panel = el('div', {
      position:    'fixed',
      bottom:      bot + 'px',
      top:         top + 'px',
      left:        '0',
      width:       '174px',
      maxHeight:   `calc(100vh - ${top}px - ${bot}px)`,
      overflowY:   'auto',
      // #1a1a1a panel surface (WCAG Part 3 — panel background)
      background:  C.bg,
      borderRight: `1px solid ${C.border}`,
      fontFamily:  '"Courier New", Courier, monospace',
      // 12px base (WCAG Part 2 — minimum font size)
      fontSize:    '12px',
      lineHeight:  '1.4',   // WCAG 1.4.8 — line spacing
      color:       C.text,  // #d6d6d6 (12.9:1 — default readable text)
      zIndex:      '350',
      boxSizing:   'border-box',
      padding:     '8px 8px 24px 8px',
      userSelect:  'none',
    });

    this._panel = panel;

    // ── Header ──────────────────────────────────────────────────────────
    const cls = this._build.getClassDef();
    const hdr = el('div', {
      fontSize:      '10px',       // section header — AA Large (decorative)
      letterSpacing: '2px',
      marginBottom:  '8px',
      paddingBottom: '5px',
      borderBottom:  `1px solid ${C.divide}`,
      display:       'flex',
      justifyContent:'space-between',
      alignItems:    'center',
    });
    // 'CHARACTER' label — C.label (5.3:1): muted header
    hdr.appendChild(el('span', { color: C.label }, 'CHARACTER'));

    // Close button — C.label at rest, C.text on hover
    const closeBtn = el('span', {
      cursor: 'pointer', color: C.label, fontSize: '14px', lineHeight: '1',
    }, '✕');
    closeBtn.addEventListener('click',      () => this.hide());
    closeBtn.addEventListener('mouseenter', () => closeBtn.style.color = C.text);
    closeBtn.addEventListener('mouseleave', () => closeBtn.style.color = C.label);
    hdr.appendChild(closeBtn);
    panel.appendChild(hdr);

    // Class name — class colour if provided, else C.text; bold at 13px
    panel.appendChild(el('div', {
      color:         cls.color ?? C.text,
      fontSize:      '13px',
      fontWeight:    'bold',
      letterSpacing: '1px',
      marginBottom:  '10px',
      lineHeight:    '1.4',
    }, cls.name.toUpperCase()));

    // ── Section: RESOURCES ───────────────────────────────────────────────
    panel.appendChild(this._sectionHeader('RESOURCES'));

    // HP bar — fill colour from hud.js CLR.hp; track visible (C.bg0)
    const hpPct  = this._player ? (this._player.hp / (this._player.maxHp || 1)) : 1;
    const hpBar  = bar(hpPct, C.hp, '7px');
    this._hpFill = hpBar._fill;
    panel.appendChild(this._resourceRow(
      'HP',
      `${Math.ceil(this._player?.hp ?? 0)} / ${this._player?.maxHp ?? 0}`,
      hpBar,
    ));

    // MP bar
    const pool   = this._build.getManaPool();
    const mp     = this._build.getCurrentMana();
    const mpBar  = bar(pool > 0 ? mp / pool : 0, C.mp, '7px');
    this._mpFill = mpBar._fill;
    panel.appendChild(this._resourceRow('MP', `${Math.floor(mp)} / ${pool}`, mpBar));

    // Shield row (only when active)
    if ((this._player?.shield ?? 0) > 0) {
      const shPct = this._player.shield / (this._player.maxShield || 1);
      const shBar = bar(shPct, C.sh, '5px');
      panel.appendChild(this._resourceRow(
        'SH',
        `${this._player.shield} / ${this._player.maxShield}`,
        shBar,
      ));
    }

    panel.appendChild(this._spacer());

    // ── Section: ATTRIBUTES ──────────────────────────────────────────────
    const statPts = this._build.getUnspentPoints();
    panel.appendChild(this._sectionHeader('ATTRIBUTES', statPts > 0 ? `★ ${statPts}` : ''));

    const stats = this._build.getStats();
    for (const [id, val] of Object.entries(stats)) {
      panel.appendChild(this._allocRow(
        STAT_LABELS[id] ?? id.slice(0, 3).toUpperCase(),
        val,
        statPts > 0,
        () => {
          if (this._build.applyStatPoint(id)) {
            this._onAllocate?.();
            this._rerender();
          }
        },
        C.label,   // #888888 (5.3:1) — attribute label
      ));
    }

    panel.appendChild(this._spacer());

    // ── Section: DERIVED ─────────────────────────────────────────────────
    panel.appendChild(this._sectionHeader('DERIVED'));

    const derived = this._build.getDerivedStats?.() ?? {};
    const derivedRows = [
      ['Weapon',  derived.weapon   ?? this._build.getWeaponDamage?.() ?? '—'],
      ['Speed',   derived.speedMs  ? `${derived.speedMs}ms`            : '—'],
      ['Armor',   derived.armor    !== undefined ? `${derived.armor}%` : '—'],
      ['Offense', derived.offense  !== undefined ? `${derived.offense}%` : '—'],
      ['Defense', derived.defense  !== undefined ? `${derived.defense}%` : '—'],
    ];
    for (const [label, value] of derivedRows) {
      panel.appendChild(this._readonlyRow(label, value));
    }

    panel.appendChild(this._spacer());

    // ── Section: SKILLS ──────────────────────────────────────────────────
    const skillPts = this._build.getUnspentSkillPoints?.() ?? 0;
    panel.appendChild(this._sectionHeader('SKILLS', skillPts > 0 ? `◆ ${skillPts}` : ''));

    const skillDefs = this._build.getClassSkillDefs?.() ?? {};
    for (const [id, def] of Object.entries(skillDefs)) {
      const raw  = this._build.getRawSkill?.(id)      ?? 0;
      const comp = this._build.getComputedSkill?.(id) ?? raw;
      // Show raw/computed so player understands stat scaling
      const display = comp !== raw ? `${raw} (${comp})` : String(comp);
      panel.appendChild(this._allocRow(
        def.label,
        display,
        skillPts > 0,
        () => {
          if (this._build.applySkillPoint(id)) {
            this._onAllocate?.();
            this._rerender();
          }
        },
        '#8899bb',   // muted blue-grey for skills (5.9:1 on bg) — differentiates from attrs
      ));
    }

    document.body.appendChild(panel);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _rerender() {
    if (this._panel) {
      this._panel.remove();
      this._panel = null;
    }
    this._render();
  }

  // Section header — 10px letter-spaced label (AA Large, decorative).
  // Badge (unspent points) uses gold (#f1c40f, 11.6:1) — immediate attention signal.
  _sectionHeader(label, badge = '') {
    const wrap = el('div', {
      display:       'flex',
      justifyContent:'space-between',
      alignItems:    'center',
      marginBottom:  '5px',
      marginTop:     '2px',
    });
    wrap.appendChild(el('span', {
      color: C.label, fontSize: '10px', letterSpacing: '2px', lineHeight: '1.4',
    }, label));
    if (badge) {
      wrap.appendChild(el('span', {
        color: C.gold, fontSize: '10px', fontWeight: 'bold', lineHeight: '1.4',
      }, badge));
    }
    return wrap;
  }

  // Resource row: bar track + label/value header.
  // Label: C.label (5.3:1). Value: C.text (12.9:1).
  _resourceRow(label, text, barEl) {
    const row = el('div', { marginBottom: '7px' });
    const top = el('div', {
      display: 'flex', justifyContent: 'space-between', marginBottom: '3px',
    });
    top.appendChild(el('span', {
      color: C.label, fontSize: '12px', lineHeight: '1.4',
    }, label));
    top.appendChild(el('span', {
      color: C.text, fontSize: '12px', lineHeight: '1.4',
    }, text));
    row.appendChild(top);
    row.appendChild(barEl);
    return row;
  }

  // Read-only stat row (derived stats).
  // Label: C.label; Value: C.text. Both 12px.
  _readonlyRow(label, value) {
    const row = el('div', {
      display:       'flex',
      justifyContent:'space-between',
      alignItems:    'center',
      marginBottom:  '4px',
    });
    row.appendChild(el('span', {
      color: C.label, fontSize: '12px', lineHeight: '1.4',
    }, label));
    row.appendChild(el('span', {
      color: C.text, fontSize: '12px', lineHeight: '1.4',
    }, String(value)));
    return row;
  }

  /**
   * Allocatable stat/skill row with [+] button.
   * @param {string}   label       — display name
   * @param {any}      value       — current level/value
   * @param {boolean}  canSpend    — whether [+] is active
   * @param {Function} onSpend     — callback on [+] click
   * @param {string}   labelColor  — label colour (pass C.label or a class-specific hue)
   */
  _allocRow(label, value, canSpend, onSpend, labelColor = C.label) {
    const row = el('div', {
      display:      'flex',
      alignItems:   'center',
      gap:          '4px',
      marginBottom: '4px',
    });

    // Label — truncated with ellipsis to fit 174px panel width
    const lbl = el('div', {
      color:        labelColor,
      fontSize:     '12px',
      flex:         '1',
      overflow:     'hidden',
      textOverflow: 'ellipsis',
      whiteSpace:   'nowrap',
      lineHeight:   '1.4',
    }, label);
    row.appendChild(lbl);

    // Value — C.value (#ffffff, 18.1:1): these are the numbers the player acts on
    row.appendChild(el('div', {
      color:      C.value,
      fontSize:   '12px',
      fontWeight: 'bold',
      minWidth:   '28px',
      textAlign:  'right',
      lineHeight: '1.4',
    }, String(value)));

    // [+] button:
    //   Active  — gold outline + text (#f1c40f, 11.6:1) — clearly actionable
    //   Inactive — dimmed (#282828 border) — clearly inactive, not confused with a value
    const btn = el('div', {
      width:       '20px',
      height:      '20px',
      lineHeight:  '20px',
      textAlign:   'center',
      fontSize:    '14px',
      borderRadius:'2px',
      cursor:      canSpend ? 'pointer' : 'default',
      color:       canSpend ? C.gold          : C.divide,
      background:  canSpend ? 'rgba(241,196,15,0.08)' : 'transparent',
      border:      `1px solid ${canSpend ? 'rgba(241,196,15,0.35)' : C.divide}`,
      flexShrink:  '0',
    }, '+');

    if (canSpend) {
      btn.addEventListener('mouseenter', () => btn.style.background = 'rgba(241,196,15,0.22)');
      btn.addEventListener('mouseleave', () => btn.style.background = 'rgba(241,196,15,0.08)');
      btn.addEventListener('click', onSpend);
    }

    row.appendChild(btn);
    return row;
  }

  // Section spacer — C.divide border (visible against panel bg)
  _spacer() {
    return el('div', {
      height: '8px', borderTop: `1px solid ${C.divide}`, marginBottom: '6px',
    });
  }
}
