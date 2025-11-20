import { z } from 'zod'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'

import { table } from './schema'
import { spreads } from './resources/utils'


export const db = {
	insert: spreads({
		user: createInsertSchema(table.user, {
			email: z.email()
		}),
	}, 'insert'),
	select: spreads({
		user: createSelectSchema(table.user, {
			email: t.String({ format: 'email' })
		})
	}, 'select')
} as const;