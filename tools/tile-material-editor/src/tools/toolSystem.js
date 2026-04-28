// toolSystem.js — tool dispatch for the isometric map editor.
//
// Each tool is a plain object with three optional lifecycle methods:
//
//   onDown(tile, e, ctx)  — called once on mousedown
//   onMove(tile, e, ctx)  — called on mousemove while a button is held
//   onUp(ctx)             — called on mouseup / mouseleave
//
// Parameters:
//   tile  — { row, col } from pickTile(), or null when off-map
//   e     — the original MouseEvent (for modifier keys, button, etc.)
//   ctx   — ToolContext (see typedef below)
//
// Each method returns a partial ToolState (fields to merge into active state)
// or nothing.  The caller (MapEditorTab) merges the returned state.
//
// ── ToolContext typedef ───────────────────────────────────────────────────────
//
// @typedef {Object} ToolContext
// @property {Function} commitHistory
// @property {Function} applyTileTool     (row, col)
// @property {Function} adjustHeight      (row, col, delta)
// @property {Function} placeEntity       (row, col)
// @property {Function} placeProp         (x, y)
// @property {Function} deleteProp        (id)
// @property {Function} paintSurface      (row, col, erase)
// @property {Function} placeLight        (row, col)
// @property {Function} scatterProps      (row, col)
// @property {Function} setSelectedEntityId
// @property {Function} setSelectedPropId
// @property {Function} setSelectedLightId
// @property {Function} setSelectedTileType
// @property {Function} setGhostPropTile
// @property {Function} setGhostPrefabTile
// @property {Function} setCamera
// @property {Function} startPan          ({ clientX, clientY })
// @property {Object}   refs              — { zone, camera, brushTool, heightDelta,
//                                            activePropType, activeLightType,
//                                            propTool, activePrefab, prefabRotation,
//                                            prefabStampMode, isPainting,
//                                            isPaintingSurface, isScattering }
//
// ── ToolState typedef ─────────────────────────────────────────────────────────
//
// @typedef {Object} ToolState
// @property {boolean} [painting]
// @property {boolean} [paintingSurface]
// @property {boolean} [scattering]

import { PREFABS, rotatePrefab, canPlacePrefab, applyPrefab } from '../prefabs/prefabDefs';
import { canPlaceProp } from '../propDefs';

// ── Tile painting tool ─────────────────────────────────────────────────────────

export const TileTool = {
  onDown(tile, e, ctx) {
    if (!tile) return ctx.startPan(e);
    // Alt+click: eyedropper — pick tile type under cursor
    if (e.altKey) {
      const z = ctx.refs.zone.current;
      if (z) {
        const picked = z.tiles[tile.row][tile.col];
        if (picked !== 0) ctx.setSelectedTileType(picked);
      }
      return;
    }
    ctx.commitHistory();
    ctx.applyTileTool(tile.row, tile.col);
    // fill is single-shot — don't enable drag-paint
    return ctx.refs.brushTool.current !== 'fill' ? { painting: true } : undefined;
  },
  onMove(tile, e, ctx, state) {
    if (state.painting && tile) ctx.applyTileTool(tile.row, tile.col);
  },
  onUp(_ctx, _state) { return { painting: false }; },
};

// ── Height tool ────────────────────────────────────────────────────────────────

export const HeightTool = {
  onDown(tile, e, ctx) {
    if (!tile) return ctx.startPan(e);
    const delta = e.shiftKey ? -1 : 1;
    ctx.refs.heightDelta.current = delta;
    ctx.commitHistory();
    ctx.adjustHeight(tile.row, tile.col, delta);
    return { painting: true };
  },
  onMove(tile, _e, ctx, state) {
    if (state.painting && tile) ctx.adjustHeight(tile.row, tile.col, ctx.refs.heightDelta.current);
  },
  onUp(_ctx, _state) { return { painting: false }; },
};

// ── Entity tool ────────────────────────────────────────────────────────────────

export const EntityTool = {
  onDown(tile, _e, ctx, _state, { entityHitTest }) {
    const hit = entityHitTest();
    if (hit) { ctx.setSelectedEntityId(hit.id); return; }
    if (!tile) return ctx.startPan(_e);
    ctx.commitHistory();
    ctx.placeEntity(tile.row, tile.col);
  },
};

// ── Prop tool ──────────────────────────────────────────────────────────────────

