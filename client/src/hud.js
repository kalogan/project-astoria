function el(tag, styles, html) {
  const e = document.createElement(tag);
  if (styles) Object.assign(e.style, styles);
  if (html)   e.innerHTML = html;
  return e;
}

export class HUD {
  constructor(camera) {
    this.camera = camera;
    this.enemyLabels = [];
    this.questEls    = [];

    this.root = el('div');
    this.root.id = 'hud';
    document.body.appendChild(this.root);

    this._buildPlayerHP();
    this._buildInventory();
    this._buildQuestTracker();
    this._buildDebug();
  }

  // ── Player HP ──────────────────────────────────────────────
  _buildPlayerHP() {
    const wrap = el('div', { position:'absolute', bottom:'20px', left:'20px', width:'180px' });
    wrap.appendChild(el('div', { color:'#aaa', fontSize:'11px', marginBottom:'4px', letterSpacing:'1px' }, 'HP'));
    const bg = el('div', { width:'100%', height:'10px', background:'#222', borderRadius:'3px' });
    this._hpBar = el('div', { height:'100%', width:'100%', background:'#e74c3c', borderRadius:'3px', transition:'width 0.1s' });
    bg.appendChild(this._hpBar);
    wrap.appendChild(bg);
    this.root.appendChild(wrap);
  }

  setPlayerHP(hp, maxHp) {
    this._hpBar.style.width = `${Math.max(0, (hp / maxHp) * 100)}%`;
  }

  // ── Inventory ──────────────────────────────────────────────
  _buildInventory() {
    const wrap = el('div', { position:'absolute', bottom:'20px', right:'20px', textAlign:'right' });
    wrap.appendChild(el('div', { color:'#aaa', fontSize:'11px', marginBottom:'6px', letterSpacing:'1px' }, 'INVENTORY'));
    this._invList = el('div', { color:'#fff', fontSize:'13px', lineHeight:'1.8' });
    wrap.appendChild(this._invList);
    this.root.appendChild(wrap);
  }

  setInventory(items) {
    this._invList.innerHTML = items.length
      ? items.map(i => `<div>${i.keyId} key</div>`).join('')
      : '<div style="color:#444">empty</div>';
  }

  // ── Floating enemy HP bars ─────────────────────────────────
  initEnemyLabels(enemies) {
    for (const enemy of enemies) {
      const wrap = el('div', { position:'absolute', width:'40px', pointerEvents:'none' });
      const bg   = el('div', { width:'40px', height:'4px', background:'#333', borderRadius:'2px' });
      const bar  = el('div', { height:'100%', width:'100%', background:'#e74c3c', borderRadius:'2px' });
      bg.appendChild(bar);
      wrap.appendChild(bg);
      this.root.appendChild(wrap);
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
      if (s.z > 1)      { wrap.style.display = 'none'; continue; }
      wrap.style.display = 'block';
      wrap.style.left    = `${s.x - 20}px`;
      wrap.style.top     = `${s.y - 34}px`;
      bar.style.width    = `${(enemy.hp / enemy.maxHp) * 100}%`;
    }
  }

  // ── Damage numbers ─────────────────────────────────────────
  spawnDamageNumber(worldPos, amount) {
    const s = this._project(worldPos);
    const d = el('div', {
      position:  'absolute',
      left:      `${s.x}px`,
      top:       `${s.y - 10}px`,
      color:     '#ff6600',
      fontSize:  '15px',
      fontWeight:'bold',
      animation: 'dmg-float 0.8s ease-out forwards',
    }, `-${amount}`);
    this.root.appendChild(d);
    setTimeout(() => d.remove(), 800);
  }

  // ── Quest tracker ──────────────────────────────────────────
  _buildQuestTracker() {
    this._questWrap = el('div', { position:'absolute', top:'20px', right:'20px', textAlign:'right' });
    this._questWrap.appendChild(el('div', { color:'#aaa', fontSize:'11px', marginBottom:'6px', letterSpacing:'1px' }, 'QUESTS'));
    this._questList = el('div', { color:'#fff', fontSize:'12px', lineHeight:'2' });
    this._questWrap.appendChild(this._questList);
    this.root.appendChild(this._questWrap);
  }

  setQuests(quests) {
    this._questList.innerHTML = quests.map(q => {
      const done  = q.complete;
      const color = done ? '#2ecc71' : '#fff';
      const label = done ? `${q.title} complete` : `${q.title}: ${q.progress}/${q.goal}`;
      return `<div style="color:${color}">${label}</div>`;
    }).join('') || '<div style="color:#444">none</div>';
  }

  // ── Debug ──────────────────────────────────────────────────
  _buildDebug() {
    this._debugEl = el('div', {
      position: 'absolute', top: '20px', left: '20px',
      color: '#666', fontSize: '11px', letterSpacing: '0.5px',
    });
    this.root.appendChild(this._debugEl);
  }

  setDebugPos(x, y, z) {
    this._debugEl.textContent = `x:${x.toFixed(2)}  y:${y.toFixed(2)}  z:${z.toFixed(2)}`;
  }

  // ── Util ───────────────────────────────────────────────────
  _project(worldPos) {
    const v = worldPos.clone().project(this.camera);
    return {
      x: ( v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
      z: v.z,
    };
  }
}
