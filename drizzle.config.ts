import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './services/api/src/adapters/db-postgres/schema.ts',
  out: './services/api/drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
