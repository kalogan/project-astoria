// characterCreate.js — character creation screen.
//
// Shown after "New Game". Returns Promise<{ classId, name }>.
// Replaces the old classSelect.js single-click flow with a full creation form:
//   class selection → description panel updates → name input → Create
//
// Class data comes directly from CLASS_DEFS — no stat duplication.
// Portrait previews use generatePortrait() from saveSystem.js.

import { CLASS_DEFS, CLASS_IDS, STAT_LABELS } from './buildManager.js';
import { generatePortrait }                    from './saveSystem.js';

const MAX_NAME = 20;

// ── Palette ───────────────────────────────────────────────────────────────────
const P = {
  bg:       'rgba(6,6,14,0.97)',
  panel:    '#0d0d1a',
  border:   '#1e1e3a',
  text:     '#ccd6f6',
  muted:    '#4a5a7a',
  accent:   '#00d4ff',
  error:    '#e74c3c',
  inputBg:  '#070710',
};

// ── Entry point ───────────────────────────────────────────────────────────────

export function showCharacterCreate() {
  return new Promise(resolve => {
    let selectedClass = CLASS_IDS[0];   // default: warrior
    let nameValue     = '';

    // ── Overlay ───────────────────────────────────────────────────────────────
    const overlay = el('div', {
      position: 'fixed', inset: '0',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: P.bg, fontFamily: 'monospace', zIndex: '1000',
      overflowY: 'auto', padding: '20px 0',
    });

    // ── Panel ─────────────────────────────────────────────────────────────────
    const panel = el('div', {
      background: P.panel, border: `1px solid ${P.border}`,
      width: '580px', maxWidth: '96vw',
      display: 'flex', flexDirection: 'column',
    });

    // ── Header ────────────────────────────────────────────────────────────────
    const header = el('div', {
      padding: '20px 28px 18px',
      borderBottom: `1px solid ${P.border}`,
    });
    const htitle = el('div', {
      color: P.accent, fontSize: '12px', letterSpacing: '5px', marginBottom: '4px',
    });
    htitle.textContent = 'NEW GAME';
    const hsub = el('div', {
      color: P.text, fontSize: '18px', letterSpacing: '3px',
    });
    hsub.textContent = 'CREATE YOUR CHARACTER';
    header.appendChild(htitle);
    header.appendChild(hsub);
    panel.appendChild(header);

    // ── Body ──────────────────────────────────────────────────────────────────
    const body = el('div', { padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '28px' });

    // ── Section: class selection ──────────────────────────────────────────────
    const classSection = el('div', { display: 'flex', flexDirection: 'column', gap: '12px' });
    const classLabel   = sectionLabel('CLASS');
    classSection.appendChild(classLabel);

    const classRow = el('div', { display: 'flex', gap: '10px' });
    const classBtns = {};
    for (const id of CLASS_IDS) {
      const btn = buildClassBtn(id, id === selectedClass);
      btn.addEventListener('click', () => {
        selectedClass = id;
        for (const [cid, b] of Object.entries(classBtns)) setClassBtnActive(b, CLASS_DEFS[cid], cid === id);
        refreshInfo(id);
      });
      classBtns[id] = btn;
      classRow.appendChild(btn);
    }
    classSection.appendChild(classRow);
    body.appendChild(classSection);

    // ── Section: class info (portrait + description + stats) ──────────────────
    const infoSection = el('div', {
      display: 'flex', gap: '18px', alignItems: 'flex-start',
      background: '#07070f', border: `1px solid ${P.border}`,
      padding: '16px',
    });

    // Portrait canvas (80×80, scaled up from generatePortrait's 64×64)
    const portraitEl = el('img', {
      width: '80px', height: '80px', flexShrink: '0',
      imageRendering: 'pixelated', border: `1px solid ${P.border}`,
      display: 'block',
    });

    const infoRight = el('div', { flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '8px' });

    const infoName   = el('div', { fontSize: '16px', letterSpacing: '3px', fontWeight: 'bold' });
    const infoFlavour = el('div', { fontSize: '10px', letterSpacing: '2px', color: P.muted });
    const infoDesc   = el('div', { fontSize: '11px', color: '#8a9ab8', lineHeight: '1.6' });
    const statsGrid  = el('div', { display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '4px' });

    infoRight.appendChild(infoName);
    infoRight.appendChild(infoFlavour);
    infoRight.appendChild(infoDesc);
    infoRight.appendChild(statsGrid);

    infoSection.appendChild(portraitEl);
    infoSection.appendChild(infoRight);
    body.appendChild(infoSection);

    function refreshInfo(classId) {
      const def = CLASS_DEFS[classId];
      portraitEl.src = generatePortrait(classId);
      infoName.textContent    = def.name.toUpperCase();
      infoName.style.color    = def.color;
      infoFlavour.textContent = def.flavour ?? '';
      infoDesc.textContent    = def.desc;
      statsGrid.innerHTML     = '';
      for (const [stat, base] of Object.entries(def.baseStats)) {
        const growth = def.statGrowth[stat] ?? 0;
        const label  = STAT_LABELS[stat] ?? stat.slice(0, 3).toUpperCase();
        const pct    = Math.round((base / 10) * 100);
        const row    = buildStatRow(label, base, pct, growth, def.color);
        statsGrid.appendChild(row);
      }
    }
    refreshInfo(selectedClass);

    // ── Section: name input ────────────────────────────────────────────────────
    const nameSection = el('div', { display: 'flex', flexDirection: 'column', gap: '10px' });
    nameSection.appendChild(sectionLabel('CHARACTER NAME'));

    const nameWrap = el('div', { position: 'relative' });
    const nameInput = document.createElement('input');
    Object.assign(nameInput.style, {
      width: '100%', boxSizing: 'border-box',
      background: P.inputBg, border: `1px solid ${P.border}`,
      color: P.text, fontFamily: 'monospace', fontSize: '14px',
      letterSpacing: '2px', padding: '11px 14px',
      outline: 'none', transition: 'border-color 0.15s',
    });
    nameInput.placeholder    = 'Enter a name...';
    nameInput.maxLength      = MAX_NAME;
    nameInput.autocomplete   = 'off';
    nameInput.spellcheck     = false;

    const nameCounter = el('div', {
      position: 'absolute', right: '10px', top: '50%',
      transform: 'translateY(-50%)',
      fontSize: '10px', color: P.muted, pointerEvents: 'none',
    });
    nameCounter.textContent = `0 / ${MAX_NAME}`;

    const nameError = el('div', {
      fontSize: '11px', letterSpacing: '1px', color: P.error,
      minHeight: '16px',
    });

    nameInput.addEventListener('focus', () => {
      nameInput.style.borderColor = P.accent;
    });
    nameInput.addEventListener('blur', () => {
      nameInput.style.borderColor = P.border;
    });
    nameInput.addEventListener('input', () => {
      nameValue = nameInput.value.trim();
      nameCounter.textContent = `${nameInput.value.length} / ${MAX_NAME}`;
      nameError.textContent   = '';
      syncCreate();
    });
    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') btnCreate.click();
    });

    nameWrap.appendChild(nameInput);
    nameWrap.appendChild(nameCounter);
    nameSection.appendChild(nameWrap);
    nameSection.appendChild(nameError);
    body.appendChild(nameSection);

    panel.appendChild(body);

    // ── Footer ────────────────────────────────────────────────────────────────
    const footer = el('div', {
      display: 'flex', justifyContent: 'flex-end', gap: '12px',
      padding: '16px 28px', borderTop: `1px solid ${P.border}`,
    });

    const btnBack   = actionBtn('BACK',   P.muted);
    const btnCreate = actionBtn('CREATE', P.accent);
    btnCreate.disabled = true;
    btnCreate.style.opacity = '0.35';
    btnCreate.style.cursor  = 'default';

    function syncCreate() {
      const valid = nameValue.length > 0;
      btnCreate.disabled      = !valid;
      btnCreate.style.opacity = valid ? '1' : '0.35';
      btnCreate.style.cursor  = valid ? 'pointer' : 'default';
    }

    btnBack.addEventListener('click', () => {
      overlay.remove();
      resolve(null);   // null = go back to main menu
    });

    btnCreate.addEventListener('click', () => {
      const trimmed = nameInput.value.trim();
      if (!trimmed) {
        nameError.textContent = '⚠ Name is required.';
        nameInput.focus();
        return;
      }
      overlay.remove();
      resolve({ classId: selectedClass, name: trimmed });
    });

    footer.appendChild(btnBack);
    footer.appendChild(btnCreate);
    panel.appendChild(footer);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // Focus name input after a tick so keyboard appears
    setTimeout(() => nameInput.focus(), 80);
  });
}

