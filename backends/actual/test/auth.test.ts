import { describe, expect, it } from 'vitest';
import { isValidApiKey, timingSafeCompare } from '../src/http/auth.js';

describe('Authentication', () => {
  describe('timingSafeCompare', () => {
    it('returns true for matching strings', () => {
      expect(timingSafeCompare('secret-token-1234', 'secret-token-1234')).toBe(true);
      expect(timingSafeCompare('', '')).toBe(true);
    });

    it('returns false for mismatched strings of same length', () => {
      expect(timingSafeCompare('secret-token-1234', 'secret-token-5678')).toBe(false);
    });

    it('returns false for mismatched strings of different lengths', () => {
      expect(timingSafeCompare('short', 'much-longer-string')).toBe(false);
      expect(timingSafeCompare('much-longer-string', 'short')).toBe(false);
      expect(timingSafeCompare('', 'non-empty')).toBe(false);
    });
  });

  describe('isValidApiKey', () => {
    const validKeys = ['key-alpha-123456789012345678901234567890', 'key-beta-123456789012345678901234567890'];

    it('validates configured keys', () => {
      expect(isValidApiKey(validKeys[0], validKeys)).toBe(true);
      expect(isValidApiKey(validKeys[1], validKeys)).toBe(true);
    });

    it('rejects unknown keys', () => {
      expect(isValidApiKey('unknown-key', validKeys)).toBe(false);
      expect(isValidApiKey('', validKeys)).toBe(false);
    });
  });
});
