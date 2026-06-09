import { BinaryHeap } from '../binaryHeap';

describe('BinaryHeap', () => {
  it('pops entries in ascending score order', () => {
    const heap = new BinaryHeap<number>((n) => n);
    [5, 2, 9, 1, 4, 7, 3, 8, 6, 0].forEach((n) => heap.push(n));
    const sorted: number[] = [];
    while (heap.size > 0) sorted.push(heap.pop() as number);
    expect(sorted).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('returns undefined when popping an empty heap', () => {
    const heap = new BinaryHeap<number>((n) => n);
    expect(heap.pop()).toBeUndefined();
    expect(heap.peek()).toBeUndefined();
    expect(heap.size).toBe(0);
  });

  it('supports arbitrary payloads with a score function', () => {
    interface Node {
      label: string;
      f: number;
    }
    const heap = new BinaryHeap<Node>((n) => n.f);
    heap.push({ label: 'c', f: 3 });
    heap.push({ label: 'a', f: 1 });
    heap.push({ label: 'b', f: 2 });
    expect((heap.pop() as Node).label).toBe('a');
    expect((heap.pop() as Node).label).toBe('b');
    expect((heap.pop() as Node).label).toBe('c');
  });

  it('peek does not mutate the heap', () => {
    const heap = new BinaryHeap<number>((n) => n);
    heap.push(5);
    heap.push(2);
    expect(heap.peek()).toBe(2);
    expect(heap.peek()).toBe(2);
    expect(heap.size).toBe(2);
  });
});
