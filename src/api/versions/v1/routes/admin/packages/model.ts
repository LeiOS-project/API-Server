import z from "zod";

export namespace AdminPackagesModel {
	export const Param = z.object({
		fullPackageName: z.string().min(1),
	});
}

export namespace AdminPackagesModel.UpdateModeration {
	export const Body = z.object({
		/** Hide the package from public listings and package pages. */
		hidden: z.boolean(),
		/** Keep the package listed but mark it as deprecated. */
		deprecated: z.boolean(),
		/** Reason shown to admins and, for deprecated packages, on the package page. */
		note: z.string().max(500).nullable(),
	});
	export type Body = z.infer<typeof Body>;
}
