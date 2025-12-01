import { z } from "zod";


export class AuthService {

    static async login(user: z.infer<typeof z.object({
        email: z.email(),
        password: z.string().min(6) 
    })>) {
        
    }
}