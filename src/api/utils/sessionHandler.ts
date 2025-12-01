import { eq } from "drizzle-orm";
import { DB } from "../../db";
import { randomBytes as crypto_randomBytes } from 'crypto';

export class SessionHandler {

    static async createSession(userID: number) {
        const result = await DB.instance().insert(DB.Schema.sessions).values({
            token: crypto_randomBytes(32).toString('hex'),
            user_id: userID,
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).getTime() // 7 days from now
        }).returning()
        
        return result[0];
    }

    static async getSession(sessionToken: string) {
        const session = DB.instance().select().from(DB.Schema.sessions).where(eq(DB.Schema.sessions.token, sessionToken)).get();
        if (!session) {
            return null;
        }

        return session;
    }

    static async isValidSession(session: DB.Models.Session) {
        if (!session || session.expires_at < Date.now()) {
            return false;
        }

        return true;
    }
        
    static async inValidateAllSessionsForUser(userID: number) {
        await DB.instance().delete(DB.Schema.sessions).where(eq(DB.Schema.sessions.user_id, userID));
    }

    static async invalidateSession(sessionToken: string) {
        await DB.instance().delete(DB.Schema.sessions).where(eq(DB.Schema.sessions.token, sessionToken));
    }

}