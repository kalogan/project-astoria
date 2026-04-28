import * as THREE           from 'three';
import { buildTileMap, unloadTileMap } from './tileRenderer.js';
import { Collider }        from './collider.js';
import { Key, Door, NPC }  from './entities.js';
import { createProp }      from './kitbashSystem.js';
import { Enemy, EnemySystem } from './enemySystem.js';
import { EntityManager }   from './entityManager.js';
import { TriggerSystem }   from './triggerSystem.js';
import { setFrustumSize }  from './scene.js';
import { validateZone }    from './zoneValidator.js';
import { EntityRegistry }  from './entityRegistry.js';
import { saveZoneState, loadZoneState, clearZoneState } from './saveSystem.js';
import { createRNG }        from './rng.js';
import { generateZone }                         from './zoneGenerator.js';
import { DEFAULT_TEMPLATE, getTemplate, templateNames } from './zoneTemplates.js';
import { OcclusionSystem } from './occlusionSystem.js';

const DEFAULT_SEED = 0xDEADBEEF;

// Empirical constant: for frustumSize=22 the camera sees ±13.47 world units in Z
const VISIBLE_Z_PER_FRUSTUM = 13.47 / 22;

// Fixed tight zoom — Astonia-style player-focused camera.
// The frustum is no longer proportional to zone size; instead the camera follows
// the player and is clamped to zone edges via cameraBounds.
const PLAYER_FRUSTUM_SIZE = 13;

export class ZoneManager {
  constructor(scene, camera, renderer, combat, hud, player) {
    this.scene    = scene;
    this.camera   = camera;
    this.renderer = renderer;
    this.combat   = combat;
    this.hud      = hud;
    this.player   = player;

    this.activeId            = null;
    this.activeGrid          = null;
    this.tileGroup           = null;
    this.collider            = null;
    this.entities            = null; // EntityManager (interaction system)
    this.enemySys            = null; // EnemySystem (AI driver)
    this.triggers            = null; // TriggerSystem
    this.cameraBounds        = null;
    this.registry            = new EntityRegistry();
    this.rng                 = null; // seeded RNG for active zone
    this._propGroup          = null; // THREE.Group holding hand-authored zone props
    this._occSystem          = new OcclusionSystem(); // room-based wall occlusion
    this.onLoad              = null; // (questDefs) => void — wired by main.js
    this.onSave              = null; // () => void — wired by main.js
    // Optional: set from main.js to enforce zone access control
    this.progressionManager  = null;
    this._loading           = false;
    this._transitionCooldown = 0;
    this._generatedZones    = new Map(); // id → generated zone object cache
    this._lastGenConfig     = null;      // { config, template, constraints } of the most recently generated zone
  }

