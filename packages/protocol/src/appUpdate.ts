import { z } from 'zod';

export const APP_VERSION_HEADER = 'x-nova-app-version';
export const APP_VERSION_CODE_HEADER = 'x-nova-app-version-code';
export const appUpdateSchema = z.object({
  minimumVersionCode: z.number().int().nonnegative().safe(),
  latestVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  latestVersionCode: z.number().int().positive().safe(),
  downloadUrl: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  }),
  message: z.string().min(1).max(1000),
}).refine((value) => value.latestVersionCode >= value.minimumVersionCode);
export type AppUpdate = z.infer<typeof appUpdateSchema>;
