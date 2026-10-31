import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { ConfigHandler } from "../../utils/config";

/**
 * Fixed-window, in-memory attempt counter. Per process and reset on restart, which is enough for a
 * single-instance deployment; several instances would need a shared store.
 */
export class RateLimiter {
	protected readonly entries = new Map<string, { count: number; resetAt: number }>();

	constructor(
		readonly maxAttempts: number,
		readonly windowMs: number,
	) {
		// Drop expired windows so the map does not grow without bound; unref'd so it never keeps
		// the process alive.
		setInterval(() => {
			const now = Date.now();
			for (const [key, entry] of this.entries) {
				if (entry.resetAt <= now) this.entries.delete(key);
			}
		}, windowMs).unref();
	}

	/** Counts an attempt for `key` and returns whether it is still within the limit. */
	hit(key: string) {
		const now = Date.now();
		let entry = this.entries.get(key);
		if (!entry || entry.resetAt <= now) {
			entry = { count: 0, resetAt: now + this.windowMs };
			this.entries.set(key, entry);
		}
		entry.count += 1;
		return entry.count <= this.maxAttempts;
	}

	/** Seconds until the window for `key` ends (for a `Retry-After` header). */
	retryAfterSeconds(key: string) {
		const entry = this.entries.get(key);
		return entry ? Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000)) : 1;
	}

	reset(key: string) {
		this.entries.delete(key);
	}
}

export namespace RateLimiter {
	/**
	 * The client's address for per-client limits. With LRA_API_TRUST_PROXY it is the first
	 * X-Forwarded-For entry (set by the reverse proxy); otherwise the address Bun sees — the proxy's
	 * own address when there is one, which turns per-client limits into one shared bucket.
	 * "unknown" when neither is available (tests calling API.getApp().request()).
	 */
	export function clientId(c: Context) {
		if (ConfigHandler.getConfig()?.API_TRUST_PROXY) {
			const forwarded = c.req.header("X-Forwarded-For")?.split(",")[0]?.trim();
			if (forwarded) return forwarded;
		}

		try {
			return getConnInfo(c).remote.address ?? "unknown";
		} catch {
			return "unknown";
		}
	}
}
