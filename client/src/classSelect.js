// classSelect.js — class selection screen shown after "New Game".
//
// Returns a Promise<classId> that resolves when the player clicks a class card.
// Reads CLASS_DEFS from buildManager directly — no stat duplication.
// Style is consistent with menu.js (dark overlay, monospace, same palette).

import { CLASS_DEFS, CLASS_IDS, STAT_LABELS } from './buildManager.js';

function el(tag, styles, html) {
  const e = document.createElement(tag);
  if (styles) Object.assign(e.style, styles);
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/**
 * Show the class selection overlay.
 * Resolves with the chosen classId string ('warrior' | 'rogue' | 'mage').
 */
export function showClassSelect() {
  return new Promise(resolve => {
    // ── Overlay ────────────────────────────────────────────────────────────
    const overlay = el('div', {
      position: 'fixed', inset: '0',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(8,8,16,0.96)',
      fontFamily: 'monospace', zIndex: '1000',
    });

    overlay.appendChild(el('div', {
      color: '#00d4ff', fontSize: '13px',
      letterSpacing: '5px', marginBottom: '8px', opacity: '0.6',
    }, 'NEW GAME'));

    overlay.appendChild(el('div', {
      color: '#fff', fontSize: '22px',
      letterSpacing: '4px', marginBottom: '8px',
    }, 'CHOOSE YOUR CLASS'));

    overlay.appendChild(el('div', {
      color: '#555', fontSize: '11px',
      letterSpacing: '2px', marginBottom: '40px',
    }, 'your choice is permanent'));

    // ── Class cards ────────────────────────────────────────────────────────
    const row = el('div', {
      display: 'flex', gap: '20px', alignItems: 'stretch',
    });

    for (const classId of CLASS_IDS) {
      const def = CLASS_DEFS[classId];
      const card = _buildCard(classId, def, () => {
        overlay.remove();
        resolve(classId);
      });
      row.appendChild(card);
    }

    overlay.appendChild(row);
    document.body.appendChild(overlay);
  });
}

// ── Card builder ─────────────────────────────────────────────────────────────

function _buildCard(classId, def, onClick) {
  const card = el('div', {
    width:        '200px',
    background:   'rgba(0,0,0,0.7)',
    border:       `1px solid ${def.color}44`,
    borderRadius: '8px',
    padding:      '22px 18px',
    cursor:       'pointer',
    transition:   'border-color 0.15s, background 0.15s, transform 0.12s',
    display:      'flex',
    flexDirection:'column',
    gap:          '10px',
    userSelect:   'none',
  });

  // ── Hover effects ──────────────────────────────────────────────────────
  card.addEventListener('mouseenter', () => {
    card.style.borderColor = def.color;
    card.style.background  = `${def.color}18`;
    card.style.transform   = 'translateY(-3px)';
  });
  card.addEventListener('mouseleave', () => {
    card.style.borderColor = `${def.color}44`;
    card.style.background  = 'rgba(0,0,0,0.7)';
    card.style.transform   = 'none';
  });
  card.addEventListener('click', onClick);

  // ── Class name ─────────────────────────────────────────────────────────
  card.appendChild(el('div', {
    color: def.color, fontSize: '18px', letterSpacing: '3px', fontWeight: 'bold',
  }, def.name.toUpperCase()));

  // ── Flavour ────────────────────────────────────────────────────────────
  card.appendChild(el('div', {
    color: '#666', fontSize: '10px', letterSpacing: '1.5px',
  }, def.flavour ?? ''));

  // ── Description ────────────────────────────────────────────────────────
  card.appendChild(el('div', {
    color: '#aaa', fontSize: '11px', lineHeight: '1.6',
    borderTop: `1px solid ${def.color}22`, paddingTop: '10px',
  }, def.desc));

  // ── Base stats block ───────────────────────────────────────────────────
  const statsWrap = el('div', {
    borderTop: `1px solid ${def.color}22`, paddingTop: '10px',
    display: 'flex', flexDirection: 'column', gap: '4px',
  });

  const statKeys = Object.keys(def.baseStats);
  for (const stat of statKeys) {
    const base   = def.baseStats[stat];
    const growth = def.statGrowth[stat];
    const label  = STAT_LABELS[stat] ?? stat.toUpperCase().slice(0, 3);

    // Bar is relative to max base stat of 10
    const pct  = Math.round((base / 10) * 100);
    const gCol = growth > 0 ? def.color : '#333';

    const row = el('div', { display: 'flex', alignItems: 'center', gap: '6px' });

    row.appendChild(el('div', {
      color: '#777', fontSize: '9px', width: '24px', letterSpacing: '0.5px',
    }, label));

    const track = el('div', {
      flex: '1', height: '4px', background: '#1a1a1a', borderRadius: '2px', overflow: 'hidden',
    });
    const fill = el('div', {
      width: `${pct}%`, height: '100%',
      background: `${def.color}cc`, borderRadius: '2px',
    });
    track.appendChild(fill);
    row.appendChild(track);

    row.appendChild(el('div', {
      color: '#555', fontSize: '9px', width: '14px', textAlign: 'right',
    }, String(base)));

    // growth arrow (+1/+2 per level)
    row.appendChild(el('div', {
      color: gCol, fontSize: '9px', width: '20px',
    }, growth > 0 ? `+${growth}` : ''));

    statsWrap.appendChild(row);
  }
  card.appendChild(statsWrap);

  // ── Multipliers ────────────────────────────────────────────────────────
  const m = def.mults;
  card.appendChild(el('div', {
    borderTop: `1px solid ${def.color}22`, paddingTop: '10px',
    color: '#555', fontSize: '10px', lineHeight: '1.8',
  },
    `DMG ×${m.damage.toFixed(2)}  &nbsp; SPD ×${m.speed.toFixed(2)}<br>` +
    `HP  ×${m.hp.toFixed(2)}  &nbsp; CRIT ×${m.crit.toFixed(2)}`
  ));

  // ── Select button ──────────────────────────────────────────────────────
  const selectBtn = el('div', {
    marginTop:   '6px',
    border:      `1px solid ${def.color}88`,
    color:       def.color,
    fontSize:    '11px',
    letterSpacing: '2px',
    textAlign:   'center',
    padding:     '8px 0',
    borderRadius:'4px',
    transition:  'background 0.12s',
  }, 'SELECT');
  card.addEventListener('mouseenter', () => selectBtn.style.background = `${def.color}22`);
  card.addEventListener('mouseleave', () => selectBtn.style.background = 'transparent');
  card.appendChild(selectBtn);

  return card;
}
