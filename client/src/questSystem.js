export class QuestSystem {
  constructor(defs = [], eventBus = null) {
    this.quests   = defs.map(d => ({ ...d, progress: 0, complete: false }));
    this.eventBus = eventBus;
  }

  // Add zone-defined quests; skips ids already tracked
  mergeQuests(defs) {
    for (const def of defs) {
      if (!this.quests.find(q => q.id === def.id)) {
        this.quests.push({ ...def, progress: 0, complete: false });
      }
    }
  }

  // Restore full quest list from a save (replaces current quests)
  restoreFromSave(savedQuests) {
    this.quests = savedQuests.map(sq => ({
      id: sq.id, type: sq.type, title: sq.title, goal: sq.goal,
      progress: sq.progress, complete: sq.complete,
    }));
  }

  notify(type) {
    for (const q of this.quests) {
      if (q.complete || q.type !== type) continue;
      q.progress++;
      const justCompleted = q.progress >= q.goal;
      if (justCompleted) q.complete = true;

      this.eventBus?.emit('quest_progress', {
        questId:  q.id,
        progress: q.progress,
        goal:     q.goal,
        complete: q.complete,
      });
      if (justCompleted) {
        this.eventBus?.emit('quest_complete', { questId: q.id });
      }
    }
  }

  all()    { return this.quests; }
  active() { return this.quests.filter(q => !q.complete); }
}
