import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("./eligibility.js", () => ({
  checkSkillEligibility: () => true,
}));

// Import after mock so the mock is applied
const { loadSkillEntries } = await import("./loader.js");

let tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

function makeTmpDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "jinx-skills-test-"));
  tmpDirs.push(dir);
  return dir;
}

function createSkillDir(parentDir: string, skillName: string, frontmatter: string): void {
  const skillDir = path.join(parentDir, skillName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(path.join(skillDir, "SKILL.md"), frontmatter, "utf-8");
}

describe("loadSkillEntries", () => {
  it("loads skills from directory", async () => {
    const dir = makeTmpDir();
    createSkillDir(dir, "my-skill", "---\nname: my-skill\ndescription: Test\n---\n# Test");

    const skills = await loadSkillEntries([dir]);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("my-skill");
    expect(skills[0].description).toBe("Test");
    expect(skills[0].eligible).toBe(true);
    expect(skills[0].path).toBe(path.join(dir, "my-skill", "SKILL.md"));
  });

  it("skips directories without SKILL.md", async () => {
    const dir = makeTmpDir();
    // Create a directory but no SKILL.md inside it
    mkdirSync(path.join(dir, "no-skill-dir"));

    const skills = await loadSkillEntries([dir]);
    expect(skills).toHaveLength(0);
  });

  it("skips non-existent directories", async () => {
    const nonExistent = path.join(
      tmpdir(),
      `jinx-nonexistent-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    const skills = await loadSkillEntries([nonExistent]);
    expect(skills).toHaveLength(0);
  });

  it("loads from multiple directories", async () => {
    const dir1 = makeTmpDir();
    const dir2 = makeTmpDir();

    createSkillDir(dir1, "skill-a", "---\nname: skill-a\ndescription: Skill A\n---\n# A");
    createSkillDir(dir2, "skill-b", "---\nname: skill-b\ndescription: Skill B\n---\n# B");

    const skills = await loadSkillEntries([dir1, dir2]);
    expect(skills).toHaveLength(2);

    const names = skills.map((s) => s.name).toSorted();
    expect(names).toEqual(["skill-a", "skill-b"]);
  });
});
