import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const qrcode = require("qrcode-terminal") as {
  generate: (data: string, opts: { small: boolean }, cb: (output: string) => void) => void;
};

/**
 * Render a QR code string to the terminal.
 * Returns the rendered output string.
 */
export function renderQrToTerminal(data: string): string {
  let output = "";
  qrcode.generate(data, { small: true }, (rendered: string) => {
    output = rendered;
  });
  return output;
}
