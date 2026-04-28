// contentManager.js — switches between content sources.
// Mode "astonia": loads authored zone files (pre-registered in zoneManager._generatedZones)
// Mode "custom":  uses zoneGenerator + contentGenerator pipeline
// Toggle with M key wired in main.js

const VALID_MODES = ['astonia', 'custom'];

export class ContentManager {
  constructor() {
    this._mode = 'astonia';
  }

  setContentMode(mode) {
    if (!VALID_MODES.includes(mode)) { console.warn(`[Content] Unknown mode: ${mode}`); return; }
    const prev = this._mode;
    this._mode = mode;
    console.log(`[Content] mode: ${prev} → ${mode}`);
  }

  getContentMode() { return this._mode; }

  isAstonia() { return this._mode === 'astonia'; }
  isCustom()  { return this._mode === 'custom'; }

  toggle() {
    this.setContentMode(this._mode === 'astonia' ? 'custom' : 'astonia');
  }

  inspect() {
    console.log(`[Content] mode=${this._mode}`);
  }
}
