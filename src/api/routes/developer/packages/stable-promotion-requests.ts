import { Hono } from "hono";
import { setupPackageStablePromotionRequestRoutes } from "../../../utils/services/pkg-stable-promotion-requests";

export const router = new Hono().basePath('/stable-promotion-requests');

await setupPackageStablePromotionRequestRoutes(router, false);
