import * as THREE from 'three';
import { createScene }              from './scene.js';
import { Player }                   from './player.js';
import { Inventory }                from './inventory.js';
import { CombatSystem }             from './combatSystem.js';
import { HUD, LAYOUT }              from './hud.js';
import { QuestSystem }              from './questSystem.js';
import { ZoneManager }              from './zoneManager.js';
import { SystemManager, THROTTLE }  from './systemManager.js';
import { GameClock }                from './gameClock.js';
import { EventBus }                 from './eventBus.js';
import { saveGame, loadGame, newSaveId, setActiveSaveId } from './saveSystem.js';
import { showMenu }                 from './menu.js';
import { ProgressionManager }       from './progressionManager.js';
import { WorldStateManager }        from './worldStateManager.js';
import { FeedbackSystem }           from './feedbackSystem.js';
import { MetaProgressionManager }   from './metaProgressionManager.js';
import { BuildManager }             from './buildManager.js';
import { AbilitySystem }            from './abilitySystem.js';
import { SkillTreeSystem }          from './skillTreeSystem.js';
import { AISystem }                 from './aiSystem.js';
import { EncounterSystem }          from './encounterSystem.js';
import { DungeonManager }           from './dungeonManager.js';
import { ModifierSystem }           from './modifierSystem.js';
import { DifficultyManager }        from './difficultyManager.js';
import { GameFlowManager }          from './gameFlowManager.js';
import { PerformanceManager }       from './performanceManager.js';
import { JuiceSystem }              from './juiceSystem.js';
import { KitbashSystem }            from './kitbashSystem.js';
import { VisualPassSystem }         from './visualPassSystem.js';
import { StyleEnforcer }            from './styleEnforcer.js';
import { logContent }               from './contentGenerator.js';
import {
  generateZoneBatch, generateBatchN,
  loadZoneFromBatch, listBatchZones,
  getBatchZone, getBatchZonesSnapshot,
  clearBatch, EXAMPLE_BATCH,
} from './batchZoneGenerator.js';
import { generateFromPrompt, planBatch, EXAMPLE_PROMPT } from './aiBatchPlanner.js';

import { AudioSystem }      from './audioSystem.js';
import { ALL_SOUND_IDS }    from './audioSystem.js';
import { showClassSelect }  from './classSelect.js';
import { StatAllocPanel }        from './statAllocPanel.js';
import { AstoniaSkillPanel }     from './astoniaSkillPanel.js';
import { AnimationSystem }         from './animationSystem.js';
import { CharAnimator }            from './charAnimator.js';
import { OverheadBarSystem }       from './overheadBarSystem.js';
import { HitEffectSystem }         from './hitEffectSystem.js';
import { AbilityEffectSystem }     from './abilityEffectSystem.js';
import { StatusEffectSystem }      from './statusEffectSystem.js';
import { StatusVisualSystem }      from './statusVisualSystem.js';
import { EnemyAbilitySystem }      from './enemyAbilitySystem.js';
import { EnemyTelegraphSystem }    from './enemyTelegraphSystem.js';
import { ProjectileSystem }        from './projectileSystem.js';
import { LightningPulseSystem }    from './lightningPulseSystem.js';

// ── Phase 3 imports ───────────────────────────────────────────────────────────

import { registerCameronZones }  from './cameronZone.js';
import { registerSewerZones }    from './sewersDungeon.js';
import { registerSkellie4Zones } from './skellie4Zone.js';
import { registerAstonZones }    from './astonCore.js';
import { registerServiceZones }  from './serviceDistrict.js';
import { registerZombiesZones }  from './zombiesII.js';
import { registerPentagramZones} from './pentagramPitZone.js';
import { ContentManager }        from './contentManager.js';
import { ClanManager }           from './clanManager.js';
import { ClanSpawnerSystem }     from './clanSpawnerSystem.js';
import { HideoutSystem }         from './hideoutSystem.js';
import { AltarSystem }           from './altarSystem.js';
import { TeleporterSystem }      from './teleporterSystem.js';
import { SpawnerSystem }         from './spawnerSystem.js';
import { PentagramSystem }       from './pentagramSystem.js';
import { unlock as teleportUnlock } from './teleportRegistry.js';

// ── Zone theme lookup (authored zones don't carry _lastGenConfig.theme) ───────

const ZONE_THEMES = {
  Cameron:                   'forest',
  cameron_wilderness:        'forest',
  cameron_dungeon_entrance:  'dungeon',
  sewers_entry:              'dungeon',
  sewers_room_1:             'dungeon',
  sewers_room_2:             'dungeon',
  sewers_boss:               'dungeon',
  skellie4:                  'dungeon',
  clan_spawner_zone:         'dungeon',
  aston_core:                'hub',
  aston_service_district:    'hub',
  aston_zombies_ii:          'dungeon',
  pentagram_pit:             'dungeon',
};

function _getZoneTheme(zoneId) {
  if (zoneId.startsWith('hideout_'))  return 'hub';
  if (zoneId.startsWith('dungeon_'))  return 'dungeon';
  const zoneCfg = zone._lastGenConfig ?? {};
  return ZONE_THEMES[zoneId] ?? zoneCfg.theme ?? 'dungeon';
}

// ─────────────────────────────────────────────────────────────────────────────

const { scene, camera, renderer } = createScene();

// ── Simulation infrastructure ─────────────────────────────────────────────────

const gameClock = new GameClock();
const eventBus  = new EventBus(gameClock);

// ── Core systems ──────────────────────────────────────────────────────────────

const inventory   = new Inventory();
const questSys    = new QuestSystem([], eventBus);
const player      = new Player(scene, null);
const hud         = new HUD(camera);
const systemMgr   = new SystemManager();
const progression = new ProgressionManager();
const worldState  = new WorldStateManager();
const feedbackSys = new FeedbackSystem(hud, camera);
const metaProg    = new MetaProgressionManager();
const build       = new BuildManager();
const abilitySys  = new AbilitySystem();
const skillTree   = new SkillTreeSystem();

// ── Phase 2 systems ───────────────────────────────────────────────────────────

const aiSystem       = new AISystem();
const encounterSys   = new EncounterSystem();
const dungeonMgr     = new DungeonManager(null);   // zoneManager wired below
const modifierSys    = new ModifierSystem();
const difficultyMgr  = new DifficultyManager();
const gameFlow       = new GameFlowManager(hud);
const perfMgr        = new PerformanceManager();
const juiceSys       = new JuiceSystem(scene, camera);
const kitbash        = new KitbashSystem();
const visualPass     = new VisualPassSystem();
const styleEnforcer  = new StyleEnforcer();

// ── Phase 3 systems ───────────────────────────────────────────────────────────

