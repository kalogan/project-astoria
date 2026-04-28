// statAllocPanel.js — floating stat-point allocation panel.
//
// Shows after every level-up (auto) and can be reopened with [P].
// Calls build.applyStatPoint(stat) and then triggers a HUD refresh via
// the onAllocate callback supplied by main.js.
//
// Layout: floating panel bottom-right so it never covers the action.
//
// Auto-closes when 0 unspent points remain.

import { STAT_LABELS, STAT_DESCS } from './buildManager.js';

function el(tag, styles, html) {
  const e = document.createElement(tag);
  if (styles) Object.assign(e.style, styles);
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export class StatAllocPanel {
  constructor() {
    this._panel      = null;
    this._build      = null;
    this._onAllocate = null; // () => void  — callback to refresh HUD / player stats
  }

  /** Wire the BuildManager and a refresh callback. Call once from main.js. */
  setContext({ build, onAllocate }) {
    this._build      = build;
    this._onAllocate = onAllocate;
  }

  /** Show the panel. Called on level-up or when player presses P. */
  show() {
    if (this._panel) this._panel.remove(); // re-render fresh
    if (!this._build) return;

    const unspent = this._build.getUnspentPoints();
    // If no points and opened manually, still show — lets player review stats
    this._render(unspent);
  }

  /** Hide the panel programmatically. */
  hide() {
    this._panel?.remove();
    this._panel = null;
  }

  isVisible() { return !!this._panel; }

  toggle() {
    if (this.isVisible()) this.hide();
    else this.show();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _render(unspent) {
    const build = this._build;
    const stats = build.getStats();

    // ── Panel shell ──────────────────────────────────────────────────────
    const panel = el('div', {
      position:     'fixed',
      bottom:       '90px',
      right:        '20px',
      width:        '230px',
      background:   'rgba(8,8,16,0.95)',
      border:       '1px solid #2a2a2a',
      borderRadius: '8px',
      padding:      '16px',
      fontFamily:   'monospace',
      zIndex:       '400',
      userSelect:   'none',
    });
    this._panel = panel;

    // ── Header ───────────────────────────────────────────────────────────
    const header = el('div', {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: '12px',
    });

    header.appendChild(el('div', {
      color: '#fff', fontSize: '12px', letterSpacing: '2px',
    }, 'STATS'));

    const ptsEl = el('div', {
      fontSize: '11px',
      color:    unspent > 0 ? '#f1c40f' : '#555',
      letterSpacing: '1px',
    }, unspent > 0 ? `★ ${unspent} pts` : '—');
    header.appendChild(ptsEl);

    const closeBtn = el('div', {
      color: '#555', fontSize: '14px', cursor: 'pointer',
      lineHeight: '1', paddingLeft: '8px',
    }, '✕');
    closeBtn.addEventListener('click', () => this.hide());
    closeBtn.addEventListener('mouseenter', () => closeBtn.style.color = '#aaa');
    closeBtn.addEventListener('mouseleave', () => closeBtn.style.color = '#555');
    header.appendChild(closeBtn);

    panel.appendChild(header);

    // ── Hint ─────────────────────────────────────────────────────────────
    if (unspent > 0) {
      panel.appendChild(el('div', {
        color: '#f1c40f', fontSize: '10px', letterSpacing: '1px',
        marginBottom: '12px', opacity: '0.8',
      }, `Click [+] to spend  ·  P to close`));
    } else {
      panel.appendChild(el('div', {
        color: '#444', fontSize: '10px', letterSpacing: '1px', marginBottom: '12px',
      }, 'No points to spend  ·  P to close'));
    }

    // ── Stat rows ─────────────────────────────────────────────────────────
    const statKeys = Object.keys(stats);
    for (const stat of statKeys) {
      panel.appendChild(this._makeStatRow(stat, stats[stat], unspent));
    }

    // ── Derived line ─────────────────────────────────────────────────────
    panel.appendChild(el('div', {
      marginTop: '12px', borderTop: '1px solid #1a1a1a', paddingTop: '10px',
      color: '#444', fontSize: '10px', lineHeight: '1.8',
    },
      `DMG ×${build.getDamageMultiplier().toFixed(2)}  ` +
      `SPD ×${build.getSpeedMultiplier().toFixed(2)}<br>` +
      `HP ${build.getMaxHP()}  ` +
      `CDR ${(build.getCooldownReduction() * 100).toFixed(0)}%`
    ));

    document.body.appendChild(panel);
  }

  _makeStatRow(stat, value, unspent) {
    const label = STAT_LABELS[stat] ?? stat.toUpperCase().slice(0, 3);
    const desc  = STAT_DESCS[stat]  ?? '';
    const canSpend = unspent > 0;

    const row = el('div', {
      display:       'flex',
      alignItems:    'center',
      gap:           '8px',
      marginBottom:  '7px',
    });

    // Label
    row.appendChild(el('div', {
      color: '#666', fontSize: '10px', width: '24px', letterSpacing: '0.5px',
    }, label));

    // Value
    const valEl = el('div', {
      color: '#ccc', fontSize: '12px', fontWeight: 'bold', width: '22px', textAlign: 'right',
    }, String(value));
    row.appendChild(valEl);

    // Desc
    row.appendChild(el('div', {
      flex: '1', color: '#3a3a3a', fontSize: '9px', lineHeight: '1.4',
    }, desc));

    // [+] button
    const btn = el('div', {
      width:        '22px', height: '22px',
      lineHeight:   '22px', textAlign: 'center',
      background:   canSpend ? 'rgba(241,196,15,0.12)' : 'rgba(255,255,255,0.03)',
      border:       `1px solid ${canSpend ? '#f1c40f88' : '#2a2a2a'}`,
      color:        canSpend ? '#f1c40f' : '#2a2a2a',
      borderRadius: '3px',
      fontSize:     '14px',
      cursor:       canSpend ? 'pointer' : 'default',
      transition:   'background 0.1s',
    }, '+');

    if (canSpend) {
      btn.addEventListener('mouseenter', () => btn.style.background = 'rgba(241,196,15,0.25)');
      btn.addEventListener('mouseleave', () => btn.style.background = 'rgba(241,196,15,0.12)');
      btn.addEventListener('click', () => {
        if (this._build.applyStatPoint(stat)) {
          this._onAllocate?.();
          const remaining = this._build.getUnspentPoints();
          if (remaining <= 0) {
            // Brief flash then close
            setTimeout(() => this.hide(), 400);
          } else {
            // Re-render with updated values
            this._panel?.remove();
            this._render(remaining);
          }
        }
      });
    }

    row.appendChild(btn);
    return row;
  }
}
