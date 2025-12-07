import { z } from "zod";
import { createInsertSchema } from "drizzle-zod";
import { DB } from "../../../../db";
import { PackageModel } from "../../../utils/shared-models/package";

export namespace AdminPackageModel.CreatePackage {

    export const Body = PackageModel.CreatePackage.Body.extend({
        owner_user_id: z.number().positive()
    });
    export type Body = z.infer<typeof Body>;

    export const Response = PackageModel.CreatePackage.Response;
    export type Response = PackageModel.CreatePackage.Response;
}
