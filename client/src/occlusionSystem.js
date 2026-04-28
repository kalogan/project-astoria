// occlusionSystem.js — room-based wall fading for player-inside-building occlusion.
//
// How it works:
//   1. Each authored zone can include a `rooms` array with tile-coordinate bounds
//      for every enclosed building.
//   2. OcclusionSystem.load() converts those bounds to world-space interior boxes
//      and collects wall meshes (tagged by tileRenderer) into per-room arrays.
//   3. Each frame, update() checks if the player is inside any room's interior.
//      If yes, that room's walls fade to FADE_MIN opacity.  All other rooms stay
//      fully opaque.  Transitions are smooth (FADE_SPEED units/second).
//
// Complexity: O(rooms × 1) per frame (player vs AABB).  No raycasting.

const FADE_SPEED = 5.0;   // opacity change per second → 0.15→1.0 in ~0.17 s
const FADE_MIN   = 0.10;  // wall opacity when player is inside the room

export class OcclusionSystem {
  constructor() {
    /** @type {Array<{id:string, meshes:THREE.Mesh[], minX:number, maxX:number, minZ:number, maxZ:number, opacity:number}>} */
    this._rooms  = [];
    this._active = null;   // roomId player is currently inside, or null
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Call once after buildTileMap for the new zone.
   *
   * @param {Array<{id, minRow, maxRow, minCol, maxCol}>} roomDefs  – from zone.rooms
   * @param {THREE.Group} tileGroup  – returned by buildTileMap; children carry userData.roomId / tileType
   * @param {number} gridCols        – zone tile width  (W)
   * @param {number} gridRows        – zone tile height (H)
   */
  load(roomDefs, tileGroup, gridCols, gridRows) {
    this.unload();
    if (!roomDefs?.length || !tileGroup) return;

    const offsetX = (gridCols - 1) / 2;
    const offsetZ = (gridRows - 1) / 2;

    // Build room runtime objects.
    // Player detection uses the *interior* tile bounds (wall bounds shrunk 1 tile
    // on every side) converted to world space.
    for (const def of roomDefs) {
      this._rooms.push({
        id:      def.id,
        meshes:  [],
        opacity: 1.0,
        // World-space interior bounds (player must be inside these to trigger fade)
        minX: (def.minCol + 1) - offsetX,
        maxX: (def.maxCol - 1) - offsetX,
        minZ: (def.minRow + 1) - offsetZ,
        maxZ: (def.maxRow - 1) - offsetZ,
      });
    }

    // Index rooms by id for fast mesh tagging
    const roomMap = new Map(this._rooms.map(r => [r.id, r]));

    for (const mesh of tileGroup.children) {
      const rid = mesh.userData?.roomId;
      if (!rid) continue;
      const room = roomMap.get(rid);
      if (!room || mesh.userData.tileType !== 2) continue;   // walls only

      // Clone the shared material so this mesh can vary opacity independently.
      // (Shared mats are cached; cloning is the right isolation layer.)
      mesh.material          = mesh.material.clone();
      mesh.material.transparent = true;
      mesh.material.depthWrite  = false;   // avoids z-fighting at partial opacity
      room.meshes.push(mesh);
    }

    console.log(
      `[Occlusion] Loaded ${this._rooms.length} rooms:`,
      this._rooms.map(r => `${r.id}(${r.meshes.length} wall tiles)`).join(', ')
    );
  }

  /**
   * Call every frame from ZoneManager.update().
   * @param {number} delta – seconds since last frame
   * @param {{x:number, z:number}} playerPos
   */
  update(delta, playerPos) {
    if (!this._rooms.length) return;

    // ── Determine which room (if any) the player occupies ────────────────
    let insideId = null;
    for (const room of this._rooms) {
      if (
        playerPos.x > room.minX && playerPos.x < room.maxX &&
        playerPos.z > room.minZ && playerPos.z < room.maxZ
      ) {
        insideId = room.id;
        break;
      }
    }
    this._active = insideId;

    // ── Smooth-fade each room toward its target opacity ───────────────────
    const step = FADE_SPEED * delta;
    for (const room of this._rooms) {
      const target  = (room.id === insideId) ? FADE_MIN : 1.0;
      const current = room.opacity;
      if (Math.abs(target - current) < 0.002) continue;

      room.opacity = target > current
        ? Math.min(target, current + step)
        : Math.max(target, current - step);

      for (const mesh of room.meshes) {
        mesh.material.opacity = room.opacity;
      }
    }
  }

  /**
   * Reset all materials and clear state.  Call before unloading a zone so
   * cloned materials don't leak into the next zone's shared-material cache.
   */
  unload() {
    for (const room of this._rooms) {
      for (const mesh of room.meshes) {
        if (mesh.material) {
          mesh.material.opacity     = 1.0;
          mesh.material.transparent = false;
          mesh.material.depthWrite  = true;
        }
      }
    }
    this._rooms  = [];
    this._active = null;
  }

  /** Returns the id of the room the player is currently inside, or null. */
  getActiveRoom() { return this._active; }
}
