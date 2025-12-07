import { createSelectSchema } from "drizzle-zod";
import { DB } from "../../../../../db";
import { z } from "zod";

export namespace StablePromotionRequestsModel.GetById {

    export const Response = createSelectSchema(DB.Schema.stablePromotionRequests).omit({
        
    });

    export type Response = z.infer<typeof Response>;
}

export namespace StablePromotionRequestsModel.GetAll {

    export const Response = z.array(StablePromotionRequestsModel.GetById.Response);
    export type Response = z.infer<typeof Response>;

}

export namespace StablePromotionRequestsModel.CreateRequest {

}

export namespace StablePromotionRequestsModel.DeleteRequest {

}