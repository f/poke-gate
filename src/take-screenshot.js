import { execSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";
import { isLoggedIn, login } from "poke";
import { sendToWebhook } from "./webhook.js";

export async function takeScreenshot() {
  if (platform() !== "darwin") {
    console.error("Screenshots are only supported on macOS.");
    process.exit(1);
  }

  if (!isLoggedIn()) {
    console.log("Signing in to Poke...");
    await login();
  }

  const dest = join(tmpdir(), `poke-gate-screenshot-${Date.now()}.png`);

  console.log("Capturing screenshot...");
  try {
    execSync(`/usr/sbin/screencapture -x "${dest}"`, { stdio: "pipe" });
  } catch {
    console.error("Screenshot failed. Grant Screen Recording permission in System Settings > Privacy & Security > Screen Recording.");
    process.exit(1);
  }

  const png = readFileSync(dest);
  const base64 = png.toString("base64");

  console.log(`Screenshot captured (${(png.length / 1024).toFixed(0)} KB). Sending to Poke...`);

  try {
    await sendToWebhook(
      `Here is a screenshot of my screen right now. Reply me with the image.\n\n\`\`\`\ndata:image/png;base64,${base64}\n\`\`\``
    );
    console.log("Screenshot sent to Poke.");
  } finally {
    try { unlinkSync(dest); } catch {}
  }
}