  async load(zoneId, spawnPos = null) {
    if (this._loading) { console.warn(`[Zone] load(${zoneId}) blocked — already loading`); return; }

    // Zone access check — opt-in via zoneManager.progressionManager
    if (this.progressionManager && !this.progressionManager.canEnter(zoneId)) {
      console.warn(`[Zone] "${zoneId}" is locked — unlock it via progressionManager first`);
      return;
    }

    this._loading = true;
    console.log(`[Zone] loading "${zoneId}"`, spawnPos ?? '(default spawn)');

    const zone = await this._fetch(zoneId);

    const { valid, errors } = validateZone(zone);
    if (!valid) {
      console.error(`[Zone] "${zoneId}" schema errors:`, errors);
      this._loading = false;
      throw new Error(`Zone "${zoneId}" failed validation:\n  ${errors.join('\n  ')}`);
    }

    this._unload();
    this.activeId = zone.id;
    this._transitionCooldown = 1.0;
    this.rng = createRNG(zone.config.seed ?? DEFAULT_SEED);
    this.rng.logSeed();

    const rt    = this._adaptToRuntime(zone);
    const rows  = rt.grid.length;
    const cols  = rt.grid[0].length;
    const halfZ = (rows - 1) / 2;
    const halfX = (cols - 1) / 2;

    // Camera — fixed tight zoom; bounds clamp to zone edges
    setFrustumSize(this.camera, this.renderer, PLAYER_FRUSTUM_SIZE);
    const visibleHalf = PLAYER_FRUSTUM_SIZE * VISIBLE_Z_PER_FRUSTUM;
    const maxPanZ = Math.max(0, halfZ - visibleHalf);
    const maxPanX = Math.max(0, halfX - visibleHalf);
    this.cameraBounds = { minX: -maxPanX, maxX: maxPanX, minZ: -maxPanZ, maxZ: maxPanZ };

    // Tiles + collider (pass rooms so wall tiles get tagged for occlusion)
    this.activeGrid      = rt.grid;
    this.tileGroup       = buildTileMap(this.scene, rt.grid, zone.rooms ?? []);
    this.collider        = new Collider(rt.grid);
    this.player.collider = this.collider;

    // ── Room occlusion system ─────────────────────────────────────────────
    this._occSystem.load(zone.rooms ?? [], this.tileGroup, cols, rows);

    // ── Hand-authored props (zone.props array, optional) ─────────────────
    if (zone.props?.length) {
      this._propGroup      = new THREE.Group();
      this._propGroup.name = 'zone_props';
      for (const p of zone.props) {
        const mesh = createProp(p.type, p.color ?? 0x8b7355);
        if (!mesh) { console.warn(`[Zone] Unknown prop type "${p.type}" — skipped`); continue; }
        // Sink props 0.04 world units into the floor so they look seated/grounded.
        mesh.position.set(p.x, (p.y ?? 0.2) - 0.04, p.z);
        if (p.rotY !== undefined) mesh.rotation.y = p.rotY;
        // Ensure every sub-mesh casts and receives shadows
        mesh.traverse(child => {
          if (child.isMesh) {
            child.castShadow    = true;
            child.receiveShadow = true;
          }
        });
        this._propGroup.add(mesh);
      }
      this.scene.add(this._propGroup);
      console.log(`[Zone] Props placed: ${zone.props.length}`);
    }

    // Player spawn
    const spawn = spawnPos ?? zone.playerStart ?? { x: 0, z: 0 };
    this.player.mesh.position.set(spawn.x, 0.65, spawn.z);

    // ── Create + register all entities ──────────────────────────
    this.registry.clear();
    for (const def of rt.entities) {
      if (def.type === 'key')  this.registry.register('key',  new Key(this.scene, def));
      if (def.type === 'door') this.registry.register('door', new Door(this.scene, def));
      if (def.type === 'npc')  this.registry.register('npc',  new NPC(this.scene, def));
    }
    for (const def of rt.enemies) {
      this.registry.register('enemy', new Enemy(this.scene, rt.grid, def));
    }

    // ── Systems (thin — no entity ownership) ────────────────────
    this.entities = new EntityManager();
    this.entities.onSave = () => saveZoneState(this.activeId, this._captureZoneState());

    this.enemySys = new EnemySystem(this.player);

    this.triggers = new TriggerSystem(this.player);
    for (const def of rt.triggers) this._registerTrigger(def);

    // ── HUD ─────────────────────────────────────────────────────
    const enemies = this.registry.getEntitiesByType('enemy');
    this.hud.clearEnemyLabels();
    this.hud.initEnemyLabels(enemies);

    // ── Restore persisted zone state ────────────────────────────
    const savedZone = loadZoneState(zone.id);
    if (savedZone) this._applyZoneState(savedZone);

    // ── Notify main.js (system init + quest merging) ─────────────
    this.onLoad?.(zone.systems.quests ?? []);

    this._loading = false;
    console.log(`[Zone] "${zone.id}" ready — player at`, this.player.mesh.position);
  }

  // Transition cooldown + per-frame occlusion
  update(delta) {
    if (this._transitionCooldown > 0) {
      this._transitionCooldown -= delta;
      if (this._transitionCooldown <= 0) console.log('[Zone] transition cooldown cleared');
    }
    // Update room occlusion every frame (fast AABB check + smooth fade)
    if (this.player?.mesh) {
      this._occSystem.update(delta, this.player.mesh.position);
    }
  }

  // ── Private ───────────────────────────────────────────────────

