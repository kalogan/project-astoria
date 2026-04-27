const KEY     = 'astoria_save';
const VERSION = 1;

export function hasSave() {
  return localStorage.getItem(KEY) !== null;
}

export function clearSave() {
  localStorage.removeItem(KEY);
}

export function saveGame({ player, entities, enemySys, combat, triggers, questSys }) {
  const state = {
    version:  VERSION,
    player: {
      x:  player.mesh.position.x,
      y:  player.mesh.position.y,
      z:  player.mesh.position.z,
      hp: player.hp,
    },
    doors: entities.doors.map(d => ({
      id: d.id, locked: d.locked,
    })),
    enemies: enemySys.enemies.map(e => ({
      x: e.mesh.position.x, z: e.mesh.position.z,
      hp: e.hp, alive: e.alive,
    })),
    triggers: triggers.triggers.map(t => ({ fired: t.fired })),
    loot: combat.loot.map(l => ({
      x: l.mesh.position.x, z: l.mesh.position.z,
      collected: l.collected,
    })),
    quests: questSys.all().map(q => ({
      id: q.id, progress: q.progress, complete: q.complete,
    })),
  };

  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Save failed:', err);
  }
}

export function loadGame({ player, entities, enemySys, combat, triggers, questSys, hud }) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;

    const state = JSON.parse(raw);
    if (state.version !== VERSION) { clearSave(); return false; }

    // Player
    player.mesh.position.set(state.player.x, state.player.y, state.player.z);
    player.hp = state.player.hp;

    // Doors
    for (const saved of state.doors) {
      const door = entities.doors.find(d => d.id === saved.id);
      if (door && !saved.locked) door.unlock();
    }

    // Enemies
    state.enemies.forEach((saved, i) => {
      const e = enemySys.enemies[i];
      if (!e) return;
      e.mesh.position.set(saved.x, e.mesh.position.y, saved.z);
      e.hp    = saved.hp;
      e.alive = saved.alive;
      if (!saved.alive) e.mesh.visible = false;
    });

    // Triggers
    state.triggers.forEach((saved, i) => {
      if (triggers.triggers[i]) triggers.triggers[i].fired = saved.fired;
    });

    // Loot
    combat.loadLoot(state.loot);

    // Quests
    for (const saved of state.quests ?? []) {
      const q = questSys.quests.find(q => q.id === saved.id);
      if (q) { q.progress = saved.progress; q.complete = saved.complete; }
    }

    // Sync HUD
    hud.setPlayerHP(player.hp, player.maxHp);
    hud.setQuests(questSys.all());

    return true;
  } catch (err) {
    console.warn('Load failed:', err);
    return false;
  }
}
