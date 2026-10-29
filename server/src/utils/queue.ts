const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export { sleep };

/**
 * File d'attente par clé (ici : un compte Telegram) : les tâches d'une même clé s'exécutent une par une, avec un
 * intervalle minimal entre deux démarrages. Évite les rafales qui déclencheraient la limitation de débit de Telegram.
 */
export class KeyedQueue {
  private tails = new Map<string, Promise<void>>();
  private last = new Map<string, number>();
  constructor(private minIntervalMs: () => number) {}

  push(key: string, job: () => Promise<void>): Promise<void> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(async () => {
      const wait = this.minIntervalMs() - (Date.now() - (this.last.get(key) ?? 0));
      if (wait > 0) await sleep(wait);
      this.last.set(key, Date.now());
      await job();
    }).catch(() => undefined);
    this.tails.set(key, next);
    void next.then(() => { if (this.tails.get(key) === next) this.tails.delete(key); });
    return next;
  }
  /** Attend que toutes les tâches en cours soient terminées (tests, arrêt propre). */
  async idle() { while (this.tails.size) await Promise.all([...this.tails.values()]); }
}
