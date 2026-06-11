import { diffNewlyCrossed, orderPair, pairKey } from './graph.constants';

describe('graph constants helpers', () => {
  describe('orderPair()', () => {
    it('orders lexicographically regardless of input order', () => {
      expect(orderPair('b', 'a')).toEqual(['a', 'b']);
      expect(orderPair('a', 'b')).toEqual(['a', 'b']);
    });

    it('keeps uuid pairs stable both ways (edge dedupe invariant)', () => {
      const u1 = '11111111-1111-1111-1111-111111111111';
      const u2 = '22222222-2222-2222-2222-222222222222';
      expect(orderPair(u1, u2)).toEqual(orderPair(u2, u1));
    });
  });

  describe('pairKey()', () => {
    it('produces the same key for both argument orders', () => {
      expect(pairKey('x', 'y')).toBe(pairKey('y', 'x'));
      expect(pairKey('x', 'y')).toBe('x|y');
    });
  });

  describe('diffNewlyCrossed()', () => {
    it('returns only pairs that newly crossed the threshold', () => {
      const prev = new Set(['a|b']);
      const now = new Set(['a|b', 'a|c', 'b|c']);
      expect(diffNewlyCrossed(prev, now).sort()).toEqual(['a|c', 'b|c']);
    });

    it('returns empty when nothing changed', () => {
      const set = new Set(['a|b']);
      expect(diffNewlyCrossed(set, new Set(set))).toEqual([]);
    });

    it('ignores pairs that dropped out (edges never un-cross)', () => {
      const prev = new Set(['a|b', 'a|c']);
      const now = new Set(['a|b']);
      expect(diffNewlyCrossed(prev, now)).toEqual([]);
    });
  });
});
