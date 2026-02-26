import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { DB } from "../../../db";
import z from "zod";

export namespace PublisherModel {

    export const ForbiddenPublisherNames = [
        "admin",
        "api",
        "auth",
        "dashboard",
        "developer",
        "home",
        "settings",
        "public",
        "system",
        "root",
        "leios",
        "leicraft",
    ] as const;

    // Publisher name validation: lowercase, alphanumeric, hyphens allowed
    export const PublisherNameSchema = z.string()
        .min(2, "Publisher name must be at least 2 characters long.")
        .max(50, "Publisher name cannot exceed 50 characters.")
        .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Publisher name must be lowercase, may contain hyphens, and start/end with alphanumeric.")
        .refine((name) => !ForbiddenPublisherNames.includes(name as any), {
            message: "This publisher name is reserved and cannot be used."
        });

    export const MemberRole = z.enum(['owner', 'maintainer', 'developer', 'reporter', 'guest']);
    export type MemberRole = z.infer<typeof MemberRole>;

    export const MemberPermissions = z.object({
        canCreatePackages: z.boolean(),
        canEditPackages: z.boolean(),
        canDeletePackages: z.boolean(),
        canPushReleases: z.boolean(),
        canManageMembers: z.boolean(),
        canCreateGroups: z.boolean(),
        canRequestTopLevelAlias: z.boolean(),
    });
    export type MemberPermissions = z.infer<typeof MemberPermissions>;

    // Default permissions per role
    export const DefaultPermissions: Record<MemberRole, MemberPermissions> = {
        owner: {
            canCreatePackages: true,
            canEditPackages: true,
            canDeletePackages: true,
            canPushReleases: true,
            canManageMembers: true,
            canCreateGroups: true,
            canRequestTopLevelAlias: true,
        },
        maintainer: {
            canCreatePackages: true,
            canEditPackages: true,
            canDeletePackages: true,
            canPushReleases: true,
            canManageMembers: true,
            canCreateGroups: true,
            canRequestTopLevelAlias: true,
        },
        developer: {
            canCreatePackages: true,
            canEditPackages: true,
            canDeletePackages: false,
            canPushReleases: true,
            canManageMembers: false,
            canCreateGroups: false,
            canRequestTopLevelAlias: false,
        },
        reporter: {
            canCreatePackages: false,
            canEditPackages: false,
            canDeletePackages: false,
            canPushReleases: false,
            canManageMembers: false,
            canCreateGroups: false,
            canRequestTopLevelAlias: false,
        },
        guest: {
            canCreatePackages: false,
            canEditPackages: false,
            canDeletePackages: false,
            canPushReleases: false,
            canManageMembers: false,
            canCreateGroups: false,
            canRequestTopLevelAlias: false,
        },
    };
}

export namespace PublisherModel.CreatePublisher {
    export const Body = createInsertSchema(DB.Schema.publishers, {
        name: PublisherModel.PublisherNameSchema,
        display_name: z.string().min(1).max(100),
        description: z.string().min(1).max(500),
        homepage_url: z.string().url().optional(),
        avatar_url: z.string().url().optional(),
        visibility: z.enum(['public', 'private']).default('public'),
    }).omit({
        id: true,
        created_at: true,
        created_by_user_id: true,
    });

    export type Body = z.infer<typeof Body>;
}

export namespace PublisherModel.UpdatePublisher {
    export const Body = PublisherModel.CreatePublisher.Body.omit({
        name: true,
    }).partial().refine(
        (data) => Object.values(data).some((value) => value !== undefined),
        { message: "At least one field must be provided" }
    );

    export type Body = z.infer<typeof Body>;
}

export namespace PublisherModel.GetPublisher {
    export const Response = createSelectSchema(DB.Schema.publishers);
    export type Response = z.infer<typeof Response>;
}

export namespace PublisherModel.GetAllPublishers {
    export const Response = z.array(PublisherModel.GetPublisher.Response);
    export type Response = z.infer<typeof Response>;
}

export namespace PublisherModel.CreateGroup {
    export const Body = createInsertSchema(DB.Schema.publisherGroups, {
        name: z.string()
            .min(2, "Group name must be at least 2 characters long.")
            .max(50, "Group name cannot exceed 50 characters.")
            .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Group name must be lowercase, may contain hyphens, and start/end with alphanumeric."),
        display_name: z.string().min(1).max(100),
        description: z.string().min(1).max(500),
        visibility: z.enum(['public', 'private']).default('public'),
    }).omit({
        id: true,
        created_at: true,
        created_by_user_id: true,
        publisher_id: true,
    });

    export type Body = z.infer<typeof Body>;
}

export namespace PublisherModel.UpdateGroup {
    export const Body = PublisherModel.CreateGroup.Body.omit({
        name: true,
        parent_group_id: true,
    }).partial().refine(
        (data) => Object.values(data).some((value) => value !== undefined),
        { message: "At least one field must be provided" }
    );

    export type Body = z.infer<typeof Body>;
}

export namespace PublisherModel.GetGroup {
    export const Response = createSelectSchema(DB.Schema.publisherGroups);
    export type Response = z.infer<typeof Response>;
}

export namespace PublisherModel.GetAllGroups {
    export const Response = z.array(PublisherModel.GetGroup.Response);
    export type Response = z.infer<typeof Response>;
}

export namespace PublisherModel.AddMember {
    export const Body = z.object({
        user_id: z.number().int().positive(),
        role: PublisherModel.MemberRole,
        permissions: PublisherModel.MemberPermissions.optional(),
        group_id: z.number().int().positive().optional(), // If specified, adds to specific group
    });

    export type Body = z.infer<typeof Body>;
}

export namespace PublisherModel.UpdateMember {
    export const Body = z.object({
        role: PublisherModel.MemberRole.optional(),
        permissions: PublisherModel.MemberPermissions.optional(),
    }).refine(
        (data) => data.role !== undefined || data.permissions !== undefined,
        { message: "At least one field (role or permissions) must be provided" }
    );

    export type Body = z.infer<typeof Body>;
}

export namespace PublisherModel.GetMember {
    export const Response = createSelectSchema(DB.Schema.publisherMembers);
    export type Response = z.infer<typeof Response>;
}

export namespace PublisherModel.GetAllMembers {
    export const Response = z.array(PublisherModel.GetMember.Response);
    export type Response = z.infer<typeof Response>;
}
