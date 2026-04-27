export class QuestSystem {
  constructor(defs) {
    this.quests = defs.map(d => ({ ...d, progress: 0, complete: false }));
  }

  // Call when a tracked event occurs
  notify(type) {
    for (const q of this.quests) {
      if (q.complete || q.type !== type) continue;
      q.progress++;
      if (q.progress >= q.goal) q.complete = true;
    }
  }

  all()    { return this.quests; }
  active() { return this.quests.filter(q => !q.complete); }
}
