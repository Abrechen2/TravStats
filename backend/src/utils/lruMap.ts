/**
 * A Map that holds at most `max` entries and drops the least recently used one
 * first. A read refreshes an entry; a write of an existing key does too.
 * `get` returns `undefined` for an absent key, so a cached `null` stays
 * distinguishable from a miss.
 */
export class LruMap<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max < 1) throw new Error("LruMap needs a capacity of at least 1");
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): this {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
    return this;
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