// ── Class selection button ─────────────────────────────────────────────────────

function buildClassBtn(classId, active) {
  const def = CLASS_DEFS[classId];
  const btn = el('button', {
    flex: '1', background: active ? `${def.color}18` : 'transparent',
    border: `1px solid ${active ? def.color : def.color + '44'}`,
    color: active ? def.color : def.color + 'aa',
    fontFamily: 'monospace', fontSize: '12px', letterSpacing: '3px',
    padding: '10px 0', cursor: 'pointer',
    transition: 'background 0.12s, border-color 0.12s, color 0.12s',
  });
  btn.textContent = def.name.toUpperCase();
  btn.addEventListener('mouseenter', () => {
    if (btn.style.borderColor !== def.color) btn.style.background = `${def.color}0d`;
  });
  btn.addEventListener('mouseleave', () => {
    if (btn.style.borderColor.replace(/\s/g,'') !== def.color.replace(/\s/g,''))
      btn.style.background = 'transparent';
  });
  return btn;
}

function setClassBtnActive(btn, def, active) {
  btn.style.background    = active ? `${def.color}18` : 'transparent';
  btn.style.borderColor   = active ? def.color : def.color + '44';
  btn.style.color         = active ? def.color : def.color + 'aa';
}

// ── Stat row ──────────────────────────────────────────────────────────────────

