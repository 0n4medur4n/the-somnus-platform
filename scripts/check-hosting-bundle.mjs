import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// React Router uses a dummy origin solely to resolve relative URLs when no
// window exists. Permit only this exact expression, never a host-wide exception.
const routerDummyOrigin =
  /let (\w+)="http:\/\/localhost";(\w+)&&\(\1=\2\.location\.origin!=="null"\?\2\.location\.origin:\2\.location\.href\)/g;
const forbidden =
  /localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|demo-api-key|somnus-dev-test|demo-[a-z0-9-]+\.firebaseapp\.com|https?:\/\/[^\s"'`]*:(?:9099|4400|4500|9150)\b|FIREBASE_AUTH_EMULATOR_HOST|FIRESTORE_EMULATOR_HOST/i;

export function checkHostingText(text, filename) {
  if (forbidden.test(text.replace(routerDummyOrigin, ""))) {
    throw new Error(`Hosting bundle contains a local/emulator marker: ${filename}`);
  }
}

export async function checkHostingBundle(directory) {
  const config = JSON.parse(await readFile(join(directory, "hosting-config.json"), "utf8"));
  if (!["dev", "staging", "production"].includes(config.environment)) {
    throw new Error("Hosting bundle lacks a valid deployment environment");
  }
  await readFile(join(directory, "index.html"));
  let javascript = "";
  async function scan(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const filename = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Hosting bundle cannot contain symlinks");
      if (entry.isDirectory()) await scan(filename);
      else {
        const text = await readFile(filename, "utf8");
        checkHostingText(text, filename);
        if (filename.endsWith(".js")) javascript += text;
      }
    }
  }
  await scan(directory);
  for (const key of [
    "VITE_EDGE_API_URL",
    "VITE_FIREBASE_API_KEY",
    "VITE_FIREBASE_AUTH_DOMAIN",
    "VITE_FIREBASE_PROJECT_ID",
  ]) {
    if (
      typeof config[key] !== "string" ||
      !config[key] ||
      !javascript.includes(JSON.stringify(config[key]))
    ) {
      throw new Error(`Hosting configuration missing from executable JavaScript: ${key}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await checkHostingBundle(resolve(process.argv[2] ?? "apps/somnus-app/dist"));
    process.stdout.write("Hosting bundle guard passed.\n");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Hosting guard failed"}\n`);
    process.exitCode = 1;
  }
}
