const REQUIRED_TOP   = ['id', 'config', 'playerStart', 'tiles', 'entities', 'systems'];
const REQUIRED_CONFIG = ['width', 'height'];
const VALID_SYSTEMS   = ['keys', 'doors', 'enemies', 'portals', 'quests'];

export function validateZone(zone) {
  const errors = [];

  for (const f of REQUIRED_TOP) {
    if (zone[f] === undefined) errors.push(`missing required field: "${f}"`);
  }
  if (errors.length) return { valid: false, errors };

  // config
  for (const f of REQUIRED_CONFIG) {
    if (typeof zone.config[f] !== 'number') errors.push(`config.${f} must be a number`);
  }
  if (zone.config.seed !== undefined && typeof zone.config.seed !== 'number') {
    errors.push('config.seed must be a number');
  }

  // tiles dimensions
  const { width, height } = zone.config;
  if (!Array.isArray(zone.tiles)) {
    errors.push('tiles must be a 2D array');
  } else {
    if (zone.tiles.length !== height)
      errors.push(`tiles has ${zone.tiles.length} rows but config.height=${height}`);
    for (let r = 0; r < zone.tiles.length; r++) {
      if (!Array.isArray(zone.tiles[r])) { errors.push(`tiles[${r}] is not an array`); continue; }
      if (zone.tiles[r].length !== width)
        errors.push(`tiles[${r}] has ${zone.tiles[r].length} cols but config.width=${width}`);
    }
  }

  // playerStart
  if (!zone.playerStart ||
      typeof zone.playerStart.x !== 'number' ||
      typeof zone.playerStart.z !== 'number') {
    errors.push('playerStart must have numeric x and z');
  }

  // entities — build id set for cross-reference
  const ids = new Set();
  if (!Array.isArray(zone.entities)) {
    errors.push('entities must be an array');
  } else {
    for (const e of zone.entities) {
      if (!e.id) { errors.push('entity missing "id"'); continue; }
      if (ids.has(e.id)) errors.push(`duplicate entity id: "${e.id}"`);
      ids.add(e.id);
      if (!e.type) errors.push(`entity "${e.id}" missing "type"`);
      if (!e.position ||
          typeof e.position.x !== 'number' ||
          typeof e.position.y !== 'number') {
        errors.push(`entity "${e.id}" must have numeric position.x and position.y`);
      }
    }
  }

  // systems
  if (!zone.systems || typeof zone.systems !== 'object' || Array.isArray(zone.systems)) {
    errors.push('systems must be an object');
  } else {
    for (const key of Object.keys(zone.systems)) {
      if (!VALID_SYSTEMS.includes(key)) { errors.push(`unknown system key: "${key}"`); continue; }
      const entries = zone.systems[key];
      if (!Array.isArray(entries)) { errors.push(`systems.${key} must be an array`); continue; }
      if (key === 'quests') {
        for (const q of entries) {
          if (!q.id)    errors.push('quest missing "id"');
          if (!q.type)  errors.push(`quest "${q.id ?? '?'}" missing "type"`);
          if (!q.title) errors.push(`quest "${q.id ?? '?'}" missing "title"`);
          if (typeof q.goal !== 'number') errors.push(`quest "${q.id ?? '?'}" goal must be a number`);
        }
      } else {
        for (const entry of entries) {
          if (!entry.entityId) { errors.push(`systems.${key} entry missing "entityId"`); continue; }
          if (!ids.has(entry.entityId))
            errors.push(`systems.${key} references unknown entityId: "${entry.entityId}"`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