function buildStatRow(label, base, pct, growth, color) {
  const row = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });

  const lbl = el('div', { color: P.muted, fontSize: '9px', width: '26px', letterSpacing: '0.5px' });
  lbl.textContent = label;

  const track = el('div', { flex: '1', height: '3px', background: '#111', overflow: 'hidden' });
  const fill  = el('div', { width: `${pct}%`, height: '100%', background: color + 'cc' });
  track.appendChild(fill);

  const val = el('div', { color: '#667', fontSize: '9px', width: '14px', textAlign: 'right' });
  val.textContent = String(base);

  const grow = el('div', { color: growth > 0 ? color : 'transparent', fontSize: '9px', width: '22px' });
  grow.textContent = growth > 0 ? `+${growth}` : '';

  row.appendChild(lbl);
  row.appendChild(track);
  row.appendChild(val);
  row.appendChild(grow);
  return row;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sectionLabel(text) {
  const lbl = el('div', {
    color: P.muted, fontSize: '10px', letterSpacing: '3px',
  });
  lbl.textContent = text;
  return lbl;
}

function actionBtn(label, color) {
  const b = el('button', {
    background: 'transparent', border: `1px solid ${color}`,
    color, fontFamily: 'monospace', fontSize: '12px',
    letterSpacing: '3px', padding: '10px 28px',
    cursor: 'pointer', transition: 'background 0.12s',
  });
  b.textContent = label;
  b.addEventListener('mouseenter', () => { if (!b.disabled) b.style.background = `${color}22`; });
  b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; });
  return b;
}

function el(tag, styles = {}) {
  const e = document.createElement(tag);
  Object.assign(e.style, styles);
  return e;
}
