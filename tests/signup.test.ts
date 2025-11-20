import { describe, test, expect } from 'bun:test';
import { app } from '../src/index';

describe('Routes Tests', () => {

    test('/sign-up route', async () => {
        
        const response = await app.handle(new Request('http://localhost/user/sign-up', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: 'John Doe',
                age: 30,
                email: 'john.doe@example.com'
            })
        }));
        console.log(await response.json());
        expect(response.status).toBe(200);

    });

});