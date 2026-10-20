import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(fileURLToPath(new URL('../../.env', import.meta.url))) });

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
  SYNC_PORT: z.coerce.number().int().positive().default(1234),
  // Long enough that a leaked token cannot be brute-forced. There is deliberately
  // no default: a predictable signing key would let anyone mint a session.
  JWT_SECRET: z.string().min(32),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
  console.error(`codeTogether cannot start. Check your .env file:\n${problems.join('\n')}`);
  console.error('\nCopy .env.example to .env, then generate a signing key with:');
  console.error("  node -e \"console.log(require('node:crypto').randomBytes(48).toString('base64url'))\"");
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