const audioSys       = new AudioSystem();
const animSys        = new AnimationSystem();
const charAnim       = new CharAnimator();
const overheadBars   = new OverheadBarSystem();
const hitFX            = new HitEffectSystem(scene);
const abilityFX        = new AbilityEffectSystem(scene);
const statusFX         = new StatusEffectSystem();
const statusVisSys     = new StatusVisualSystem(scene);
const enemyAbilitySys  = new EnemyAbilitySystem();
const telegraphSys     = new EnemyTelegraphSystem(scene);
const projectileSys    = new ProjectileSystem(scene);
const lightningPulseSys = new LightningPulseSystem(scene);
const statPanel      = new StatAllocPanel();
const astoniaPanel   = new AstoniaSkillPanel();
const contentMgr     = new ContentManager();
const clanMgr        = new ClanManager();
const clanSpawnerSys = new ClanSpawnerSystem();
const altarSys       = new AltarSystem(clanMgr, inventory);
const spawnerSys     = new SpawnerSystem();
const pentagramSys   = new PentagramSystem();

// ── Combat + zone setup ───────────────────────────────────────────────────────

const combat = new CombatSystem(scene, player, { hud, eventBus });
combat.build = build;

const zone    = new ZoneManager(scene, camera, renderer, combat, hud, player);
// saveId is set immediately after menu choice (new or load) so every
// subsequent saveGame() call writes to the correct slot.
const saveCtx = { saveId: null, player, zone, combat, questSys, inventory, progression, worldState, build, skillTree };

zone.progressionManager = progression;
dungeonMgr._zoneManager = zone;

// Phase 3 systems that need zone reference
const hideoutSys    = new HideoutSystem(clanMgr, zone);
const teleporterSys = new TeleporterSystem(zone);

// ── Register all authored zones before first load ─────────────────────────────

registerCameronZones(zone);
registerSewerZones(zone);
registerSkellie4Zones(zone);
registerAstonZones(zone);
registerServiceZones(zone);
registerZombiesZones(zone);
registerPentagramZones(zone);

// ── Context wiring ────────────────────────────────────────────────────────────

