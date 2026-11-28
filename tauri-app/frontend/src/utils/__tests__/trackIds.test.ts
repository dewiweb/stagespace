/// <reference types="vitest/globals" />
import { describe, it, expect } from 'vitest';
import { parseTrackIds, formatTrackIds } from '../trackIds';

describe('parseTrackIds', () => {
  it('parses plain comma lists', () => {
    expect(parseTrackIds('1,2,3')).toEqual([1, 2, 3]);
    expect(parseTrackIds('1, 2, 3')).toEqual([1, 2, 3]);
  });
  it('parses inclusive ranges', () => {
    expect(parseTrackIds('1-5')).toEqual([1, 2, 3, 4, 5]);
  });
  it('parses mixed lists and ranges', () => {
    expect(parseTrackIds('1-4, 7, 9-12')).toEqual([1, 2, 3, 4, 7, 9, 10, 11, 12]);
  });
  it('dedups and sorts', () => {
    expect(parseTrackIds('3, 1, 2, 1-3')).toEqual([1, 2, 3]);
  });
  it('accepts reversed ranges (obvious intent)', () => {
    expect(parseTrackIds('5-3')).toEqual([3, 4, 5]);
  });
  it('ignores invalid input silently', () => {
    expect(parseTrackIds('1, abc, 2')).toEqual([1, 2]);
    expect(parseTrackIds('')).toEqual([]);
    expect(parseTrackIds('-')).toEqual([]);
  });
  it('caps absurd ranges (typo protection)', () => {
    expect(parseTrackIds('1-9999')).toEqual([]);
  });
});

describe('formatTrackIds', () => {
  it('compresses 3+ consecutive runs', () => {
    expect(formatTrackIds([1, 2, 3, 4, 7, 9, 10, 11, 12])).toBe('1-4, 7, 9-12');
  });
  it('keeps pairs unrolled', () => {
    expect(formatTrackIds([1, 2, 5])).toBe('1, 2, 5');
  });
  it('handles singles and empty', () => {
    expect(formatTrackIds([7])).toBe('7');
    expect(formatTrackIds([])).toBe('');
  });
  it('round-trips with parse', () => {
    const ids = [1, 2, 3, 4, 7, 9, 10, 11, 12];
    expect(parseTrackIds(formatTrackIds(ids))).toEqual(ids);
  });
  it('extracts parked tracks from their range', () => {
    expect(formatTrackIds([1, 2, 3, 4], [3])).toBe('1, 2, 3⏸, 4');
  });
});
