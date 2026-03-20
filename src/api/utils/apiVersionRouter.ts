import { Hono } from "hono";
import type { GenerateSpecOptions } from "hono-openapi";
import type { BlankEnv, BlankSchema, H } from "hono/types";

export abstract class APIVersionRouter<T extends APIVersionRouter.InitSettings = APIVersionRouter.InitSettings> {

    readonly version: number;
    readonly openAPIConfig: Readonly<APIVersionRouter.OpenAPIConfig>;
    readonly router: Hono;

    protected constructor(settings: Readonly<T>) {
        this.version = settings.version;
        this.openAPIConfig = settings.openAPIConfig;

        if (settings.routes instanceof Hono) {

            this.router = settings.routes;

        } else if (Array.isArray(settings.routes)) {

            this.router = new Hono();

            for (const route of (settings.routes as Array<{ router: Hono }> | Array<Hono>)) {
                if (route instanceof Hono) {
                    this.router.route("/", route);
                }
                else if ('router' in route && route.router instanceof Hono) {
                    this.router.route("/", route.router);
                }
                else {
                    throw new Error("Invalid route configuration: Each route must be a Hono instance or an object with a 'router' property that is a Hono instance.");
                }
            }
        } else {
            throw new Error("Invalid route configuration: 'routes' must be either a Hono instance or an array of Hono instances or objects with a 'router' property that is a Hono instance.");
        }
    }

}

export namespace APIVersionRouter {

    export interface InitSettings {
        version: number;
        openAPIConfig: OpenAPIConfig;
        routes: Routable;
    }

    export type OpenAPIConfig = Partial<GenerateSpecOptions>;
    
    export type Routable = Hono | Array<{ router: Hono } | Hono>;

}

