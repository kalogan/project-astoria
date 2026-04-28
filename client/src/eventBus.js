// Queue-based event bus. Events are COLLECTED during the update phase
// and DELIVERED in a dedicated processQueue() step before the next update.
// This ensures deterministic ordering and replay-ability.

// Module-level sequence counter — survives zone reloads, unique across the session.
let _seq = 0;

export class EventBus {
  constructor(clock) {
    this._clock    = clock;        // GameClock — provides deterministic timestamps
    this._queue    = [];           // pending events, drained each frame
    this._handlers = new Map();    // type → Set<handler>
    this._debug    = false;
  }

  // Subscribe to an event type.
  // Pass '*' to receive every event regardless of type.
  // Returns an unsubscribe function.
  on(type, handler) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(handler);
    return () => this._handlers.get(type)?.delete(handler);
  }

  // Queue an event. Does NOT dispatch immediately — call processQueue() to deliver.
  emit(type, payload = {}) {
    const event = {
      id:        `e${String(++_seq).padStart(8, '0')}`,
      type,
      timestamp: this._clock.getTime(),
      payload,
    };
    this._queue.push(event);
    if (this._debug) console.log('[EventBus] queued', event.id, type, payload);
    return event.id;
  }

  // Drain the queue and deliver all pending events to subscribers.
  // Call once per frame, BEFORE systemManager.update(delta).
  processQueue() {
    if (this._queue.length === 0) return;
    const batch = this._queue.splice(0); // drain atomically
    for (const event of batch) {
      if (this._debug) console.log('[EventBus] processing', event.id, event.type, event.payload);
      for (const h of this._handlers.get(event.type) ?? []) h(event);
      for (const h of this._handlers.get('*')         ?? []) h(event);
    }
  }

  // Debug helpers
  inspectQueue() {
    console.log(
      `[EventBus] queue (${this._queue.length}):`,
      this._queue.map(e => `${e.id}:${e.type}`).join(', ') || '(empty)',
    );
  }

  setDebug(on) { this._debug = on; }
}
