import crypto from "node:crypto";
import type { SkillEntry, SkillSnapshot } from "../types/skills.js";
import { escapeXmlAttr, escapeXmlContent } from "../infra/security.js";

/**
 * Build a skill snapshot for inclusion in the system prompt.
 * Formats eligible skills as XML for the agent to discover.
 */
export function buildSkillSnapshot(skills: SkillEntry[]): SkillSnapshot {
  const eligible = skills.filter((s) => s.eligible);

  if (eligible.length === 0) {
    return { prompt: "", count: 0, names: [], version: "" };
  }

  const parts = eligible.map((skill) => {
    const commands = skill.commands
      .map((c) => `  - /${c.name}: ${escapeXmlContent(c.description, "commands")}`)
      .join("\n");

    return [
      `<skill name="${escapeXmlAttr(skill.name)}">`,
      `  <description>${escapeXmlContent(skill.description, "description")}</description>`,
      commands ? `  <commands>\n${commands}\n  </commands>` : "",
      `  <path>${escapeXmlContent(skill.path, "path")}</path>`,
      `</skill>`,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const prompt = `<available-skills>\n${parts.join("\n\n")}\n</available-skills>`;
  const names = eligible.map((s) => s.name);
  const version = crypto.createHash("sha256").update(names.join(",")).digest("hex").slice(0, 8);

  return { prompt, count: eligible.length, names, version };
}