abilitySys.setContext({ scene, player, build, projectileSys, lightningPulse: lightningPulseSys, statusFX });
encounterSys.setContext({ scene, player, hud, aiSystem });
clanSpawnerSys.setContext({ scene, player, hud, clanManager: clanMgr, inventory });
pentagramSys.setContext({ scene, player, hud });
teleporterSys.setContext({ player, hud });
altarSys.setContext({ player, hud });
spawnerSys.setContext({ scene });
audioSys.setContext({ player });
hud.setEventBus(eventBus);   // wire chat log + item event emission
animSys.setContext({ player });
charAnim.setContext({ player });
overheadBars.setContext({ player, build });
hitFX.setContext({ player });
abilityFX.setContext({ player });
statusFX.setContext({ player });
statusVisSys.setContext({ player });
enemyAbilitySys.setContext({ player, statusFX });
telegraphSys.setContext({ scene });
projectileSys.setContext({ scene, player });
lightningPulseSys.setContext({ scene, player });
statPanel.setContext({ build, onAllocate: () => { _syncBuildToHUD(); player.maxHp = build.getMaxHP(); } });
astoniaPanel.setContext({
  build,
  player,
  eventBus,
  bottomOffset: LAYOUT.BOTTOM_H,
  topOffset:    LAYOUT.TOP_H,
  onAllocate: () => {
    _syncBuildToHUD();
    player.maxHp      = build.getMaxHP();
    player.speedMultiplier = build.getSpeedMultiplier();
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function _syncBuildToHUD() {
  const def = build.getClassDef();
  hud.setClassStats(
    def.name,
    build.getStats(),
    { dmg: build.getDamageMultiplier(), spd: build.getSpeedMultiplier(), crit: build.getCritChance() },
    build.getUnspentPoints(),
  );
  // Populate the derived-stats row in the bottom HUD stats section
  hud.setDerivedStats(build.getDerivedStats?.() ?? {});
  player.speedMultiplier = build.getSpeedMultiplier();
  player.maxHp           = build.getMaxHP();
}

function _openSkillTree() {
  const nodes = skillTree.getClassNodes();
  hud.showSkillTree(
    nodes,
    id => skillTree.isUnlocked(id),
    id => skillTree.canUnlock(id),
    skillTree.getPoints(),
    id => {
      skillTree.unlock(id, build, abilitySys);
      _syncBuildToHUD();
      _openSkillTree();
    },
  );
}

function _applyTheme(themeName) {
  kitbash.setTheme(themeName);
  visualPass.setTheme(themeName);
  styleEnforcer.setTheme(themeName);
}

/** Emit interaction events for special entities within reach of the player. */
function _checkSpecialInteract(pos) {
  const INTERACT_RADIUS = 2.5;
  const r2 = INTERACT_RADIUS * INTERACT_RADIUS;
  const fullZone = zone._generatedZones?.get(zone.activeId);
  if (!fullZone?.entities) return;

  for (const ent of fullZone.entities) {
    const wx = ent.position?.x ?? 0;
    const wz = ent.position?.y ?? 0;  // zone format: position.y = world Z
    const dx = pos.x - wx, dz = pos.z - wz;
    if (dx * dx + dz * dz > r2) continue;

    switch (ent.type) {
      case 'altar':
        eventBus.emit('entity_interact', { payload: { entityType: 'altar',      entityId: ent.id } });
        break;
      case 'teleporter':
        eventBus.emit('entity_interact', { payload: { entityType: 'teleporter', entityId: ent.id } });
        break;
      case 'pentagram':
        eventBus.emit('entity_interact', { payload: { entityType: 'pentagram',  entityId: ent.id } });
        break;
      case 'shop':
        eventBus.emit('shop_opened',        { entityId: ent.id });
        break;
      case 'bank':
        eventBus.emit('bank_opened',        { entityId: ent.id });
        break;
      case 'clan_master':
        eventBus.emit('clan_master_opened', { entityId: ent.id });
        break;
    }
  }
}

// ── Event subscriptions ───────────────────────────────────────────────────────

progression.init(eventBus);
feedbackSys.subscribe(eventBus);
metaProg.init(eventBus);
build.init(eventBus);
skillTree.init(null, null, eventBus);
difficultyMgr.init(eventBus);
gameFlow.init(eventBus);
juiceSys.subscribe(eventBus);
clanMgr.init(eventBus);
hideoutSys.init(eventBus);
audioSys.subscribe(eventBus);

// Kill → quest progress + XP + sewer boss completion
eventBus.on('enemy_killed', ({ payload }) => {
  questSys.notify('kill');
  const xpBase  = payload.xpValue ?? 10;
  const scaling = difficultyMgr.getScaling();
  progression.addXP(Math.floor(xpBase * scaling.xpMultiplier));
  hud.setLevel(progression.getLevel(), progression.getXP(), progression.getXPToNext());

  // Sewer boss death triggers dungeon completion
  if (payload.enemyId === 'sb_boss' || payload.id === 'sb_boss') {
    eventBus.emit('dungeon_completed', {
      instanceId: 'sewers_boss',
      goldReward: 120,
      xpReward:   200,
      kills:      1,
      duration:   0,
    });
  }
});

// Level up → sync player + build stats + award skill point + grant stat points
eventBus.on('level_up', ({ payload }) => {
  player.level = payload.level;
  build.onLevelUp(payload.level);      // auto stat growth from class def
  build.grantStatPoints(5);            // +5 allocatable stat points per level
  build.grantSkillPoints(3);           // +3 allocatable class skill points per level
  skillTree.addSkillPoint();
  _syncBuildToHUD();
  player.hp = Math.min(player.hp + 20, player.maxHp); // partial HP restore on level-up
  hud.setLevel(payload.level, progression.getXP(), progression.getXPToNext());
  // Refresh astonia panel immediately (new points available)
  if (astoniaPanel.isVisible()) astoniaPanel.show();
  // Auto-show stat allocation panel after the level-up banner fades (600ms delay)
  setTimeout(() => statPanel.show(), 600);
});

// Quest events → HUD
eventBus.on('quest_progress', () => hud.setQuests(questSys.all()));
eventBus.on('quest_complete',  () => hud.setQuests(questSys.all()));

// Zone cleared → mark progression complete
eventBus.on('zone_state_changed', ({ payload }) => {
  if (payload.state === 'cleared') progression.completeZone(payload.zoneId);
});

// Meta perk unlocked → rebuild multipliers in build
eventBus.on('perk_unlocked', () => {
  build.setMetaMultipliers(metaProg.getMultipliers());
  _syncBuildToHUD();
});

// Key pickup → inventory HUD
eventBus.on('key_collected', () => hud.setInventory(inventory.items));

// Dungeon completed → progression + gold reward
eventBus.on('dungeon_completed', ({ payload }) => {
  const gold = payload.goldReward ?? 0;
  if (gold > 0) metaProg.addGold(gold);
});

// Player respawn → reset HP + restore
eventBus.on('player_respawn', () => {
  player.hp = player.maxHp;
  hud.setPlayerHP(player.hp, player.maxHp);
});

// Clan jewel claimed → refresh HUD inventory
eventBus.on('clan_jewel_claimed',      () => hud.setInventory(inventory.items));
eventBus.on('clan_jewel_deposited',    () => hud.setInventory(inventory.items));
eventBus.on('spawner_claim_completed', () => hud.setInventory(inventory.items));

// Safe/combat zone tracking
eventBus.on('zone_loaded', ({ payload }) => {
  const zoneId = payload?.zoneId ?? zone.activeId;
  const fullZone = zone._generatedZones?.get(zoneId);
  if (fullZone?.isSafeZone) {
    hud.showBanner('Safe Zone', '#2ecc71', 1500);
  }
});

// Ability failed (out of mana) → brief HUD notice
eventBus.on('ability_failed', ({ payload }) => {
  if (payload?.reason === 'oom') {
    hud.showProgress('Out of mana!', '#2980b9');
  }
});

// Centralized damage number spawning (all damage sources route through here)
eventBus.on('enemy_damaged', ({ payload }) => {
  if (!payload) return;
  const pos = payload.position ?? null;
  if (pos) hud.spawnDamageNumber(pos, payload.amount ?? 0, payload.isCrit ?? false);
});

// Burn DoT tick → apply damage to target entity
eventBus.on('status_tick', ({ payload }) => {
  if (!payload) return;
  const { targetId, damage } = payload;
  if (!damage) return;
  if (targetId === 'player') {
    player.hp = Math.max(0, (player.hp ?? 0) - damage);
    hud.setPlayerHP(player.hp, player.maxHp);
    if (player.hp <= 0) eventBus.emit('player_died', {});
  } else {
    const enemy = zone.registry?.getEntityById(targetId);
    if (enemy?.alive) {
      const dead = enemy.takeDamage(damage);
      eventBus.emit('enemy_damaged', {
        enemyId: targetId, amount: damage, isCrit: false,
        position: { x: enemy.mesh.position.x, y: enemy.mesh.position.y, z: enemy.mesh.position.z },
      });
      if (dead) {
        eventBus.emit('enemy_killed', {
          enemyId: targetId, xpValue: enemy.xpValue ?? 10,
          x: enemy.mesh.position.x, z: enemy.mesh.position.z,
        });
      }
    }
  }
});

// ── Player damage with shield absorption ──────────────────────────────────────
// Shield absorbs damage BEFORE HP, so magic_shield intercepts hits cleanly.
eventBus.on('player_damaged', ({ payload }) => {
  if (!payload?.damage) return;
  let dmg = Math.max(1, Math.round(payload.damage * (player._weakenMult ?? 1.0)));

  // Armor reduction (armorSkill-driven — reduces all incoming physical damage)
  const armorRed = build?.getArmorReduction?.() ?? 0;
  if (armorRed > 0) dmg = Math.max(1, Math.round(dmg * (1 - armorRed)));

  // Parry reduction
  if (player._parryActive) dmg = Math.max(1, Math.round(dmg * 0.5));

  // Shield absorption (magic_shield)
  if (player.shield > 0) {
    if (player.shield >= dmg) {
      player.shield -= dmg;
      dmg = 0;
      eventBus.emit('shield_absorbed', { absorbed: payload.damage, remaining: player.shield });
    } else {
      dmg -= player.shield;
      player.shield = 0;
      eventBus.emit('shield_broken', {});
    }
  }

  if (dmg > 0) {
    player.hp = Math.max(0, (player.hp ?? 100) - dmg);
    hud.setPlayerHP(player.hp, player.maxHp);
    hud.spawnDamageNumber({ x: player.mesh.position.x, y: 1.6, z: player.mesh.position.z }, dmg, false);
    if (player.hp <= 0) eventBus.emit('player_died', {});
  }
});

// Save triggers via gameplay events
eventBus.on('enemy_killed',   () => saveGame(saveCtx));
eventBus.on('loot_collected', () => saveGame(saveCtx));
eventBus.on('quest_progress', () => saveGame(saveCtx));

zone.onSave = () => saveGame(saveCtx);

// On every zone load: run visual pass, then wire systems
zone.onLoad = (questDefs) => {
  const zoneId     = zone.activeId;
  const themeName  = _getZoneTheme(zoneId);
  _applyTheme(themeName);

  // Visual decoration pass (runs after tileRenderer)
  if (zone.activeGrid) {
    visualPass.unload(scene);
    visualPass.decorate(zone.activeGrid, scene, zone.rng);
    styleEnforcer.correct(scene);
  }

  // Full zone data for encounters, spawnPoints, entities
  const fullZone = zone._generatedZones?.get(zoneId);

  // Fix: pass grid so encounterSystem._grid is populated
  const gridOffset = zone.activeGrid ? (zone.activeGrid[0].length - 1) / 2 : 0;

  // Load per-zone systems into systemMgr
  systemMgr.replaceAll(
    zone.entities,
    zone.enemySys,
    zone.triggers,
    combat,
    worldState,
    feedbackSys,
    abilitySys,
    animSys,
    charAnim,
    overheadBars,
    hitFX,
    abilityFX,
    statusFX,
    statusVisSys,
    enemyAbilitySys,
    telegraphSys,
    projectileSys,
    lightningPulseSys,
    { sys: aiSystem,       throttleMs: THROTTLE.ai },
    encounterSys,
    juiceSys,
    spawnerSys,
    clanSpawnerSys,
    altarSys,
    pentagramSys,
    teleporterSys,
  );

  systemMgr.initZone(
    { id: zoneId, grid: zone.activeGrid, gridOffset },
    zone.registry,
    eventBus,
    zone.rng,
  );

  // Wire build + AI into zone's EnemySystem
  if (zone.enemySys) {
    zone.enemySys.build    = build;
    zone.enemySys.aiSystem = aiSystem;
  }

  // Load encounter defs (top-level `encounters` array, not systems.encounters)
  if (fullZone?.encounters?.length) {
    encounterSys.loadEncounters(fullZone.encounters);
  } else if (fullZone?.systems?.encounters?.length) {
    // Fallback for procedurally-generated zones that put it in systems
    encounterSys.loadEncounters(fullZone.systems.encounters);
  }

  // Load continuous spawn points for SpawnerSystem
  spawnerSys.loadSpawnPoints(fullZone?.spawnPoints ?? []);

  // Load altar entities for AltarSystem
  altarSys.loadAltars(fullZone?.entities ?? []);

  questSys.mergeQuests(questDefs);
  hud.setQuests(questSys.all());
};

// T key — toggle skill tree modal
window.addEventListener('keydown', e => {
  if (e.key.toLowerCase() !== 't') return;
  if (hud.isSkillTreeOpen()) hud.hideSkillTree();
  else _openSkillTree();
});

// C key — toggle Astonia character / skill panel
window.addEventListener('keydown', e => {
  if (e.key.toLowerCase() !== 'c') return;
  astoniaPanel.toggle();
});

// P key — toggle stat allocation panel
window.addEventListener('keydown', e => {
  if (e.key.toLowerCase() !== 'p') return;
  statPanel.toggle();
});

// M key — toggle content mode (astonia ↔ custom)
window.addEventListener('keydown', e => {
  if (e.key.toLowerCase() !== 'm') return;
  contentMgr.toggle();
  hud.showBanner(`Content Mode: ${contentMgr.getContentMode()}`, '#3498db', 1500);
});

// ── Startup ───────────────────────────────────────────────────────────────────

(async () => {
  metaProg.load();
  difficultyMgr.load();
  clanMgr.load?.();

  const choice = await showMenu();
  // choice is 'new'  OR  { action:'load', saveId:string }
  const isLoad  = typeof choice === 'object' && choice.action === 'load';
  const save    = isLoad ? loadGame(choice.saveId) : null;

  if (isLoad && save) {
    // Restore active save slot so all future saveGame() calls go to same slot
    saveCtx.saveId = choice.saveId;
    setActiveSaveId(choice.saveId);
  } else {
    // Brand-new game — allocate a fresh slot immediately
    const id = newSaveId();
    saveCtx.saveId = id;
    setActiveSaveId(id);
  }

  build.setMetaMultipliers(metaProg.getMultipliers());

  if (save?.build) {
    build.load(save.build);
  } else {
    // New game — let player pick their class
    const chosenClass = await showClassSelect();
    build.setClass(chosenClass);
  }

  // Rebuild the player's visual mesh for the chosen/restored class.
  // Must come after build.load / build.setClass so getClass() is correct.
  player.setClass(build.getClass());

  abilitySys.setClass(build.getClass());
  skillTree.setClass(build.getClass());

  if (save?.skillTree) {
    skillTree.load(save.skillTree, build, abilitySys);
  }

  if (save?.progression) progression.load(save.progression);
  if (save?.worldState)  worldState.load(save.worldState);

  progression.setStartingZones([
    // Cameron path
    'Cameron', 'cameron_wilderness', 'cameron_dungeon_entrance',
    // Sewers dungeon
    'sewers_entry', 'sewers_room_1', 'sewers_room_2', 'sewers_boss',
    // Farming / PvP zones
    'skellie4', 'clan_spawner_zone',
    // Aston City
    'aston_core', 'aston_service_district', 'aston_zombies_ii',
    // Ritual
    'pentagram_pit',
  ]);

  player.level = progression.getLevel();
  build.onLevelUp(progression.getLevel());
  _syncBuildToHUD();
  hud.setLevel(progression.getLevel(), progression.getXP(), progression.getXPToNext());

  // Unlock default teleport destinations
  teleportUnlock('cameron');
  teleportUnlock('aston_core');

  // Preload audio — runs after menu click, so AudioContext is un-suspended
  await audioSys.preload();

  gameFlow.startTutorial();

  // Show the Astonia character panel on the left side from the start
  astoniaPanel.show();

  // Seed the chat log with startup hints
  hud.addChatMessage('Welcome to Astoria.', '#1e1e1e');
  hud.addChatMessage('[WASD] move  [1-5] abilities  [C] character', '#181818');

  if (save?.player?.zoneId) {
    if (save.quests?.length) questSys.restoreFromSave(save.quests);
    await zone.load(save.player.zoneId);
    player.mesh.position.set(save.player.x, save.player.y, save.player.z);
    player.hp = save.player.hp;
    inventory.items = [...(save.player.inventory ?? [])];
    hud.setPlayerHP(player.hp, player.maxHp);
    hud.setInventory(inventory.items);
    hud.setQuests(questSys.all());
  } else {
    console.log('[Cameron] Entered unified zone');
    await zone.load('Cameron');
    hud.setInventory(inventory.items);
    hud.setQuests(questSys.all());
  }

  setInterval(() => { saveGame(saveCtx); metaProg.save(); difficultyMgr.save(); }, 15_000);
  window.addEventListener('beforeunload', () => { saveGame(saveCtx); metaProg.save(); difficultyMgr.save(); });
  window.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveGame(saveCtx); }
  });

  perfMgr.enableCull(40);

  animate();

  // ── Debug console helpers ─────────────────────────────────────────────────
  window.__debug = {
    // ── Single zone controls ──────────────────────────────────────────────
    regenSameSeed:    () => zone.debugRegenSameSeed(),
    regenNewSeed:     () => zone.debugRegenNewSeed(),
    switchTemplate:   (name) => zone.debugSwitchTemplate(name),
    applyConstraints: (c)    => zone.debugApplyConstraints(c),
    loadGen:          (config, template, constraints) => zone.loadGeneratedZone(config, template, constraints),
    loadZone:         (id) => zone.load(id),

    // ── Batch controls ─────────────────────────────────────────────────────
    batch: {
      gen1:     ()       => generateZoneBatch([EXAMPLE_BATCH[0]]),
      gen5:     ()       => generateZoneBatch(EXAMPLE_BATCH),
      gen20:    ()       => generateBatchN(20),
      run:      (inputs) => generateZoneBatch(inputs),
      example:  ()       => generateZoneBatch(EXAMPLE_BATCH),
      load:     (id)     => loadZoneFromBatch(id, zone),
      list:     ()       => listBatchZones(),
      get:      (id)     => getBatchZone(id),
      snapshot: ()       => getBatchZonesSnapshot(),
      clear:    ()       => clearBatch(),
      inspect:  (id)     => { const e = getBatchZone(id); if (e) logContent(e.zone); },
    },

    // ── Planner controls ───────────────────────────────────────────────────
    planner: {
      run:     (config) => generateFromPrompt(config),
      plan:    (config) => planBatch(config),
      example: ()       => generateFromPrompt(EXAMPLE_PROMPT),
    },

    // ── Progression controls ───────────────────────────────────────────────
    progression: {
      inspect:   ()       => progression.inspect(),
      unlock:    (id)     => progression.unlock(id),
      lock:      (id)     => progression.lockZone(id),
      addXP:     (n)      => progression.addXP(n),
      level:     ()       => progression.getLevel(),
      flag:      (f)      => progression.addFlag(f),
      hasFlag:   (f)      => progression.hasFlag(f),
      keyItem:   (item)   => progression.addKeyItem(item),
    },

    // ── World state controls ───────────────────────────────────────────────
    worldState: {
      inspect:   ()          => worldState.inspect(),
      get:       (id)        => worldState.getState(id),
      setState:  (id, state) => worldState.setState(id, state),
      addMod:    (id, mod)   => worldState.addModifier(id, mod),
      removeMod: (id, mod)   => worldState.removeModifier(id, mod),
    },

    // ── Feedback controls ──────────────────────────────────────────────────
    feedback: {
      toggle:   () => feedbackSys.setEnabled(!feedbackSys._enabled),
      banner:   (text, color) => hud.showBanner(text, color),
      progress: (text)        => hud.showProgress(text),
      flash:    (color, a)    => hud.screenFlash(color, a),
    },

    // ── Meta progression controls ──────────────────────────────────────────
    meta: {
      inspect:  () => metaProg.inspect(),
      addGold:  (n) => metaProg.addGold(n),
      buyPerk:  (id) => {
        metaProg.buyPerk(id);
        build.setMetaMultipliers(metaProg.getMultipliers());
        _syncBuildToHUD();
      },
      perks:    () => metaProg.getAvailablePerks(),
    },

    // ── Build / class controls ─────────────────────────────────────────────
    build: {
      inspect:   () => build.inspect(),
      setClass:  (id) => {
        build.setClass(id);
        abilitySys.setClass(id);
        skillTree.setClass(id);
        _syncBuildToHUD();
      },
      stats:       () => build.getStats(),
      unspent:     () => build.getUnspentPoints(),
      // Allocate a stat point programmatically
      allocate:    (stat) => { build.applyStatPoint(stat); _syncBuildToHUD(); },
      // Grant extra stat points for testing
      grantPoints: (n = 5) => { build.grantStatPoints(n); _syncBuildToHUD(); statPanel.show(); },
      // Force a simulated level-up (grants stat + skill points, auto growth)
      forceLevelUp: () => {
        const level = progression.getLevel() + 1;
        progression._level = level; // direct mutation for debug only
        eventBus.emit('level_up', { level });
        hud.setLevel(level, progression.getXP(), progression.getXPToNext());
        console.log(`[Debug] Forced level-up → ${level}`);
      },
      // Open stat panel
      openStats: () => statPanel.show(),
    },

    // ── Astonia skill panel ────────────────────────────────────────────────
    skillPanel: {
      show:   () => astoniaPanel.show(),
      hide:   () => astoniaPanel.hide(),
      toggle: () => astoniaPanel.toggle(),
    },

    // ── Combat debug ───────────────────────────────────────────────────────
    combat: {
      inspect:      () => combat.inspect?.(),
      debug:        (on = true) => combat.setDebug?.(on),
      weaponDmg:    () => build.getWeaponDamage(),
      atkSpeed:     () => build.getAttackSpeed(),
      armorRed:     () => `${(build.getArmorReduction() * 100).toFixed(1)}%`,
      // Toggle surround hit manually for testing
      surround:     (on) => { player.surroundHitActive = on ?? !player.surroundHitActive; console.log(`Surround: ${player.surroundHitActive}`); },
      // Simulate a hit and log damage after reductions
      simHit:       (raw = 30) => eventBus.emit('player_damaged', { damage: raw, sourceId: 'debug' }),
    },

    // ── Skill system debug ─────────────────────────────────────────────────
    skills: {
      // Print all computed class skills
      inspect:      () => build.inspect(),
      getSkill:     (id) => `${id}: raw=${build.getRawSkill(id)}  computed=${build.getComputedSkill(id)}`,
      addPoint:     (id) => build.applySkillPoint(id),
      grantPoints:  (n = 5) => { build.grantSkillPoints(n); astoniaPanel.show(); },
      unspent:      () => build.getUnspentSkillPoints(),
      // Simulate combat with current skills
      simCombat:    () => {
        const dmg  = build.getWeaponDamage();
        const spd  = build.getAttackSpeed();
        const armor= build.getArmorReduction();
        const dps  = dmg / spd;
        console.log(`[SimCombat] Weapon=${dmg}  Speed=${spd.toFixed(3)}s  Armor=${(armor*100).toFixed(1)}%  DPS=${dps.toFixed(1)}`);
      },
      // Print spell damage for a skill+scalar pair
      simSpell:     (skillId = 'fire', scalar = 1.6) => {
        const dmg = build.getSpellDamage(skillId, scalar);
        console.log(`[SimSpell] ${skillId} × ${scalar} = ${dmg}`);
        return dmg;
      },
    },

    // ── Ability controls ───────────────────────────────────────────────────
    ability: {
      inspect:    () => abilitySys.inspect(),
      // Activate by slot index (0–4) or by name
      activate:   (i = 0) => abilitySys.activate(i),
      // Legacy shorthand
      activateQ:  () => abilitySys.activate(0),
      activateF:  () => abilitySys.activate(1),
      activate3:  () => abilitySys.activate(2),
      activate4:  () => abilitySys.activate(3),
      activate5:  () => abilitySys.activate(4),
      noCooldown: (v = true) => { abilitySys.instantCooldown = v; },
      // Show current slots + cooldowns in console
      slots:      () => abilitySys.getSlots().forEach((s, i) =>
        console.log(`  [${i}] ${s?.def?.id ?? '—'}  cd=${s?.currentCooldown?.toFixed(2) ?? '—'}`)),
      // Upgrade a slot to a specific ability id: __debug.ability.upgrade(2, 'magic_missile')
      upgrade:    (i, id) => { abilitySys.upgradeSlot(i, id); },
    },

    // ── Skill tree controls ────────────────────────────────────────────────
    skillTree: {
      inspect:   () => skillTree.inspect(),
      unlockAll: () => { skillTree.unlockAll(build, abilitySys); _syncBuildToHUD(); },
      reset:     () => { skillTree.reset(build); _syncBuildToHUD(); },
      addPoint:  (n = 1) => { for (let i = 0; i < n; i++) skillTree.addSkillPoint(); },
    },

    // ── AI controls ────────────────────────────────────────────────────────
    ai: {
      inspect:        () => aiSystem.inspect?.(),
      setAggroRadius: (r) => aiSystem.setAggroRadius(r),
      forceAggro:     (e) => aiSystem.forceAggro(e),
    },

    // ── Dungeon controls ───────────────────────────────────────────────────
    dungeon: {
      inspect:    () => dungeonMgr.inspect?.(),
      create:     (cfg) => dungeonMgr.createInstance(cfg),
      enter:      (inst) => dungeonMgr.enter(inst, player),
      exit:       () => dungeonMgr.exit(player),
      test:       () => dungeonMgr.createTestDungeon(),
      enterSewer: () => zone.load('sewers_entry'),
    },

    // ── Difficulty controls ────────────────────────────────────────────────
    difficulty: {
      inspect:  () => difficultyMgr.inspect(),
      tier:     () => difficultyMgr.getTier(),
      setTier:  (t) => { difficultyMgr.setTier(t); },
      reset:    () => difficultyMgr.reset(),
      scaling:  () => difficultyMgr.getScaling(),
    },

    // ── Performance controls ───────────────────────────────────────────────
    perf: {
      inspect:      () => perfMgr.inspect(),
      toggleDebug:  () => perfMgr.toggleDebug(),
      enableCull:   (r) => perfMgr.enableCull(r),
      disableCull:  () => perfMgr.disableCull(),
      fps:          () => perfMgr.getFPS(),
    },

    // ── Juice controls ─────────────────────────────────────────────────────
    juice: {
      inspect:      () => juiceSys.inspect(),
      toggle:       () => juiceSys.toggle(),
      setIntensity: (v) => juiceSys.setIntensity(v),
    },

    // ── Per-part character animation controls ────────────────────────────
    charAnim: {
      inspect:   ()           => charAnim.inspect(),
      debug:     (on = true)  => charAnim.setDebug(on),
      // Manually fire a one-shot: __debug.charAnim.test('player', 'attack')
      test:      (id, key)    => charAnim.test(id, key),
      hitPlayer: ()           => charAnim.trigger('player', 'hit'),
      attackPlayer: ()        => charAnim.trigger('player', 'attack'),
    },

    // ── Root-mesh animation controls ──────────────────────────────────────
    anim: {
      inspect:        () => animSys.inspect(),
      debug:          (on = true) => animSys.setDebug(on),
      // Trigger an animation on any entity by id, or 'player'
      //   __debug.anim.trigger('player', 'cast')
      //   __debug.anim.trigger('enemy_01', 'hit')
      trigger:        (id, type) => animSys.trigger(id, type),
      // Blast all living enemies with an animation
      //   __debug.anim.triggerEnemies('death')
      triggerEnemies: (type) => animSys.triggerEnemies(type),
      // Shorthand helpers for console testing
      attackPlayer:   () => animSys.trigger('player', 'attack'),
      castPlayer:     () => animSys.trigger('player', 'cast'),
      parryPlayer:    () => animSys.trigger('player', 'parry'),
      hitAllEnemies:  () => animSys.triggerEnemies('hit'),
      killAllEnemies: () => animSys.triggerEnemies('death'),
    },

    // ── Inventory / equipment debug ────────────────────────────────────────
    inv: {
      // Add a single item to inventory: __debug.inv.add({ id:'sword', name:'Sword', type:'weapon', icon:'🗡' })
      add: (item) => {
        inventory.items.push(item);
        hud.setInventory(inventory.items);
      },
      clear: () => {
        inventory.items = [];
        hud.setInventory(inventory.items);
      },
      // Populate the grid with representative test items of each type
      testItems: () => {
        inventory.items = [
          { id: 'iron_sword',     name: 'Iron Sword',    type: 'weapon',     icon: '🗡' },
          { id: 'leather_armor',  name: 'Leather Armor', type: 'armor',      icon: '🛡' },
          { id: 'wood_shield',    name: 'Wood Shield',   type: 'offhand',    icon: '⊞'  },
          { id: 'gold_ring',      name: 'Gold Ring',     type: 'ring',       icon: '○'  },
          { id: 'hp_potion',      name: 'HP Potion',     type: 'consumable', icon: '⚗', qty: 5 },
          { id: 'mp_potion',      name: 'MP Potion',     type: 'consumable', icon: '✦', qty: 3 },
          { id: 'zone_key',       name: 'Zone Key',      keyId: 1 },
        ];
        hud.setInventory(inventory.items);
        console.log('[Inv] Test items loaded into inventory grid');
      },
      // Simulate equipping: __debug.inv.equip({ id:'sword2', name:'Steel Sword', type:'weapon', icon:'⚔' })
      equip: (item) => {
        if (!item?.type) { console.warn('[Inv] item.type required'); return; }
        hud.setEquipment({ [item.type]: item });
      },
      inspect: () => {
        console.group('[Inventory]');
        hud._invSlots.forEach((item, i) => item && console.log(` [${i}] ${item.id}`));
        console.log('[Equipment]', hud._equipment);
        console.groupEnd();
      },
    },

    // ── Chat debug ─────────────────────────────────────────────────────────
    chat: {
      // Post a test line: __debug.chat.say('Hello world', '#f1c40f')
      say:   (text, color) => hud.addChatMessage(text, color),
      clear: () => {
        hud._chatEl.innerHTML = '';
        hud._chatLines = [];
      },
      // Fire a burst of combat messages to stress-test scroll
      stress: (n = 30) => {
        for (let i = 0; i < n; i++) {
          hud.addChatMessage(`[${i}] You hit Zombie for ${Math.floor(Math.random()*80+10)}.`, '#555');
        }
      },
    },

    // ── Audio controls ─────────────────────────────────────────────────────
    audio: {
      inspect:    () => audioSys.inspect(),
      toggle:     () => audioSys.toggle(),
      volume:     (v) => audioSys.setVolume(v),
      debug:      (on = true) => audioSys.setDebug(on),
      test:       (id) => audioSys.testPlay(id),
      // Fire every registered sound in sequence — quick asset sanity check
      testAll:    () => ALL_SOUND_IDS.forEach((id, i) =>
        setTimeout(() => audioSys.testPlay(id), i * 400)
      ),
    },

    // ── Hit effects ───────────────────────────────────────────────────────
    hitfx: {
      inspect:   () => hitFX.inspect(),
      toggle:    () => hitFX.toggle(),
      debug:     (on = true) => hitFX.setDebug(on),
      test:      (x = 0, z = 0) => hitFX.test(x, z),
    },

    // ── Ability VFX ───────────────────────────────────────────────────────
    abilityfx: {
      inspect:   () => abilityFX.inspect(),
      toggle:    () => abilityFX.toggle(),
      debug:     (on = true) => abilityFX.setDebug(on),
      test:      (id) => abilityFX.spawnEffect(id, 'player'),
    },

    // ── Status effects ────────────────────────────────────────────────────
    statusfx: {
      inspect:    (id = 'player') => statusFX.inspect(id),
      inspectAll: () => statusFX.inspectAll(),
      debug:      (on = true) => statusFX.setDebug(on),
      apply:      (targetId, effectId, opts) => statusFX.applyEffect(targetId, effectId, opts),
      remove:     (targetId, effectId) => statusFX.removeEffect(targetId, effectId),
      clear:      (targetId) => statusFX.clearEffects(targetId),
      expire:     (targetId, effectId) => statusFX.forceExpire(targetId, effectId),
    },

    // ── Status visuals ────────────────────────────────────────────────────
    statusvis: {
      inspect:  () => statusVisSys.inspect(),
      toggle:   () => statusVisSys.toggle(),
      debug:    (on = true) => statusVisSys.setDebug(on),
      test:     (id, effect) => statusVisSys.test(id, effect),
    },

    // ── Enemy abilities ───────────────────────────────────────────────────
    enemyability: {
      inspect:      (id) => enemyAbilitySys.inspect(id),
      inspectAll:   () => enemyAbilitySys.inspectAll(),
      debug:        (on = true) => enemyAbilitySys.setDebug(on),
      force:        (enemyId, abilityId) => enemyAbilitySys.force(enemyId, abilityId),
      list:         (type) => enemyAbilitySys.listAbilities(type),
    },

    // ── Telegraph visuals ─────────────────────────────────────────────────
    telegraph: {
      inspect:  () => telegraphSys.inspect(),
      toggle:   () => telegraphSys.toggle(),
      debug:    (on = true) => telegraphSys.setDebug(on),
      test:     (id, ability, ms) => telegraphSys.test(id, ability, ms),
    },

    // ── Projectile system ─────────────────────────────────────────────────
    proj: {
      inspect:  () => projectileSys.inspect(),
      toggle:   () => projectileSys.setEnabled(),
      debug:    (on = true) => projectileSys.setDebug(on),
      // Spawn a test projectile heading north from the player
      //   __debug.proj.test('fireball')
      //   __debug.proj.test('lightning_ball')
      test:     (id = 'fireball') => projectileSys.test(id),
    },

    // ── Lightning pulse ────────────────────────────────────────────────────
    pulse: {
      inspect:  () => lightningPulseSys.inspect(),
      debug:    (on = true) => lightningPulseSys.setDebug(on),
      // Force-activate: __debug.pulse.test(3, 2, 30) → 3s, 2 nodes, 30 dmg
      test:     (dur, nodes, dmg) => lightningPulseSys.test(dur, nodes, dmg),
      stop:     () => lightningPulseSys.stop(),
      active:   () => lightningPulseSys.isActive(),
    },

    // ── Magic shield ───────────────────────────────────────────────────────
    shield: {
      inspect:  () => console.log(`[Shield] ${player.shield} / ${player.maxShield}  expiry=${player._shieldExpiry ? Math.max(0,(player._shieldExpiry-performance.now())/1000).toFixed(1)+'s' : 'none'}`),
      apply:    (val = 100, dur = 5) => { player.shield = val; player.maxShield = val; player._shieldExpiry = performance.now() + dur * 1000; console.log(`[Shield] forced ${val} for ${dur}s`); },
      clear:    () => { player.shield = 0; player.maxShield = 0; player._shieldExpiry = null; console.log('[Shield] cleared'); },
      simHit:   (dmg = 20) => eventBus.emit('player_damaged', { damage: dmg, sourceId: 'debug' }),
    },

    // ── Visual controls ────────────────────────────────────────────────────
    visual: {
      kitbash: {
        inspect: () => kitbash.inspect(),
        toggle:  () => kitbash.toggle(),
        theme:   (t) => { _applyTheme(t); },
      },
      visualPass: {
        inspect: () => visualPass.inspect(),
        toggle:  () => visualPass.toggle(),
      },
      styleEnforcer: {
        inspect: () => styleEnforcer.inspect(scene),
        correct: () => styleEnforcer.correct(scene),
        toggle:  () => styleEnforcer.toggle(),
      },
    },

    // ── Game flow controls ─────────────────────────────────────────────────
    gameFlow: {
      inspect:      () => gameFlow.inspect(),
      state:        () => gameFlow.getState(),
      forceState:   (s) => gameFlow.forceState(s),
      skipTutorial: () => gameFlow.skipTutorial(),
    },

    // ── Modifier controls ──────────────────────────────────────────────────
    modifiers: {
      roll:      (seed) => modifierSys.rollModifiers(difficultyMgr.getScaling(), seed ?? Date.now()),
      applyAll:  (mods, ctx) => modifierSys.applyAll(mods, ctx),
      removeAll: (ctx) => modifierSys.removeAll(ctx),
    },

    // ── Content mode controls ──────────────────────────────────────────────
    content: {
      mode:   () => contentMgr.getContentMode(),
      toggle: () => { contentMgr.toggle(); hud.showBanner(`Mode: ${contentMgr.getContentMode()}`, '#3498db', 1500); },
      astonia:() => { contentMgr.setContentMode('astonia');  hud.showBanner('Mode: astonia', '#3498db', 1500); },
      custom: () => { contentMgr.setContentMode('custom');   hud.showBanner('Mode: custom',  '#3498db', 1500); },
    },

    // ── Clan controls ──────────────────────────────────────────────────────
    clan: {
      inspect:        () => clanMgr.inspect?.(),
      create:         (name) => clanMgr.createClan('local_player', name),
      getClan:        () => clanMgr.getClanByPlayer('local_player'),
      addScore:       (n = 1) => {
        const c = clanMgr.getClanByPlayer('local_player');
        if (c) clanMgr.incrementScore(c.id, n);
      },
      giveJewel:      () => {
        if (!inventory.items.find(i => i.id === 'clan_jewel'))
          inventory.items.push({ id: 'clan_jewel', name: 'Clan Jewel' });
        if (player) player.carryingJewel = true;
        hud.setInventory(inventory.items);
      },
      removeJewel:    () => {
        inventory.items = inventory.items.filter(i => i.id !== 'clan_jewel');
        if (player) player.carryingJewel = false;
        hud.setInventory(inventory.items);
      },
      enterHideout:   () => hideoutSys.enterHideout(player, zone),
      inspectHideout: () => hideoutSys.inspect(),
    },

    // ── Spawner controls ───────────────────────────────────────────────────
    spawner: {
      inspect:       () => clanSpawnerSys.inspect?.(),
      forceClaimable:() => clanSpawnerSys.forceClaimable?.(),
      forceCooldown: () => clanSpawnerSys.forceCooldown?.(),
      forceActive:   () => clanSpawnerSys.forceActive?.(),
      channelPct:    () => clanSpawnerSys.getChannelPct?.(),
      continuousInspect: () => spawnerSys.inspect?.(),
    },

    // ── Teleporter controls ────────────────────────────────────────────────
    teleporter: {
      open:    () => eventBus.emit('teleporter_open', {}),
      teleportTo: (id) => teleporterSys.teleportTo?.(id),
      unlock:  (id) => teleportUnlock(id),
    },

    // ── Pentagram controls ─────────────────────────────────────────────────
    pentagram: {
      inspect:       () => pentagramSys.inspect?.(),
      forceComplete: () => pentagramSys.forceComplete?.(),
      skipToWave:    (n) => pentagramSys.skipToWave?.(n),
      fail:          () => pentagramSys.fail?.(),
      goToPit:       () => zone.load('pentagram_pit'),
    },

    // ── Hideout controls ───────────────────────────────────────────────────
    hideout: {
      inspect:  () => hideoutSys.inspect(),
      enter:    () => hideoutSys.enterHideout(player, zone),
      generate: (clanId) => hideoutSys.generateHideout(clanId),
    },

    // ── Zone navigation shortcuts ──────────────────────────────────────────
    goto: {
      cameron:    () => zone.load('Cameron'),
      wilderness: () => zone.load('cameron_wilderness'),
      dungateGate:() => zone.load('cameron_dungeon_entrance'),
      sewers:     () => zone.load('sewers_entry'),
      skellie4:   () => zone.load('skellie4'),
      spawner:    () => zone.load('clan_spawner_zone'),
      aston:      () => zone.load('aston_core'),
      service:    () => zone.load('aston_service_district'),
      zombies:    () => zone.load('aston_zombies_ii'),
      pentagram:  () => zone.load('pentagram_pit'),
    },
  };
})();

