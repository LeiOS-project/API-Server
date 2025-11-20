import { Elysia } from 'elysia'
import { db } from './db/model'
import { z } from 'zod'
import { UserResource } from './db/resources/user';
import { DB } from './db/index';

DB.init();

export const app = new Elysia()
	.post('/user/sign-up', async ({ body }) => {

        const userResource = new UserResource(DB.get());
        userResource.insert(body);

        // Here you would normally handle the sign-up logic, e.g., inserting into the database
        return { message: 'User signed up successfully' };
	}, {
		body: new UserResource(DB.get()).schemas.create
	})
    .get('/user/:id', ({ params }) => {
        console.log('Get user request received for ID:', params.id);
        

    })

app.listen(Bun.env.PORT ?? 3000, () => {
    console.log(`Server running at http://localhost:${Bun.env.PORT ?? 3000}`);
});
