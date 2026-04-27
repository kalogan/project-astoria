const KEY     = 'astoria_save';
const VERSION = 1;

export function hasSave() {
  return localStorage.getItem(KEY) !== null;
}

export function clearSave() {
  localStorage.removeItem(KEY);
}

export function getSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data.version === VERSION ? data : null;
  } catch { return null; }
}

export function saveGame({ player, zone, combat, questSys }) {
  const state = {
    version:    VERSION,
    activeZone: zone.activeId,
    player: {
      x: player.mesh.position.x,
      y: player.mesh.position.y,
      z: player.mesh.position.z,
      hp: player.hp,
    },
    doors:    zone.entities?.doors.map(d => ({ id: d.id, locked: d.locked }))          ?? [],
    enemies:  zone.enemySys?.enemies.map(e => ({ x: e.mesh.position.x, z: e.mesh.position.z, hp: e.hp, alive: e.alive })) ?? [],
    triggers: zone.triggers?.triggers.map(t => ({ fired: t.fired }))                   ?? [],
    loot:     combat.loot.map(l => ({ x: l.mesh.position.x, z: l.mesh.position.z, collected: l.collected })),
    quests:   questSys.all().map(q => ({ id: q.id, progress: q.progress, complete: q.complete })),
  };

  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Save failed:', err);
  }
}

// Call after zone.load() to rehydrate zone-specific state
export function applySave(data, { player, zone, combat, questSys, hud }) {
  // Player
  player.mesh.position.set(data.player.x, data.player.y, data.player.z);
  player.hp = data.player.hp;

  // Doors
  for (const saved of data.doors ?? []) {
    const door = zone.entities?.doors.find(d => d.id === saved.id);
    if (door && !saved.locked) door.unlock();
  }

  // Enemies
  (data.enemies ?? []).forEach((saved, i) => {
    const e = zone.enemySys?.enemies[i];
    if (!e) return;
    e.mesh.position.set(saved.x, e.mesh.position.y, saved.z);
    e.hp    = saved.hp;
    e.alive = saved.alive;
    if (!saved.alive) e.mesh.visible = false;
  });

  // Triggers
  (data.triggers ?? []).forEach((saved, i) => {
    const t = zone.triggers?.triggers[i];
    if (t) t.fired = saved.fired;
  });

  // Loot
  combat.loadLoot(data.loot ?? []);

  // Quests
  for (const saved of data.quests ?? []) {
    const q = questSys.quests.find(q => q.id === saved.id);
    if (q) { q.progress = saved.progress; q.complete = saved.complete; }
  }

  hud.setPlayerHP(player.hp, player.maxHp);
  hud.setQuests(questSys.all());
}