// ── Game loop ─────────────────────────────────────────────────────────────────
//
// Frame phases:
//   0. Player input          — movement, interact, ability keys
//   1. gameClock.tick        — advance deterministic time
//   2. eventBus.processQueue — deliver events from previous frame
//   3. systemMgr.update      — all registered systems, some throttled
//   4. HUD + camera          — read-only; never changes game state

const clock        = new THREE.Clock();
const cameraOffset = new THREE.Vector3(20, 20, 20);

// ── Cursor-to-world tracking for projectile aiming ─────────────────────────
// Raycasts the cursor onto the y=1 plane each mousemove so projectile abilities
// can fire toward the cursor rather than the nearest enemy.
// player._aimTarget is read by _aimDir() in abilitySystem.js.
{
  const _ray    = new THREE.Raycaster();
  const _mouse  = new THREE.Vector2();
  const _aimPln = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.0);
  const _hit    = new THREE.Vector3();
  window.addEventListener('mousemove', (e) => {
    _mouse.x = (e.clientX / window.innerWidth)  *  2 - 1;
    _mouse.y = (e.clientY / window.innerHeight) * -2 + 1;
    _ray.setFromCamera(_mouse, camera);
    if (_ray.ray.intersectPlane(_aimPln, _hit)) {
      player._aimTarget = { x: _hit.x, z: _hit.z };
    }
  });
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  // Phase 0: player input
  player.update(delta);
  audioSys.tickFootstep(delta, !!(player.keys['w'] || player.keys['s'] || player.keys['a'] || player.keys['d']));

  if (player.consumeInteract()) {
    zone.entities?.interact(player.mesh.position, inventory);
    _checkSpecialInteract(player.mesh.position);
  }

  // Activate whichever ability slots were pressed this frame (keys 1–5; Q=slot0, F=slot1)
  {
    const slots = abilitySys.getSlots();
    for (let i = 0; i < slots.length; i++) {
      if (player.consumeAbility(i)) abilitySys.activate(i);
    }
  }

  // Phase 1: advance game time
  gameClock.tick(delta);

  // Phase 2: deliver events from last frame
  eventBus.processQueue();

  // Phase 3: update systems
  perfMgr.start('zone');
  zone.update(delta);
  perfMgr.end('zone');

  perfMgr.start('systems');
  systemMgr.update(delta);
  perfMgr.end('systems');

  juiceSys.update(delta);

  perfMgr.tick(delta, zone.registry.all().length, eventBus.queueSize?.() ?? 0);

  // Phase 4: HUD + camera
  hud.setPlayerHP(player.hp, player.maxHp);
  // Mana bar: show for mage (and any class that actually has a meaningful pool)
  {
    const pool = build.getManaPool();
    const isManaClass = build.getClass() !== 'warrior';
    hud.setPlayerMana(build.getCurrentMana(), pool, isManaClass);
  }
  // Shield bar: show when a shield is active
  hud.setPlayerShield(player.shield ?? 0, player.maxShield ?? 0);
  hud.setAbilitySlots(abilitySys.getSlots(), build.getAllSkillLevels?.() ?? {});
  astoniaPanel.tick(); // live HP/MP bars
  hud.updateEnemyLabels();
  hud.setDebugPos(player.mesh.position.x, player.mesh.position.y, player.mesh.position.z);

  const b = zone.cameraBounds;
  const cx = b ? Math.max(b.minX, Math.min(b.maxX, player.mesh.position.x)) : player.mesh.position.x;
  const cz = b ? Math.max(b.minZ, Math.min(b.maxZ, player.mesh.position.z)) : player.mesh.position.z;
  const camTarget = new THREE.Vector3(cx, player.mesh.position.y, cz);

  // Combine juice shake with feedback shake
  const shakeX = juiceSys.shakeOffset.x + feedbackSys.shakeOffset.x;
  const shakeZ = juiceSys.shakeOffset.z + feedbackSys.shakeOffset.z;
  camera.position.copy(camTarget).add(cameraOffset);
  camera.position.x += shakeX;
  camera.position.z += shakeZ;
  camera.lookAt(camTarget);

  renderer.render(scene, camera);
}
