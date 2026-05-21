import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = resolve(repoRoot, "package.json");

async function readPackageJson() {
  return JSON.parse(await readFile(packageJsonPath, "utf8"));
}

test("package manifest is installable by Pi without pinning a host Pi version", async () => {
  const pkg = await readPackageJson();

  assert.equal(pkg.name, "pi-openai-fast");
  assert.equal(pkg.type, "module");
  assert.deepEqual(pkg.pi?.extensions, ["./index.ts"]);
  assert.equal(existsSync(resolve(repoRoot, "index.ts")), true);
  assert.match(pkg.scripts?.typecheck ?? "", /\btsc\b/);
  assert.match(pkg.scripts?.typecheck ?? "", /tsconfig\.json/);
  assert.match(pkg.scripts?.check ?? "", /npm run typecheck\s*&&\s*npm test/);
  assert.equal(typeof pkg.devDependencies?.typescript, "string");

  assert.deepEqual(pkg.peerDependencies, {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
  });
  assert.equal(
    Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}) }).some((name) =>
      name.startsWith("@mariozechner/"),
    ),
    false,
  );
});

test("public extension surface is limited to fast mode and footer/status feedback", async () => {
  const extensionModule = await import(pathToFileURL(resolve(repoRoot, "index.ts")).href);

  assert.equal(typeof extensionModule.default, "function");
  assert.equal(typeof extensionModule.registerPiOpenAIFast, "function");
  assert.deepEqual(extensionModule.FAST_EXTENSION_CAPABILITIES, [
    "fast-mode",
    "footer-status-feedback",
  ]);

  const forbiddenSurface = /usage|image|pet|openai-settings|model-selection|transport|auth/i;
  assert.equal(
    extensionModule.FAST_EXTENSION_CAPABILITIES.some((capability) => forbiddenSurface.test(capability)),
    false,
  );
});
