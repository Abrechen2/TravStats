/**
 * Minimal binary min-heap used as the priority queue for A*.
 *
 * Generic over `T` so tests can push plain numbers, but the real
 * consumer pushes `{ cell: number; f: number }` objects. Score is
 * extracted through the constructor-supplied `score` function to
 * keep the heap allocations contiguous and avoid boxing numbers.
 *
 * Characteristics:
 *  - Array-backed, zero external deps.
 *  - `push` / `pop` are O(log n); `peek` / `size` are O(1).
 *  - Ties break in insertion order (stable enough for A* — the f-score
 *    function already makes collisions rare).
 */
export class BinaryHeap<T> {
  private readonly data: T[] = [];
  private readonly score: (value: T) => number;

  constructor(score: (value: T) => number) {
    this.score = score;
  }

  get size(): number {
    return this.data.length;
  }

  peek(): T | undefined {
    return this.data[0];
  }

  push(value: T): void {
    this.data.push(value);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): T | undefined {
    const n = this.data.length;
    if (n === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop() as T;
    if (n > 1) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(idx: number): void {
    const { data, score } = this;
    const value = data[idx];
    const valueScore = score(value);
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      const parentValue = data[parent];
      if (score(parentValue) <= valueScore) break;
      data[idx] = parentValue;
      idx = parent;
    }
    data[idx] = value;
  }

  private sinkDown(idx: number): void {
    const { data, score } = this;
    const n = data.length;
    const value = data[idx];
    const valueScore = score(value);
    for (;;) {
      const left = idx * 2 + 1;
      const right = left + 1;
      let swap = -1;
      let bestScore = valueScore;
      if (left < n) {
        const leftScore = score(data[left]);
        if (leftScore < bestScore) {
          swap = left;
          bestScore = leftScore;
        }
      }
      if (right < n) {
        const rightScore = score(data[right]);
        if (rightScore < bestScore) {
          swap = right;
          bestScore = rightScore;
        }
      }
      if (swap === -1) break;
      data[idx] = data[swap];
      idx = swap;
    }
    data[idx] = value;
  }
}
