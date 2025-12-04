import { eq } from "drizzle-orm";
import { DB } from "../../db";
import { randomBytes as crypto_randomBytes } from 'crypto';

class AuthUtils {

    static async getUserRole(userID: number) {
        const user = DB.instance().select().from(DB.Schema.users).where(eq(DB.Schema.users.id, userID)).get();
        if (!user) {
            return null;
        }
        return user.role;
    }

}

export class SessionHandler {

    static readonly SESSION_TOKEN_PREFIX = "lra_sess_";

    static async createSession(userID: number) {
        const result = await DB.instance().insert(DB.Schema.sessions).values({
            token: this.SESSION_TOKEN_PREFIX + crypto_randomBytes(32).toString('hex'),
            user_id: userID,
            user_role: await AuthUtils.getUserRole(userID) || 'user',
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).getTime() // 7 days from now
        }).returning()
        
        return result[0];
    }

    static async getSession(sessionToken: string) {

        if (!sessionToken.startsWith(this.SESSION_TOKEN_PREFIX)) {
            return null;
        }

        const session = DB.instance().select().from(DB.Schema.sessions).where(eq(DB.Schema.sessions.token, sessionToken)).get();
        if (!session) {
            return null;
        }

        return session;
    }

    static async isValidSession(session: DB.Models.Session) {
        if (!session) {
            return false;
        }

        if (session.expires_at < Date.now()) {
            // Delete expired session
            await DB.instance().delete(DB.Schema.sessions).where(eq(DB.Schema.sessions.token, session.token));

            return false;
        }

        return true;
    }
        
    static async inValidateAllSessionsForUser(userID: number) {
        await DB.instance().delete(DB.Schema.sessions).where(eq(DB.Schema.sessions.user_id, userID));
    }

    static async inValidateSession(sessionToken: string) {
        await DB.instance().delete(DB.Schema.sessions).where(eq(DB.Schema.sessions.token, sessionToken));
    }

    static async changeUserRoleInSessions(userID: number, newRole: 'admin' | 'developer' | 'user') {
        await DB.instance().update(DB.Schema.sessions).set({
            user_role: newRole
        }).where(
            eq(DB.Schema.sessions.user_id, userID)
        )
    }

}

export class APIKeyHandler {

    static readonly API_KEY_PREFIX = "lra_apikey_";

    static async createApiKey(userID: number, expiresInDays?: number) {
        const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).getTime() : null;
        
        const result = await DB.instance().insert(DB.Schema.apiKeys).values({
            token: this.API_KEY_PREFIX + crypto_randomBytes(32).toString('hex'),
            user_id: userID,
            user_role: await AuthUtils.getUserRole(userID) || 'user',
            expires_at: expiresAt
        }).returning()

        return result[0];
    }

    static async getApiKey(apiKey: string) {

        if (!apiKey.startsWith(this.API_KEY_PREFIX)) {
            return null;
        }

        const key = DB.instance().select().from(DB.Schema.apiKeys).where(eq(DB.Schema.apiKeys.token, apiKey)).get();
        if (!key) {
            return null;
        }

        return key;
    }

    static async isValidApiKey(key: Omit<DB.Models.ApiKey, 'id'>) {
        if (!key) {
            return false;
        }

        if (key.expires_at && key.expires_at < Date.now()) {
            return false;
        }

        return true;
    }

    static async deleteAllApiKeysForUser(userID: number) {
        await DB.instance().delete(DB.Schema.apiKeys).where(eq(DB.Schema.apiKeys.user_id, userID));
    }

    static async deleteApiKey(apiKey: string) {
        await DB.instance().delete(DB.Schema.apiKeys).where(eq(DB.Schema.apiKeys.token, apiKey));
    }

    static async changeUserRoleInApiKeys(userID: number, newRole: 'admin' | 'developer' | 'user') {
        await DB.instance().update(DB.Schema.apiKeys).set({
            user_role: newRole
        }).where(
            eq(DB.Schema.apiKeys.user_id, userID)
        );
    }
}

export class AuthHandler {

    static async getTokenType(token: string) {
        if (token.startsWith(SessionHandler.SESSION_TOKEN_PREFIX)) {
            return 'session';
        } else if (token.startsWith(APIKeyHandler.API_KEY_PREFIX)) {
            return 'apiKey';
        } else {
            return 'unknown';
        }
    }

    static async getAuthContext(token: string): Promise<AuthHandler.AuthContext | null> {

        switch (await this.getTokenType(token)) {
            case 'session':

                const session = await SessionHandler.getSession(token);
                if (!session) {
                    return null;
                }
                return {
                    type: 'session' as const,
                    ...session
                }
            case 'apiKey':
                const apiKey = await APIKeyHandler.getApiKey(token);
                if (!apiKey) {
                    return null;
                }
                return {
                    type: 'apiKey' as const,
                    ...apiKey
                }
            default:
                return null;
        }

    }

    static async isValidAuthContext(authContext: AuthHandler.AuthContext): Promise<boolean> {
        switch (authContext.type) {
            case 'session':
                return await SessionHandler.isValidSession(authContext);
            case 'apiKey':
                return await APIKeyHandler.isValidApiKey(authContext);
            default:
                return false;
        }
    }

    static async invalidateAuthContext(authContext: AuthHandler.AuthContext): Promise<void> {
        switch (authContext.type) {
            case 'session':
                await SessionHandler.inValidateSession(authContext.token);
                break;
            case 'apiKey':
                await APIKeyHandler.deleteApiKey(authContext.token);
                break;
        }
    }

    static async invalidateAllAuthContextsForUser(userID: number): Promise<void> {
        return await Promise.all([
            SessionHandler.inValidateAllSessionsForUser(userID),
            APIKeyHandler.deleteAllApiKeysForUser(userID)
        ]).then(() => { return; });
    }

    static async changeUserRoleInAuthContexts(userID: number, newRole: 'admin' | 'developer' | 'user'): Promise<void> {
        return await Promise.all([
            SessionHandler.changeUserRoleInSessions(userID, newRole),
            APIKeyHandler.changeUserRoleInApiKeys(userID, newRole)
        ]).then(() => { return; });
    }

}

export namespace AuthHandler {

    export type AuthContext = SessionAuthContext | ApiKeyAuthContext;

    export interface SessionAuthContext extends DB.Models.Session {
        readonly type: 'session';
    }

    export interface ApiKeyAuthContext extends DB.Models.ApiKey {
        readonly type: 'apiKey';
    }

}