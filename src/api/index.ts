import { Elysia } from 'elysia'
import { openapi as openapi_plugin } from '@elysiajs/openapi'

const routes = {
    user: await import('./routes/user'),
    auth: await import('./routes/auth'),
}

export const API_SERVER = new Elysia()
    .use(openapi_plugin())