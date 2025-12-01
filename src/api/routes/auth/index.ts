import Elysia from "elysia";

export const auth = new Elysia({ prefix: '/auth' })

.post('/login', async ({ body }) => {
    // Handle login logic here
    return { message: 'User logged in successfully' };
}, {
    body: 

