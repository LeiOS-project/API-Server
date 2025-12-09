import z from "zod";

export const TaskStatusSchema = z.object({
    id: z.number().int().positive(),
    job_type: z.string(),
    status: z.enum(["queued", "running", "completed", "failed"]),
    trigger: z.string(),
    created_at: z.number().int().optional(),
    updated_at: z.number().int().optional(),
    started_at: z.number().int().nullable().optional(),
    completed_at: z.number().int().nullable().optional(),
    error: z.string().nullable().optional(),
    result: z.unknown().nullable().optional()
});

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