  _unload() {
    if (!this.activeId) return;

    // Snapshot before any teardown (loot must still be in combat.loot)
    saveZoneState(this.activeId, this._captureZoneState());
    this.onSave?.();

    this._occSystem.unload();
    if (this.tileGroup)  { unloadTileMap(this.scene, this.tileGroup); this.tileGroup = null; }
    if (this._propGroup) { this.scene.remove(this._propGroup); this._propGroup = null; }

    // Remove all entity meshes via registry — single point of disposal
    for (const e of this.registry.all()) {
      if (e.mesh) this.scene.remove(e.mesh);
    }
    this.registry.clear();

    this.combat.clearLoot(this.scene);
    this.entities    = null;
    this.enemySys    = null;
    this.collider    = null;
    this.triggers    = null;
    this.cameraBounds = null;
    this.activeId    = null;
  }

  _captureZoneState() {
    return {
      doors: this.registry.getEntitiesByType('door').map(d => ({
        id: d.id, locked: d.locked,
      })),
      enemies: this.registry.getEntitiesByType('enemy').map(e => ({
        id: e.id,
        x: e.mesh.position.x, z: e.mesh.position.z,
        hp: e.hp, alive: e.alive,
      })),
      triggers: this.triggers?.triggers.map(t => ({ fired: t.fired })) ?? [],
      loot: this.combat.loot.map(l => ({
        x: l.mesh.position.x, z: l.mesh.position.z, collected: l.collected,
      })),
    };
  }

  _applyZoneState(saved) {
    // Doors
    for (const s of saved.doors ?? []) {
      const door = this.registry.getEntityById(s.id);
      if (door && !s.locked) door.unlock();
    }

    // Enemies — matched by id, robust against reordering
    for (const s of saved.enemies ?? []) {
      const enemy = this.registry.getEntityById(s.id);
      if (!enemy) continue;
      enemy.mesh.position.set(s.x, enemy.mesh.position.y, s.z);
      enemy.hp    = s.hp;
      enemy.alive = s.alive;
      if (!s.alive) enemy.mesh.visible = false;
    }
    // Rebuild HUD labels to reflect restored alive states
    this.hud.clearEnemyLabels();
    this.hud.initEnemyLabels(this.registry.getEntitiesByType('enemy'));

    // Triggers — deterministic order from zone JSON
    (saved.triggers ?? []).forEach((s, i) => {
      const t = this.triggers?.triggers[i];
      if (t) t.fired = s.fired;
    });

    // Loot
    this.combat.loadLoot(saved.loot ?? []);
  }

  // Load a procedurally generated zone. Same config + template + constraints + seed → identical layout.
  async loadGeneratedZone(genConfig, template = DEFAULT_TEMPLATE, constraints = null) {
    if (typeof template === 'string') template = getTemplate(template) ?? DEFAULT_TEMPLATE;
    this._lastGenConfig = { config: genConfig, template, constraints };
    console.log(`[Zone] Generating "${genConfig.id}" — template: ${template.type}`);
    const zone = generateZone(genConfig, template, constraints);
    this._generatedZones.set(zone.id, zone);
    await this.load(zone.id);
  }

  // Debug: same seed + template + constraints → identical layout, entity state reset.
  debugRegenSameSeed() {
    if (!this._lastGenConfig) { console.warn('[Zone] No generated zone to regen'); return; }
    const { config, template, constraints } = this._lastGenConfig;
    clearZoneState(config.id);
    this.loadGeneratedZone(config, template, constraints);
  }

  // Debug: new seed, same template + constraints — Intentionally uses Date.now().
  debugRegenNewSeed() {
    if (!this._lastGenConfig) { console.warn('[Zone] No generated zone to regen'); return; }
    const { config, template, constraints } = this._lastGenConfig;
    const newConfig = { ...config, seed: Date.now() | 0 };
    clearZoneState(newConfig.id);
    this.loadGeneratedZone(newConfig, template, constraints);
  }

  // Debug: same config + seed + constraints, different template.
  debugSwitchTemplate(name) {
    if (!this._lastGenConfig) { console.warn('[Zone] No generated zone to switch template on'); return; }
    const tmpl = getTemplate(name);
    if (!tmpl) {
      console.warn(`[Zone] Unknown template "${name}". Available: ${templateNames().join(', ')}`);
      return;
    }
    const { config, constraints } = this._lastGenConfig;
    clearZoneState(config.id);
    this.loadGeneratedZone(config, tmpl, constraints);
  }

