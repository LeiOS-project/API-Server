import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';
import { DrizzleDB } from './utils';

export class DB {

    protected static db: DrizzleDB;

    static async init() {
        this.db = drizzle(Bun.env.DB_PATH || './data/db.sqlite');

    }

    static get() {
        if (!this.db) {
            throw new Error('Database not initialized. Call DB.init() first.');
        }
        return DB.db;
    }



}

