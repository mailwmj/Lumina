import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const cliArgs = process.argv.slice(2);

if (cliArgs.includes('--help') || cliArgs.includes('-h')) {
  process.stdout.write([
    'Usage: node scripts/verify-realesrgan-sidecar.mjs [options]',
    '',
    '  --target <triple>                 Target used to infer the source-tree sidecar path.',
    '  --executable <path>               Verify a bundled or otherwise explicit sidecar.',
    '  --model-dir <path>                Directory containing the two locked model files.',
    '  --manifest <path>                 Bundled manifest.json path.',
    '  --build-metadata <path>           Generated build-metadata.json path.',
    '  --expect-universal                Require arm64 and x86_64 in the sidecar.',
    '  --expect-static-moltenvk          Reject a dynamic libMoltenVK dependency.',
    '',
  ].join('\n'));
  process.exit(0);
}

const lock = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'scripts', 'realesrgan-sidecar.lock.json'), 'utf8'));
const target = readTarget(cliArgs) ?? resolveHostTarget();
const executable = readOption(cliArgs, '--executable')
  ? path.resolve(readOption(cliArgs, '--executable'))
  : resolveSourceExecutable(target);
const modelDir = readOption(cliArgs, '--model-dir')
  ? path.resolve(readOption(cliArgs, '--model-dir'))
  : path.join(repositoryRoot, 'src-tauri', 'resources', 'realesrgan', 'models');
const manifestPath = readOption(cliArgs, '--manifest')
  ? path.resolve(readOption(cliArgs, '--manifest'))
  : path.join(repositoryRoot, 'src-tauri', 'resources', 'realesrgan', 'manifest.json');
const buildMetadataPath = readOption(cliArgs, '--build-metadata')
  ? path.resolve(readOption(cliArgs, '--build-metadata'))
  : path.join(repositoryRoot, 'src-tauri', 'resources', 'realesrgan', 'build-metadata.json');

try {
  assertRegularFile(executable, 'Real-ESRGAN sidecar');
  assertRegularFile(manifestPath, 'Real-ESRGAN resource manifest');
  verifyManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  for (const model of lock.model.files) {
    verifyModel(path.join(modelDir, model.name), model);
  }
  verifyBuildMetadata(buildMetadataPath, executable);
  verifyUsage(executable);

  if (cliArgs.includes('--expect-universal')) {
    verifyUniversalBinary(executable);
  }
  if (cliArgs.includes('--expect-static-moltenvk')) {
    verifyStaticMoltenVk(executable);
  }

  process.stdout.write(`Real-ESRGAN sidecar contract verified: ${executable}\n`);
} catch (error) {
  process.stderr.write(`Real-ESRGAN sidecar verification failed: ${error.message}\n`);
  process.exitCode = 1;
}

function verifyManifest(manifest) {
  if (manifest.sidecar?.name !== lock.sidecar.name || manifest.sidecar?.version !== lock.sidecar.version) {
    throw new Error('Bundled Real-ESRGAN manifest does not match the locked sidecar identity.');
  }
  if (manifest.engine?.tag !== lock.engineSource.tag
    || manifest.engine?.commit !== lock.engineSource.commit
    || manifest.engine?.sourceArchiveSha256 !== lock.engineSource.archiveSha256
    || manifest.engine?.ncnn?.commit !== lock.submodules.ncnn.commit
    || manifest.engine?.libwebp?.commit !== lock.submodules.libwebp.commit
    || manifest.engine?.moltenVk?.vulkanSdkVersion !== lock.toolchains.macos.vulkanSdkVersion
    || manifest.engine?.moltenVk?.vulkanSdkArtifact !== lock.toolchains.macos.vulkanSdkArtifact
    || manifest.engine?.moltenVk?.vulkanSdkUrl !== lock.toolchains.macos.vulkanSdkUrl
    || manifest.engine?.moltenVk?.vulkanSdkSha256 !== lock.toolchains.macos.vulkanSdkSha256) {
    throw new Error('Bundled Real-ESRGAN manifest does not match the locked engine provenance.');
  }
  if (manifest.model?.name !== lock.model.name
    || manifest.model?.sourceRelease !== lock.model.source.release
    || manifest.model?.sourceUrl !== lock.model.source.archiveUrl
    || manifest.model?.sourceArchiveSha256 !== lock.model.source.archiveSha256) {
    throw new Error('Bundled Real-ESRGAN manifest does not match the locked model provenance.');
  }
  for (const expected of lock.model.files) {
    const actual = manifest.model.files?.find((entry) => entry.name === expected.name);
    if (!actual || actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) {
      throw new Error(`Bundled manifest does not match locked model file ${expected.name}.`);
    }
  }
}

