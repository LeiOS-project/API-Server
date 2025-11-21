import { Elysia } from 'elysia'
import { openapi as openapi_plugin } from '@elysiajs/openapi'

const routes = 

export const API_SERVER = new Elysia()
    .use(openapi_plugin())