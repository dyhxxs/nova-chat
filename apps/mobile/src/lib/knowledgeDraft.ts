import { z } from 'zod';

export const knowledgeDraftInputSchema = z.object({
  id: z.string().uuid().optional(), updatedAt: z.number().finite().nonnegative().optional(),
  title: z.string().max(160), text: z.string().max(120_000),
}).refine(value => (value.id === undefined) === (value.updatedAt === undefined), '原资料与版本必须同时存在');
export const knowledgeDraftSchema = knowledgeDraftInputSchema.safeExtend({
  editId: z.string().uuid(), revision: z.string().uuid(), editedAt: z.number().finite().nonnegative(),
});
export type KnowledgeDraft = z.infer<typeof knowledgeDraftSchema>;
export type KnowledgeDraftInput = z.infer<typeof knowledgeDraftInputSchema>;
