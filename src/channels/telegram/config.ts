import { z } from "zod";

export const telegramConfigSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().optional(),
  allowedChatIds: z.array(z.number()).optional(),
  dmPolicy: z.enum(["open", "allowlist", "disabled"]).default("open"),
  groupPolicy: z.enum(["enabled", "disabled"]).default("disabled"),
  streaming: z.boolean().default(true),
});

export type TelegramConfig = z.infer<typeof telegramConfigSchema>;