  // Debug: same config + seed + template, new constraints — force specific design requirements.
  debugApplyConstraints(newConstraints) {
    if (!this._lastGenConfig) { console.warn('[Zone] No generated zone to apply constraints to'); return; }
    const { config, template } = this._lastGenConfig;
    clearZoneState(config.id);
    this.loadGeneratedZone(config, template, newConstraints);
  }

  // Load a pre-generated zone object directly (no re-generation).
  // genMeta: optional { config, template, constraints } — stored in _lastGenConfig
  // so debug tools (regenSameSeed, etc.) work after loading a batch zone.
  async loadPregenZone(zone, genMeta = null) {
    this._generatedZones.set(zone.id, zone);
    if (genMeta) this._lastGenConfig = genMeta;
    await this.load(zone.id);
  }

  async _fetch(zoneId) {
    if (this._generatedZones.has(zoneId)) return this._generatedZones.get(zoneId);
    const res = await fetch(`/zones/${zoneId}.json`);
    if (!res.ok) throw new Error(`Zone not found: ${zoneId}`);
    return res.json();
  }

  _adaptToRuntime(zone) {
    const entityMap = {};
    for (const e of zone.entities) entityMap[e.id] = e;
    const sys = zone.systems;

    const entities = [
      ...(sys.keys  ?? []).map(k => ({
        type: 'key', id: k.entityId, keyId: k.keyId,
        x: entityMap[k.entityId].position.x,
        z: entityMap[k.entityId].position.y,
        color: k.color,
      })),
      ...(sys.doors ?? []).map(d => ({
        type: 'door', id: d.entityId, keyId: d.keyId,
        x: entityMap[d.entityId].position.x,
        z: entityMap[d.entityId].position.y,
        color: d.color,
      })),
    ];

    const enemies = (sys.enemies ?? []).map(en => ({
      id:           en.entityId,
      x:            entityMap[en.entityId].position.x,
      z:            entityMap[en.entityId].position.y,
      // Profile fields from contentGenerator (optional — enemies use defaults if absent)
      type:         en.type,
      hp:           en.hp,
      speed:        en.speed,
      attackDamage: en.attackDamage,
      color:        en.color,
      xpValue:      en.xpValue,
    }));

    const triggers = (sys.portals ?? []).map(p => ({
      type:   'area',
      x:      entityMap[p.entityId].position.x,
      z:      entityMap[p.entityId].position.y,
      radius: p.radius,
      once:   true,
      action: 'loadZone',
      zoneId: p.targetZone,
      spawnX: p.spawnX ?? 0,
      spawnZ: p.spawnZ ?? 0,
    }));

    // NPCs — read directly from zone.entities (no systems entry needed)
    const npcs = zone.entities
      .filter(e => e.type === 'npc')
      .map(e => ({
        type:   'npc',
        id:     e.id,
        x:      e.position.x,
        z:      e.position.y,  // zone schema: y = world z
        name:   e.name   ?? e.id,
        color:  e.color  ?? 0xd4a96a,
        facing: e.facing ?? 0,
      }));

    return { grid: zone.tiles, entities: [...entities, ...npcs], enemies, triggers };
  }

  _registerTrigger(def) {
    if (def.type !== 'area') return;
    const r2 = def.radius * def.radius;
    const condition = (pos) => {
      const dx = pos.x - def.x;
      const dz = pos.z - def.z;
      return (dx * dx + dz * dz) <= r2;
    };
    const actions = {
      unlockDoor: () => this.registry.getEntityById(def.doorId)?.unlock(),
      loadZone: () => {
        if (this._transitionCooldown > 0) {
          console.log(`[Zone] loadZone("${def.zoneId}") suppressed — cooldown ${this._transitionCooldown.toFixed(2)}s`);
          return;
        }
        console.log(`[Zone] trigger fired → loadZone("${def.zoneId}")`);
        this.load(def.zoneId, { x: def.spawnX ?? 0, z: def.spawnZ ?? 0 });
      },
    };
    const action = actions[def.action];
    if (action) this.triggers.register({ condition, action, once: def.once ?? true });
  }
}
