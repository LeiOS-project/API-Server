import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { DB } from "../../../db";
import z from "zod";

export namespace PackageAliasModel {

    /**
     * Top-level aliases (meta packages) are simple names without dots
     * e.g., "vscode", "firefox", "chrome"
     */
    export const AliasNameSchema = z.string()
        .min(2, "Alias name must be at least 2 characters long.")
        .max(50, "Alias name cannot exceed 50 characters.")
        .regex(
            /^[a-z0-9][a-z0-9+.-]*[a-z0-9]$/,
            "Alias name must be lowercase, may contain + - ., and start/end with alphanumeric"
        )
        .refine((name) => !name.includes('.'), {
            message: "Top-level aliases cannot contain dots. Use the full hierarchical name instead."
        });

    export const AliasStatus = z.enum(['pending', 'approved', 'rejected']);
    export type AliasStatus = z.infer<typeof AliasStatus>;
}

export namespace PackageAliasModel.CreateAliasRequest {
    export const Body = z.object({
        alias_name: PackageAliasModel.AliasNameSchema,
        target_package_id: z.number().int().positive(),
    });

    export type Body = z.infer<typeof Body>;
}

export namespace PackageAliasModel.UpdateAliasRequest {
    export const Body = z.object({
        status: PackageAliasModel.AliasStatus,
        admin_note: z.string().max(500).optional(),
    });

    export type Body = z.infer<typeof Body>;
}

export namespace PackageAliasModel.GetAlias {
    export const Response = createSelectSchema(DB.Schema.packageAliases);
    export type Response = z.infer<typeof Response>;
}

export namespace PackageAliasModel.GetAllAliases {
    export const Response = z.array(PackageAliasModel.GetAlias.Response);
    export type Response = z.infer<typeof Response>;
}
