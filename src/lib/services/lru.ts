/** Minimal LRU map (insertion order of a Map doubles as recency order). */
export class LruCache<K, V> {
  private readonly max: number;
  private readonly map = new Map<K, V>();

  constructor(max: number) {
    this.max = Math.max(1, Math.floor(max));
  }

  get size(): number {
    return this.map.size;
  }

  /** Returns undefined when absent; a stored null is returned as null. */
  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  clear(): void {
    this.map.clear();
  }
}
