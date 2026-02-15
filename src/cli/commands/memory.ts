import { Command } from "commander";
import path from "node:path";
import { resolveHomeDir } from "../../infra/home-dir.js";
import { discoverMemoryFiles } from "../../memory/index-manager.js";

export const memoryCommand = new Command("memory")
  .description("Memory index management")
  .addCommand(
    new Command("status").description("Show memory index status").action(async () => {
      const homeDir = resolveHomeDir();
      const memoryDir = path.join(homeDir, "workspace", "memory");

      try {
        const files = await discoverMemoryFiles(memoryDir);
        console.log(`Memory directory: ${memoryDir}`);
        console.log(`Files discovered: ${files.length}`);
        for (const f of files.slice(0, 20)) {
          console.log(`  ${path.basename(f)}`);
        }
        if (files.length > 20) {
          console.log(`  ... and ${files.length - 20} more`);
        }
      } catch {
        console.log(`Memory directory not found: ${memoryDir}`);
      }
    }),
  )
  .addCommand(
    new Command("list").description("List memory files").action(async () => {
      const homeDir = resolveHomeDir();
      const memoryDir = path.join(homeDir, "workspace", "memory");

      try {
        const files = await discoverMemoryFiles(memoryDir);
        for (const f of files) {
          console.log(path.relative(memoryDir, f));
        }
      } catch {
        console.log("No memory files found.");
      }
    }),
  );
