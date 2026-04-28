// saveSelectScreen.js — save slot selection UI.
//
// Returns a Promise that resolves to:
//   { action: 'load',  saveId: string }   — user confirmed a save to load
//   { action: 'back' }                    — user went back to main menu
//   { action: 'new'  }                    — user clicked New Game from this screen
//
// Reads only the lightweight index (no full save data loaded).
// Portraits and metadata are stored in the index so the list is instant.

import { loadIndex, deleteSave, generatePortrait } from './saveSystem.js';

// ── Palette (matches main menu aesthetic) ─────────────────────────────────────
const P = {
  bg:        'rgba(6,6,14,0.97)',
  panel:     '#0d0d1a',
  border:    '#1e1e3a',
  accent:    '#00d4ff',
  accentDim: '#007a99',
  text:      '#ccd6f6',
  muted:     '#5a6a8a',
  danger:    '#e74c3c',
  dangerDim: '#8b1f13',
  selected:  'rgba(0,212,255,0.10)',
  selBorder: '#00d4ff',
  rowHover:  'rgba(0,212,255,0.05)',
  gold:      '#f0c040',
};

const CLASS_BADGE = {
  mage:    { bg: '#201470', fg: '#8ab4f8', label: 'MAGE'    },
  warrior: { bg: '#1b2535', fg: '#8898a8', label: 'WARRIOR' },
  rogue:   { bg: '#1a130a', fg: '#a8987a', label: 'ROGUE'   },
};

// ── Entry point ───────────────────────────────────────────────────────────────

