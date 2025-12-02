import { Hono } from "hono";

export const router = new Hono().basePath('/public');