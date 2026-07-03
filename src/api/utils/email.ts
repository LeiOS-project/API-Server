import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { ConfigHandler } from "../../utils/config";
import { Logger } from "../../utils/logger";

export interface CapturedEmail {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
}

export class EmailService {

    private static transporter: Transporter | null = null;
    private static enabled = false;

    private static _from: string = "\"LeiOS\" <noreply@leios.dev>";

    /**
     * Initialise the email service from the current config.
     * Safe to call even when SMTP is unconfigured — logs a warning and disables itself.
     *
     * When `testTransport` is provided it is used instead of creating a real SMTP
     * transport, making the service testable without a live SMTP server.
     */
    static init(testTransport?: Transporter) {
        const config = ConfigHandler.getConfig() as NonNullable<ReturnType<typeof ConfigHandler.getConfig>>;
        const host = config.LRA_SMTP_HOST;

        if (testTransport) {
            this.transporter = testTransport;
            this.enabled = true;
            if (config.LRA_SMTP_FROM) {
                this._from = config.LRA_SMTP_FROM;
            }
            Logger.log("Email service initialised (test transport)");
            return;
        }

        if (!host) {
            Logger.warn("SMTP not configured — email features disabled");
            return;
        }

        try {
            this.transporter = nodemailer.createTransport({
                host,
                port: parseInt(config.LRA_SMTP_PORT ?? "587"),
                secure: config.LRA_SMTP_SECURE === true,
                auth: config.LRA_SMTP_USERNAME
                    ? {
                        user: config.LRA_SMTP_USERNAME,
                        pass: config.LRA_SMTP_PASSWORD ?? "",
                    }
                    : undefined,
            });

            if (config.LRA_SMTP_FROM) {
                this._from = config.LRA_SMTP_FROM;
            }

            this.enabled = true;
            Logger.log(`Email service initialised (SMTP ${host}:${config.LRA_SMTP_PORT ?? "587"})`);
        } catch (err) {
            Logger.error(`Failed to initialise email service: ${err}`);
        }
    }

    /** Reset the service to its unconfigured state (for testing). */
    static reset() {
        this.transporter = null;
        this.enabled = false;
        this._from = "\"LeiOS\" <noreply@leios.dev>";
    }

    /** Whether the email service is configured and ready. */
    static isEnabled() {
        return this.enabled;
    }

    /** The configured "from" address. */
    static getFrom(): string {
        return this._from;
    }

    /**
     * Send a password-reset email to a user.
     *
     * This is fire-and-forget: errors are logged but never thrown, so callers
     * should use `.catch()` if they need to react to failures.
     */
    static async sendPasswordResetEmail(to: string, rawToken: string) {
        if (!this.transporter) {
            Logger.warn("Email service not available — cannot send password reset email");
            return;
        }

        const config = ConfigHandler.getConfig() as NonNullable<ReturnType<typeof ConfigHandler.getConfig>>;
        const hubUrl = (config.LRA_HUB_URL || "https://hub.leios.dev").replace(/\/+$/, "");
        const resetUrl = `${hubUrl}/auth/reset-password?token=${encodeURIComponent(rawToken)}`;

        const html = [
            "<!DOCTYPE html>",
            "<html><head><meta charset=\"utf-8\"></head><body>",
            "<div style=\"max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif\">",
            "",
            "  <h2 style=\"color:#1a1a2e\">Password Reset Request</h2>",
            "",
            "  <p>We received a request to reset the password for your LeiOS account.",
            "  If you made this request, click the button below to set a new password.</p>",
            "",
            `  <a href="${resetUrl}" style="display:inline-block;padding:12px 28px;margin:20px 0;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Reset Password</a>`,
            "",
            "  <p style=\"color:#666;font-size:14px\">This link will expire in <strong>1 hour</strong>.</p>",
            "",
            "  <hr style=\"border:none;border-top:1px solid #e5e7eb;margin:24px 0\">",
            "",
            "  <p style=\"color:#999;font-size:13px\">",
            "  If you did not request a password reset, you can safely ignore this email.",
            "  Your account remains secure.</p>",
            "",
            "</div>",
            "</body></html>",
        ].join("\n");

        try {
            const info = await this.transporter.sendMail({
                from: this._from,
                to,
                subject: "LeiOS — Password Reset Request",
                html,
            });
            Logger.log(`Password reset email sent to ${to} (message-id: ${info.messageId})`);
        } catch (err) {
            Logger.error(`Failed to send password reset email to ${to}: ${err}`);
        }
    }
}
