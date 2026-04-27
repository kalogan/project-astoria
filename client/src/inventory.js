export class Inventory {
  constructor() {
    this.items = [];
  }

  add(item) {
    this.items.push(item);
  }

  has(keyId) {
    return this.items.some(i => i.keyId === keyId);
  }
}
