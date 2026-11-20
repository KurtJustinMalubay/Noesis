import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function getUpdaterPlatform(artifactRoot, target, repository, tag) {
  const files = listFiles(artifactRoot);
  const installer =
    files.find((path) => path.toLowerCase().endsWith(".msi")) ??
    files.find(
      (path) =>
        path.toLowerCase().endsWith(".exe") &&
        path.toLowerCase().includes("setup")
    );
  if (!installer) {
    throw new Error(`No MSI or NSIS updater installer was found for ${target}.`);
  }

  const signaturePath = `${installer}.sig`;
  const signature = readFileSync(signaturePath, "utf8").trim();
  if (!signature) throw new Error(`The updater signature is empty: ${signaturePath}`);

  const assetName = basename(installer);
  return {
    signature,
    url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(
      assetName
    )}`,
  };
}

const tag = process.env.GITHUB_REF_NAME;
const repository = process.env.GITHUB_REPOSITORY;
const outputPath = process.argv[2] ?? "latest.json";
const assetRoot = process.argv[3] ?? "updater-assets";
if (!tag || !repository) {
  throw new Error("GITHUB_REF_NAME and GITHUB_REPOSITORY are required.");
}

const version = tag.replace(/^v/i, "");
const configuredVersion = JSON.parse(
  readFileSync("src-tauri/tauri.conf.json", "utf8")
).version;
if (configuredVersion !== version) {
  throw new Error(
    `Release tag ${tag} does not match the Tauri version ${configuredVersion}.`
  );
}

const platforms = {
  "windows-x86_64": getUpdaterPlatform(
    join(assetRoot, "x86_64"),
    "windows-x86_64",
    repository,
    tag
  ),
  "windows-aarch64": getUpdaterPlatform(
    join(assetRoot, "aarch64"),
    "windows-aarch64",
    repository,
    tag
  ),
};

const manifest = {
  version,
  notes: `Noesis ${version}`,
  pub_date: new Date().toISOString(),
  platforms,
};
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
