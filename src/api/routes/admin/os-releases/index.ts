import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { z } from "zod";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { OSReleases } from "./model";
import { DB } from "../../../../db";
import { APIResponse } from "../../../utils/api-res";
import { eq } from "drizzle-orm";

export const router = new Hono().basePath('/os-releases');