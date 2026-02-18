import { program } from "commander";

export function createCli(): typeof program {
  program
    .name("jinx")
    .description("Local-first multi-channel AI assistant powered by Claude Agent SDK")
    .version("0.1.0");

  program
    .command("chat")
    .description("Start an interactive chat session")
    .action(async () => {
      const { chatCommand } = await import("./commands/chat.js");
      await chatCommand();
    });

  program
    .command("gateway")
    .description("Start the gateway server")
    .action(async () => {
      const { gatewayCommand } = await import("./commands/gateway.js");
      await gatewayCommand();
    });

  program
    .command("config")
    .description("View or edit configuration")
    .argument("[action]", "show | set | validate", "show")
    .argument("[key]", "config key to set")
    .argument("[value]", "value to set")
    .action(async (action, key, value) => {
      const { configCommand } = await import("./commands/config.js");
      await configCommand(action, key, value);
    });

  // Lazy-loaded commands for startup performance
  program
    .command("onboard")
    .description("Bootstrap home directory, config, and workspace templates")
    .action(async () => {
      const { onboardCommand } = await import("./commands/onboard.js");
      await onboardCommand.parseAsync(process.argv.slice(2));
    });

  program
    .command("doctor")
    .description("Check system health and configuration")
    .action(async () => {
      const { doctorCommand } = await import("./commands/doctor.js");
      await doctorCommand.parseAsync(process.argv.slice(2));
    });

  program
    .command("memory")
    .description("Memory index management")
    .argument("[action]", "status | list", "status")
    .action(async (action) => {
      const { memoryCommand } = await import("./commands/memory.js");
      await memoryCommand.parseAsync(["node", "memory", action ?? "status"]);
    });

  program
    .command("skills")
    .description("Skills management")
    .argument("[action]", "list", "list")
    .action(async (action) => {
      const { skillsCommand } = await import("./commands/skills.js");
      await skillsCommand.parseAsync(["node", "skills", action ?? "list"]);
    });

  program
    .command("workspace", { isDefault: false })
    .description("Workspace management")
    .argument("[action]", "reset | show", "show")
    .option("-a, --all", "Reset ALL files including SOUL.md and AGENTS.md")
    .action(async (action, opts) => {
      const { workspaceCommand } = await import("./commands/workspace.js");
      const args = ["node", "workspace", action ?? "show"];
      if (opts.all) {
        args.push("--all");
      }
      await workspaceCommand.parseAsync(args);
    });

  program
    .command("send")
    .description("Send a message from the command line")
    .argument("<message>", "Message to send")
    .option("-s, --session <key>", "Session key")
    .action(async (message, opts) => {
      const { sendCommand } = await import("./commands/send.js");
      const args = ["node", "send", message];
      if (opts.session) {
        args.push("-s", opts.session);
      }
      await sendCommand.parseAsync(args);
    });

  program
    .command("delivery")
    .description("Inspect and replay dead-letter deliveries")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async () => {
      const { deliveryCommand } = await import("./commands/delivery.js");
      const deliveryIndex = process.argv.findIndex((arg) => arg === "delivery");
      const forwarded = deliveryIndex >= 0 ? process.argv.slice(deliveryIndex + 1) : [];
      await deliveryCommand.parseAsync(["node", "delivery", ...forwarded]);
    });

  program
    .command("setup-state")
    .description("Manage onboarding setup-state")
    .argument("[action]", "init | show | set-name | set-step | set-block | clear-block")
    .argument("[arg1]", "arg for selected action")
    .argument("[arg2]", "arg for selected action")
    .option("-n, --name <assistantName>", "assistant name (init)")
    .option("--reason <text>", "blocked reason / note")
    .option("--clear-reason", "clear blocked reason")
    .option("--json", "output JSON")
    .action(async (action, arg1, arg2, opts) => {
      const { setupStateCommand } = await import("./commands/setup-state.js");
      const args = ["node", "setup-state"];
      if (action) {
        args.push(action);
      }
      if (arg1) {
        args.push(arg1);
      }
      if (arg2) {
        args.push(arg2);
      }
      if (opts.name) {
        args.push("--name", opts.name);
      }
      if (opts.reason) {
        args.push("--reason", opts.reason);
      }
      if (opts.clearReason) {
        args.push("--clear-reason");
      }
      if (opts.json) {
        args.push("--json");
      }
      await setupStateCommand.parseAsync(args);
    });

  program
    .command("composio")
    .description("Manage Composio integrations")
    .argument("[action]", "auth | connections")
    .argument("[toolkit]", "toolkit slug for auth")
    .action(async (action, toolkit) => {
      const { composioCommand } = await import("./commands/composio.js");
      const args = ["node", "composio"];
      if (action) {
        args.push(action);
      }
      if (toolkit) {
        args.push(toolkit);
      }
      await composioCommand.parseAsync(args);
    });

  return program;
}
