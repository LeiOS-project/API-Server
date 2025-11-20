
import { drizzle } from 'drizzle-orm/bun-sqlite';

export type DrizzleDB = ReturnType<typeof drizzle>;