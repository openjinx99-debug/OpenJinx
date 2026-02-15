import { z } from "zod";

export const whatsappConfigSchema = z.object({
  enabled: z.boolean().default(false),
  authDir: z.string().default("~/.jinx/whatsapp-auth"),
  dmPolicy: z.enum(["open", "allowlist", "disabled"]).default("open"),
  groupPolicy: z.enum(["enabled", "disabled"]).default("disabled"),
  allowFrom: z.array(z.string()).optional(),
});

export type WhatsAppConfig = z.infer<typeof whatsappConfigSchema>;
