import { SQLiteTableWithColumns } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { DrizzleDB } from "../utils";

export namespace ResourceUtils {

    export namespace Routes {
        export interface Config {
            method: string;
            url: string;
            handler: Function;
        }
        export const SYMBOL = Symbol("ROUTES");
    }

    export interface ResourceConstructorLike {
        [ResourceUtils.Routes.SYMBOL]: Array<ResourceUtils.Routes.Config>;
    }
}

export abstract class Resource {

    constructor(
        // readonly table: SQLiteTableWithColumns<any>,
        readonly db: DrizzleDB
    ) {}

    abstract insert(...args: any[]): void;
    abstract select(...args: any[]): void;
    abstract update(...args: any[]): void;
    abstract delete(...args: any[]): void;

    readonly [ResourceUtils.Routes.SYMBOL]: Array<ResourceUtils.Routes.Config> = [];
}

function ResourceDecoratorFactory(method: string) {
    return function<URL extends string>(url: URL) {
        return function(target: ResourceUtils.ResourceConstructorLike, propertyKey: string, descriptor: PropertyDescriptor) {
            target[ResourceUtils.Routes.SYMBOL].push({
                method,
                url,
                handler: ((target as any)[propertyKey] as Function).bind(target)
            });
        };
    };
}

export const GET = ResourceDecoratorFactory('GET');
export const POST = ResourceDecoratorFactory('POST');
export const PUT = ResourceDecoratorFactory('PUT');
export const DELETE = ResourceDecoratorFactory('DELETE');
export const PATCH = ResourceDecoratorFactory('PATCH');

export const OPTIONS = ResourceDecoratorFactory('OPTIONS');
export const HEAD = ResourceDecoratorFactory('HEAD');
export const TRACE = ResourceDecoratorFactory('TRACE');
export const CONNECT = ResourceDecoratorFactory('CONNECT');

export const ALL = ResourceDecoratorFactory('ALL');