import { expect } from "bun:test";
import { API } from "../../src/api";
import z, { ZodType } from "zod";
import { Logger } from "../../src/utils/logger";

export async function makeAPIRequest<ReturnBody>(
    path: string,
    opts: {
        method?: "GET" | "POST" | "PUT" | "DELETE",
        body?: Record<string, any>,
        expectedBodySchema?: ZodType<ReturnBody>,
        additionalOptions?: RequestInit
    } = {},
    shouldFail = false
) {
    const options: RequestInit = {
        method: opts.method ?? "GET",
        headers: opts.body ? { "Content-Type": "application/json" } : {},
        ...opts.additionalOptions,
        body: opts.body ? JSON.stringify(opts.body) : undefined
    };

    try {
        const res = await API.getApp().request(path, options);

        if (!shouldFail) {
            expect(res.status).toBeOneOf([200, 201, 202, 204]);
        } else {
            expect(res.status).not.toBeOneOf([200, 201, 202, 204]);
        }

        const resBody = await res.json();

        if (opts.expectedBodySchema) {
            const parseResult = opts.expectedBodySchema.safeParse(resBody);
            if (parseResult.success) {
                expect(parseResult.success).toBe(true);
                return parseResult.data;
            } else {
                Logger.error("Response body did not match expected schema:", parseResult.error.message);
                //@ts-ignore
                expect(parseResult.success).toBe(true);
            }
        }

        return resBody as ReturnBody;
        
    } catch (err) {
        if (!shouldFail) {
            // let the test fail if an error occurs
            if (!err) {
                throw new Error("Unknown error occurred during API request");
            }
            expect(err).toBeUndefined();
        }
        return null as any as ReturnBody;
    }
}
