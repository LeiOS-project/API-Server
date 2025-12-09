import { expect } from "bun:test";
import { API } from "../../src/api";
import z, { ZodType } from "zod";
import { Logger } from "../../src/utils/logger";

export async function makeAPIRequest<ReturnBody = null>(
    path: string,
    opts: {
        method?: "GET" | "POST" | "PUT" | "DELETE",
        authToken?: string,
        body?: Record<string, any>,
        expectedBodySchema?: ZodType<ReturnBody>,
        additionalOptions?: RequestInit
    } = {},
    expectedCode?: number
) {
    const options: RequestInit = {
        method: opts.method ?? "GET",
        headers: {
            ...(opts.body ? { "Content-Type": "application/json" } : {}),
            ...(opts.authToken ? { "Authorization": `Bearer ${opts.authToken}` } : {})
        },
        ...opts.additionalOptions,
        body: opts.body ? JSON.stringify(opts.body) : undefined
    };


    const res = await API.getApp().request(path, options);

    if (!expectedCode) {
        expect(res.status).toBeOneOf([200, 201, 202, 204]);
    } else {
        expect(res.status).toBe(expectedCode);
    }

    if (opts.expectedBodySchema) {

        const resBody = await res.json();

        const parseResult = opts.expectedBodySchema.safeParse(resBody.data || {});
        if (parseResult.success) {
            expect(parseResult.success).toBe(true);
            return parseResult.data;
        } else {
            Logger.error("Response body did not match expected schema:", parseResult.error.message);
            //@ts-ignore
            expect(parseResult.success).toBe(true);
        }
    }

    return null as any as ReturnBody;

}
