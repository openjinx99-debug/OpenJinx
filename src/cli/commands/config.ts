import { loadRawConfig, resolveConfigPath } from "../../config/loader.js";
import { validateConfig } from "../../config/validation.js";

export async function configCommand(
  action = "show",
  _key?: string,
  _value?: string,
): Promise<void> {
  switch (action) {
    case "show": {
      const configPath = resolveConfigPath();
      const raw = await loadRawConfig();
      console.log(`Config path: ${configPath}\n`);
      console.log(JSON.stringify(raw, null, 2));
      break;
    }
    case "validate": {
      const raw = await loadRawConfig();
      const result = validateConfig(raw);
      if (result.ok) {
        console.log("Config is valid.");
      } else {
        console.error("Config validation errors:");
        for (const err of result.errors!) {
          console.error(`  - ${err}`);
        }
        process.exitCode = 1;
      }
      break;
    }
    default:
      console.error(`Unknown config action: ${action}`);
      process.exitCode = 1;
  }
}
