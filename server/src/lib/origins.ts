import type { RequestHandler } from 'express';
import { env } from '../env.js';

export const clientOrigins = (env.CLIENT_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const allowsAnyOrigin = clientOrigins.includes('*');

/** CORS alone does not reject requests or protect WebSocket upgrades. */
export function isAllowedOrigin(origin?: string | null): boolean {
  if (!origin) return true; // Native clients authenticate without browser cookies.
  if (allowsAnyOrigin) return true;
  const normalized = origin.trim().replace(/\/+$/, '');
  return clientOrigins.includes(normalized) ||
    (env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized));
}

export const browserOrigins: RequestHandler = (request, response, next) => {
  const origin = request.headers.origin;
  if (!isAllowedOrigin(origin)) {
    response.status(403).json({ error: 'This website is not allowed to access the API.' });
    return;
  }
  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  }
  if (request.method === 'OPTIONS') { response.sendStatus(204); return; }
  next();
};
