import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { UnauthorizedError } from './errors.js';

export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) {
    // Constant time dummy comparison to avoid length-based timing leak
    timingSafeEqual(bufA, bufA);
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

export function isValidApiKey(providedKey: string, validKeys: string[]): boolean {
  let valid = false;
  for (const key of validKeys) {
    if (timingSafeCompare(providedKey, key)) {
      valid = true;
    }
  }
  return valid;
}

export const UNPROTECTED_PATHS = new Set(['/healthz', '/readyz']);

export function createAuthHook(validKeys: string[]) {
  return async function authHook(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const url = request.url.split('?')[0];
    if (UNPROTECTED_PATHS.has(url)) {
      return;
    }

    const rawKey = request.headers['x-api-key'];
    if (!rawKey || typeof rawKey !== 'string') {
      throw new UnauthorizedError('Missing X-API-Key header');
    }

    if (!isValidApiKey(rawKey, validKeys)) {
      throw new UnauthorizedError('Invalid API key');
    }
  };
}