function verifyModel(file, expected) {
  assertRegularFile(file, `Locked model ${expected.name}`);
  const stat = fs.statSync(file);
  const actualSha256 = sha256File(file);
  if (stat.size !== expected.bytes || actualSha256 !== expected.sha256) {
    throw new Error(
      `Locked model ${expected.name} failed validation. Expected ${expected.bytes} bytes/${expected.sha256}; received ${stat.size} bytes/${actualSha256}.`,
    );
  }
}

function verifyBuildMetadata(file, sidecar) {
  assertRegularFile(file, 'Real-ESRGAN build metadata');
  const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (metadata.lockSha256 !== sha256(fs.readFileSync(path.join(repositoryRoot, 'scripts', 'realesrgan-sidecar.lock.json')))) {
    throw new Error('Real-ESRGAN build metadata was produced from a different lock file.');
  }
  const actualSidecarSha256 = sha256File(sidecar);
  if (metadata.sidecar?.sha256 !== actualSidecarSha256) {
    throw new Error(
      `Real-ESRGAN build metadata SHA-256 mismatch. Expected ${metadata.sidecar?.sha256}, received ${actualSidecarSha256}.`,
    );
  }
}

function verifyUsage(sidecar) {
  const result = spawnSync(sidecar, ['-h'], { encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (!output.includes('realesrgan-x4plus') || !output.includes('gpu-id')) {
    throw new Error(
      `Real-ESRGAN sidecar help output does not expose the expected locked CLI contract (exit ${result.status ?? 'unknown'}).`,
    );
  }
}

function verifyUniversalBinary(sidecar) {
  if (process.platform !== 'darwin') {
    throw new Error('--expect-universal can only be checked on macOS.');
  }
  run('lipo', [sidecar, '-verify_arch', 'arm64', 'x86_64']);
}

function verifyStaticMoltenVk(sidecar) {
  if (process.platform !== 'darwin') {
    throw new Error('--expect-static-moltenvk can only be checked on macOS.');
  }
  const linkedLibraries = runOutput('otool', ['-L', sidecar]);
  if (/libMoltenVK(?:\.dylib)?/i.test(linkedLibraries)) {
    throw new Error('Real-ESRGAN sidecar dynamically links MoltenVK; the macOS build must use libMoltenVK.a.');
  }
}

function resolveSourceExecutable(targetTriple) {
  const extension = targetTriple.includes('windows') ? '.exe' : '';
  return path.join(
    repositoryRoot,
    'src-tauri',
    'binaries',
    `${lock.sidecar.name}-${targetTriple}${extension}`,
  );
}

function assertRegularFile(file, label) {
  try {
    if (fs.statSync(file).isFile()) {
      return;
    }
  } catch {
    // Use the common error below.
  }
  throw new Error(`${label} does not exist: ${file}`);
}

function resolveHostTarget() {
  if (process.platform === 'win32' && process.arch === 'x64') {
    return 'x86_64-pc-windows-msvc';
  }
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return 'aarch64-apple-darwin';
  }
  if (process.platform === 'darwin' && process.arch === 'x64') {
    return 'x86_64-apple-darwin';
  }
  throw new Error(`Unsupported Real-ESRGAN verification host: ${process.platform}/${process.arch}`);
}

function readTarget(args) {
  const equalsArgument = args.find((value) => value.startsWith('--target='));
  if (equalsArgument) {
    return equalsArgument.slice('--target='.length).trim() || undefined;
  }
  const index = args.indexOf('--target');
  return index >= 0 ? args[index + 1]?.trim() || undefined : undefined;
}

function readOption(args, name) {
  const equalsArgument = args.find((value) => value.startsWith(`${name}=`));
  if (equalsArgument) {
    return equalsArgument.slice(name.length + 1).trim() || undefined;
  }
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1]?.trim() || undefined : undefined;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}: ${result.stderr ?? ''}`);
  }
  return result;
}

function runOutput(command, args) {
  return run(command, args).stdout.trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}
