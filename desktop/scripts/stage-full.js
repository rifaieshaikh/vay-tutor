const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const repo = path.resolve(__dirname, "..", "..");
const host = path.join(repo, "desktop", "host");
const resources = path.join(host, "resources");
const cache = path.join(host, ".cache");
const pythonVersion = "3.12.8";
const mongoVersions = ["8.0.13", "8.0.12", "8.0.11", "8.0.10", "8.0.4"];

function pythonLauncher() {
  if (process.platform === "win32") return "python";
  const venv = path.join(repo, "backend", ".venv", "bin", "python");
  return fs.existsSync(venv) ? venv : "python3";
}

function run(command, args, cwd) {
  const shell = process.platform === "win32" && command === "npm";
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

async function download(url, destination) {
  if (fs.existsSync(destination) && fs.statSync(destination).size > 0) return destination;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
  return destination;
}

async function firstAvailable(urls) {
  for (const url of urls) {
    const response = await fetch(url, { headers: { Range: "bytes=0-0" } });
    await response.body?.cancel();
    if (response.ok || response.status === 206) return url;
  }
  throw new Error("MongoDB Community for Windows could not be downloaded.");
}

function extractZip(archive, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const python = pythonLauncher();
  const script = "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])";
  run(python, ["-c", script, archive, destination]);
}

function findFile(directory, name) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.name.toLowerCase() === name.toLowerCase()) return full;
  }
  return null;
}

function copyTree(source, destination, skip) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (skip(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTree(from, to, skip);
    else fs.copyFileSync(from, to);
  }
}

async function stageMongo() {
  const target = path.join(resources, "mongo", "mongod.exe");
  if (fs.existsSync(target)) return;
  const urls = mongoVersions.map((version) => `https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-${version}.zip`);
  const url = await firstAvailable(urls);
  const archive = await download(url, path.join(cache, path.basename(url)));
  const extracted = path.join(cache, "mongo");
  fs.rmSync(extracted, { recursive: true, force: true });
  extractZip(archive, extracted);
  const binary = findFile(extracted, "mongod.exe");
  if (!binary) throw new Error("The MongoDB archive has no mongod.exe.");
  copyTree(path.dirname(binary), path.join(resources, "mongo"), (name) => {
    const lower = name.toLowerCase();
    return lower.endsWith(".pdb") || lower === "mongos.exe" || lower === "install-compass.ps1" || lower === "vc_redist.x64.exe";
  });
  const licenseRoot = path.dirname(path.dirname(binary));
  for (const name of fs.readdirSync(licenseRoot)) {
    const from = path.join(licenseRoot, name);
    if (name.toLowerCase().includes("license") && fs.statSync(from).isFile()) {
      fs.copyFileSync(from, path.join(resources, "mongo", name));
    }
  }
}

async function stagePython() {
  const target = path.join(resources, "python", "python.exe");
  if (!fs.existsSync(target)) {
    const archive = await download(
      `https://www.python.org/ftp/python/${pythonVersion}/python-${pythonVersion}-embed-amd64.zip`,
      path.join(cache, `python-${pythonVersion}-embed-amd64.zip`),
    );
    extractZip(archive, path.join(resources, "python"));
  }
  const site = path.join(resources, "python", "Lib", "site-packages");
  fs.mkdirSync(site, { recursive: true });
  const pth = fs.readdirSync(path.join(resources, "python")).find((name) => name.endsWith("._pth"));
  if (!pth) throw new Error("The embedded Python has no path file.");
  fs.writeFileSync(path.join(resources, "python", pth), "python312.zip\n.\nLib\\site-packages\nimport site\n");
  const wheels = path.join(cache, "wheels");
  fs.rmSync(wheels, { recursive: true, force: true });
  fs.mkdirSync(wheels, { recursive: true });
  run(pythonLauncher(), [
    "-m",
    "pip",
    "download",
    "--dest",
    wheels,
    "--platform",
    "win_amd64",
    "--python-version",
    "312",
    "--implementation",
    "cp",
    "--only-binary=:all:",
    "--requirement",
    path.join(host, "requirements.txt"),
  ]);
  for (const name of fs.readdirSync(wheels)) {
    if (name.endsWith(".whl")) extractZip(path.join(wheels, name), site);
  }
}

function stageApp() {
  if (!fs.existsSync(path.join(repo, "frontend", "node_modules"))) run("npm", ["ci"], path.join(repo, "frontend"));
  run("npm", ["run", "build"], path.join(repo, "frontend"));
  fs.rmSync(path.join(resources, "backend"), { recursive: true, force: true });
  fs.rmSync(path.join(resources, "frontend"), { recursive: true, force: true });
  copyTree(path.join(repo, "backend", "app"), path.join(resources, "backend", "app"), (name) => name === "__pycache__" || name.endsWith(".pyc"));
  copyTree(path.join(repo, "frontend", "dist"), path.join(resources, "frontend"), () => false);
}

async function stageRedist() {
  await download("https://aka.ms/vs/17/release/vc_redist.x64.exe", path.join(resources, "redist", "vc_redist.x64.exe"));
}

async function main() {
  fs.mkdirSync(cache, { recursive: true });
  await stageMongo();
  await stagePython();
  stageApp();
  await stageRedist();
  console.log(`Staged the full installation in ${resources}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
