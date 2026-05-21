import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = resolve(repoRoot, "package.json");
const packageLockPath = resolve(repoRoot, "package-lock.json");

async function readPackageJson() {
  return JSON.parse(await readFile(packageJsonPath, "utf8"));
}

async function readPackageLock() {
  return JSON.parse(await readFile(packageLockPath, "utf8"));
}

async function sourceFilesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        return sourceFilesUnder(path);
      }

      return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
    }),
  );

  return nestedFiles.flat();
}

async function directPiPackageImports() {
  const sourceFiles = [resolve(repoRoot, "index.ts"), ...(await sourceFilesUnder(resolve(repoRoot, "src")))];
  const imports = new Set();

  for (const sourceFile of sourceFiles) {
    const source = await readFile(sourceFile, "utf8");
    for (const match of source.matchAll(/from\s+["'](@earendil-works\/[^"']+)["']/g)) {
      imports.add(match[1]);
    }
  }

  return [...imports].sort();
}

test("package manifest is installable by Pi without pinning a host Pi version", async () => {
  const pkg = await readPackageJson();
  const packageLock = await readPackageLock();

  assert.equal(pkg.name, "pi-openai-fast");
  assert.equal(pkg.type, "module");
  assert.deepEqual(pkg.pi?.extensions, ["./index.ts"]);
  assert.equal(existsSync(resolve(repoRoot, "index.ts")), true);
  assert.match(pkg.scripts?.typecheck ?? "", /\btsc\b/);
  assert.match(pkg.scripts?.typecheck ?? "", /tsconfig\.json/);
  assert.match(pkg.scripts?.check ?? "", /npm run typecheck\s*&&\s*npm test/);
  assert.equal(typeof pkg.devDependencies?.typescript, "string");

  assert.deepEqual(pkg.peerDependencies, {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
  });
  assert.deepEqual(Object.keys(pkg.peerDependencies).sort(), await directPiPackageImports());
  assert.deepEqual(packageLock.packages[""].peerDependencies, pkg.peerDependencies);
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