export function showSaveSelect() {
  return new Promise(resolve => {
    const saves = loadIndex();   // lightweight metadata only

    const overlay = el('div', {
      position: 'fixed', inset: '0',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: P.bg, fontFamily: 'monospace', zIndex: '999',
    });

    // ── Panel ──────────────────────────────────────────────────────────────────
    const panel = el('div', {
      background: P.panel,
      border: `1px solid ${P.border}`,
      width: '560px', maxWidth: '96vw',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    });

    // ── Header ─────────────────────────────────────────────────────────────────
    const header = el('div', {
      padding: '18px 24px',
      borderBottom: `1px solid ${P.border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    });
    const title = el('div', {
      color: P.accent, fontSize: '13px', letterSpacing: '5px',
    });
    title.textContent = 'SELECT CHARACTER';
    header.appendChild(title);
    panel.appendChild(header);

    // ── Save list ──────────────────────────────────────────────────────────────
    const list = el('div', {
      flex: '1', overflowY: 'auto', maxHeight: '360px',
      padding: '8px 0',
    });

    let selectedId = saves.length > 0 ? saves[0].id : null;
    const rowEls   = new Map();   // saveId → rowEl

    function renderRows() {
      list.innerHTML = '';
      rowEls.clear();

      if (saves.length === 0) {
        const empty = el('div', {
          padding: '48px 24px', textAlign: 'center',
          color: P.muted, fontSize: '13px', letterSpacing: '2px',
        });
        empty.textContent = 'NO SAVED CHARACTERS';
        list.appendChild(empty);
        return;
      }

      for (const meta of saves) {
        const row = buildRow(meta, meta.id === selectedId);
        row.addEventListener('click', () => {
          selectedId = meta.id;
          renderRows();      // re-render to update selection highlight
          syncButtons();
        });
        list.appendChild(row);
        rowEls.set(meta.id, row);
      }
    }

    renderRows();
    panel.appendChild(list);

    // ── Divider ────────────────────────────────────────────────────────────────
    const divider = el('div', { borderTop: `1px solid ${P.border}` });
    panel.appendChild(divider);

    // ── Footer buttons ─────────────────────────────────────────────────────────
    const footer = el('div', {
      display: 'flex', gap: '12px', padding: '16px 24px',
      justifyContent: 'flex-end',
    });

    const btnBack = actionBtn('BACK',     P.muted,   P.muted);
    const btnDel  = actionBtn('DELETE',   P.danger,  P.danger);
    const btnLoad = actionBtn('CONTINUE', P.accent,  P.accent);

    // ── Delete with inline confirmation ───────────────────────────────────────
    let delConfirm = false;
    let delTimer   = null;

    btnDel.addEventListener('click', () => {
      if (!selectedId) return;
      if (!delConfirm) {
        // First click — arm confirmation
        delConfirm = true;
        btnDel.textContent = 'CONFIRM?';
        btnDel.style.background = P.dangerDim;
        clearTimeout(delTimer);
        delTimer = setTimeout(() => {
          delConfirm = false;
          btnDel.textContent = 'DELETE';
          btnDel.style.background = 'transparent';
        }, 3000);
      } else {
        // Second click — execute
        clearTimeout(delTimer);
        deleteSave(selectedId);
        const idx = saves.findIndex(s => s.id === selectedId);
        saves.splice(idx, 1);
        selectedId = saves.length > 0 ? saves[0].id : null;
        delConfirm = false;
        btnDel.textContent = 'DELETE';
        btnDel.style.background = 'transparent';
        renderRows();
        syncButtons();
      }
    });

    btnLoad.addEventListener('click', () => {
      if (!selectedId) return;
      overlay.remove();
      resolve({ action: 'load', saveId: selectedId });
    });

    btnBack.addEventListener('click', () => {
      overlay.remove();
      resolve({ action: 'back' });
    });

    function syncButtons() {
      const hasSel = !!selectedId;
      btnLoad.disabled = !hasSel;
      btnLoad.style.opacity = hasSel ? '1' : '0.35';
      btnLoad.style.cursor  = hasSel ? 'pointer' : 'default';
      btnDel.disabled  = !hasSel;
      btnDel.style.opacity  = hasSel ? '1' : '0.35';
      btnDel.style.cursor   = hasSel ? 'pointer' : 'default';
    }

    footer.appendChild(btnBack);
    footer.appendChild(btnDel);
    footer.appendChild(btnLoad);
    panel.appendChild(footer);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    syncButtons();
  });
}

// ── Row builder ───────────────────────────────────────────────────────────────

function buildRow(meta, selected) {
  const row = el('div', {
    display: 'flex', alignItems: 'center', gap: '16px',
    padding: '12px 24px',
    cursor: 'pointer',
    background: selected ? P.selected : 'transparent',
    borderLeft: selected ? `3px solid ${P.selBorder}` : '3px solid transparent',
    transition: 'background 0.1s',
  });
  row.addEventListener('mouseenter', () => {
    if (!selected) row.style.background = P.rowHover;
  });
  row.addEventListener('mouseleave', () => {
    if (!selected) row.style.background = 'transparent';
  });

  // Portrait
  const portrait = buildPortrait(meta);
  row.appendChild(portrait);

  // Info block
  const info = el('div', { flex: '1', minWidth: '0' });

  // Row 1: name + class badge + level
  const top = el('div', {
    display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px',
  });

  const name = el('div', {
    color: P.text, fontSize: '14px', letterSpacing: '1px',
    fontWeight: 'bold', flex: '1',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  });
  name.textContent = meta.name ?? 'Unknown';

  const badge = buildClassBadge(meta.class);
  const lvl   = el('div', { color: P.gold, fontSize: '12px', letterSpacing: '1px', whiteSpace: 'nowrap' });
  lvl.textContent = `LV.${meta.level ?? 1}`;

  top.appendChild(name);
  top.appendChild(lvl);
  top.appendChild(badge);
  info.appendChild(top);

  // Row 2: zone + clan + last played
  const sub = el('div', {
    display: 'flex', alignItems: 'center', gap: '16px',
  });

  const zone = el('div', { color: P.muted, fontSize: '11px', letterSpacing: '1px' });
  zone.textContent = meta.zoneId ?? '—';
  sub.appendChild(zone);

  if (meta.clan) {
    const dot = el('div', { color: P.border, fontSize: '10px' });
    dot.textContent = '·';
    const clan = el('div', { color: P.accentDim, fontSize: '11px', letterSpacing: '1px' });
    clan.textContent = meta.clan;
    sub.appendChild(dot);
    sub.appendChild(clan);
  }

  const spacer = el('div', { flex: '1' });
  sub.appendChild(spacer);

  const time = el('div', { color: P.muted, fontSize: '11px', letterSpacing: '1px' });
  time.textContent = _timeAgo(meta.lastPlayed);
  sub.appendChild(time);

  info.appendChild(sub);
  row.appendChild(info);

  return row;
}

function buildPortrait(meta) {
  const wrap = el('div', {
    width: '52px', height: '52px', flexShrink: '0',
    border: `1px solid ${P.border}`,
    overflow: 'hidden', background: '#0d0d1a',
  });

  if (meta.portrait) {
    const img = document.createElement('img');
    img.src   = meta.portrait;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;image-rendering:pixelated';
    img.onerror = () => { wrap.innerHTML = ''; wrap.appendChild(fallbackPortrait(meta.class)); };
    wrap.appendChild(img);
  } else {
    wrap.appendChild(fallbackPortrait(meta.class));
  }
  return wrap;
}

function fallbackPortrait(cls) {
  // Regenerate portrait inline if none stored
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 52;
    canvas.style.cssText = 'width:100%;height:100%;display:block;image-rendering:pixelated';
    const ctx = canvas.getContext('2d');
    const full = document.createElement('canvas');
    full.width = full.height = 64;
    const ctx2 = full.getContext('2d');
    // use generatePortrait logic inline... just draw a solid color for fallback
    const C = { mage: '#201470', warrior: '#607888', rogue: '#221e14' };
    ctx2.fillStyle = C[cls] ?? '#333';
    ctx2.fillRect(0, 0, 64, 64);
    ctx.drawImage(full, 0, 0, 52, 52);
    return canvas;
  } catch { return document.createElement('canvas'); }
}

function buildClassBadge(cls) {
  const info = CLASS_BADGE[cls] ?? { bg: '#1a1a2e', fg: '#8a9ab8', label: (cls ?? '').toUpperCase() };
  const badge = el('div', {
    background: info.bg, color: info.fg,
    fontSize: '10px', letterSpacing: '2px',
    padding: '2px 7px', border: `1px solid ${info.fg}44`,
    whiteSpace: 'nowrap',
  });
  badge.textContent = info.label;
  return badge;
}

// ── Utility ───────────────────────────────────────────────────────────────────

function actionBtn(label, borderColor, color) {
  const b = el('button', {
    background: 'transparent', border: `1px solid ${borderColor}`,
    color, fontFamily: 'monospace', fontSize: '12px',
    letterSpacing: '3px', padding: '10px 22px',
    cursor: 'pointer', transition: 'background 0.12s',
  });
  b.textContent = label;
  b.addEventListener('mouseenter', () => { if (!b.disabled) b.style.background = `${borderColor}22`; });
  b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; });
  return b;
}

/** Create a div with inline styles from an object. */
function el(tag, styles = {}) {
  const e = document.createElement(tag);
  Object.assign(e.style, styles);
  return e;
}

function _timeAgo(isoString) {
  if (!isoString) return '';
  try {
    const diff = Date.now() - new Date(isoString).getTime();
    const mins  = Math.floor(diff / 60_000);
    const hours = Math.floor(diff / 3_600_000);
    const days  = Math.floor(diff / 86_400_000);
    if (mins  <  1) return 'just now';
    if (mins  < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  } catch { return ''; }
}
