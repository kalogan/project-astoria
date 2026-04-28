export class EntityRegistry {
  constructor() {
    this._byId   = new Map(); // id → { type, entity }
    this._byType = new Map(); // type → entity[]
  }

  // entity must have an .id property
  register(type, entity) {
    this._byId.set(entity.id, { type, entity });
    const bucket = this._byType.get(type) ?? [];
    bucket.push(entity);
    this._byType.set(type, bucket);
  }

  clear() {
    this._byId.clear();
    this._byType.clear();
  }

  getEntityById(id)       { return this._byId.get(id)?.entity ?? null; }
  getEntitiesByType(type) { return this._byType.get(type) ?? []; }
  all()                   { return [...this._byId.values()].map(v => v.entity); }
}