export const PropTool = {
  onDown(tile, e, ctx) {
    if (!tile) return ctx.startPan(e);
    const z = ctx.refs.zone.current;
    if (ctx.refs.propTool.current === 'scatter') {
      ctx.scatterProps(tile.row, tile.col);
      return { scattering: true };
    }
    // Paint mode
    const propsArr = z?.props ?? [];
    const nearby   = propsArr.find(p =>
      Math.abs(p.x - tile.col) < 1.5 && Math.abs(p.y - tile.row) < 1.5
    );
    if (e.shiftKey && nearby) {
      ctx.deleteProp(nearby.id);
    } else if (!e.shiftKey && nearby) {
      ctx.setSelectedPropId(nearby.id);
    } else {
      ctx.commitHistory();
      ctx.placeProp(tile.col, tile.row);
    }
  },
  onMove(tile, _e, ctx, state) {
    const z = ctx.refs.zone.current;
    if (state.scattering && tile) ctx.scatterProps(tile.row, tile.col);
    if (tile) {
      const valid = z
        ? canPlaceProp(tile.col, tile.row, ctx.refs.activePropType.current, z.props ?? [], z.tiles)
        : false;
      ctx.setGhostPropTile({ x: tile.col, y: tile.row, valid });
    } else {
      ctx.setGhostPropTile(null);
    }
  },
  onUp(_ctx, _state) { return { scattering: false }; },
};

// ── Surface tool ───────────────────────────────────────────────────────────────

export const SurfaceTool = {
  onDown(tile, e, ctx) {
    if (!tile) return ctx.startPan(e);
    ctx.commitHistory();
    ctx.paintSurface(tile.row, tile.col, e.shiftKey);
    return { paintingSurface: true };
  },
  onMove(tile, _e, ctx, state) {
    if (state.paintingSurface && tile) ctx.paintSurface(tile.row, tile.col, false);
  },
  onUp(_ctx, _state) { return { paintingSurface: false }; },
};

// ── Prefab tool ────────────────────────────────────────────────────────────────

export const PrefabTool = {
  onDown(tile, e, ctx) {
    if (!tile) return ctx.startPan(e);
    const z        = ctx.refs.zone.current;
    if (!z) return;
    const raw      = PREFABS[ctx.refs.activePrefab.current];
    if (!raw) return;
    const pfb      = rotatePrefab(raw, ctx.refs.prefabRotation.current);
    const ox       = tile.col - pfb.origin.x;
    const oy       = tile.row - pfb.origin.y;
    if (canPlacePrefab(ox, oy, pfb, z)) {
      ctx.commitHistory();
      ctx.setZone(prev => prev ? applyPrefab(prev, ox, oy, pfb, ctx.refs.prefabStampMode.current) : prev);
      ctx.setIsDirty(true);
    }
  },
  onMove(tile, _e, ctx) {
    if (!tile) { ctx.setGhostPrefabTile(null); return; }
    const z   = ctx.refs.zone.current;
    const raw = PREFABS[ctx.refs.activePrefab.current];
    const pfb = raw ? rotatePrefab(raw, ctx.refs.prefabRotation.current) : null;
    if (pfb && z) {
      const ox = tile.col - pfb.origin.x, oy = tile.row - pfb.origin.y;
      ctx.setGhostPrefabTile({ x: ox, y: oy, valid: canPlacePrefab(ox, oy, pfb, z) });
    } else {
      ctx.setGhostPrefabTile(null);
    }
  },
};

// ── Lighting tool ──────────────────────────────────────────────────────────────

export const LightingTool = {
  onDown(tile, e, ctx, _state, { lightHitTest }) {
    const hitLight = lightHitTest();
    if (hitLight) { ctx.setSelectedLightId(hitLight.id); return; }
    if (!tile) return ctx.startPan(e);
    ctx.placeLight(tile.row, tile.col);
  },
};

// ── Tool registry ──────────────────────────────────────────────────────────────

/** Map from editorMode string to tool object. */
export const TOOL_REGISTRY = {
  tile:     TileTool,
  height:   HeightTool,
  entity:   EntityTool,
  props:    PropTool,
  surface:  SurfaceTool,
  prefabs:  PrefabTool,
  lighting: LightingTool,
};

/**
 * Look up the active tool for an editor mode.
 * Falls back to TileTool for unknown modes.
 *
 * @param {string} mode
 * @returns {Object}
 */
export function getTool(mode) {
  return TOOL_REGISTRY[mode] ?? TileTool;
}
