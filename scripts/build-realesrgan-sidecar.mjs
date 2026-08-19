import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const lockFile = path.join(repositoryRoot, 'scripts', 'realesrgan-sidecar.lock.json');
const resourceDir = path.join(repositoryRoot, 'src-tauri', 'resources', 'realesrgan');
const modelDir = path.join(resourceDir, 'models');
const licensesDir = path.join(resourceDir, 'LICENSES');
const binariesDir = path.join(repositoryRoot, 'src-tauri', 'binaries');
const cliArgs = process.argv.slice(2);
const lockText = fs.readFileSync(lockFile, 'utf8');
const lock = JSON.parse(lockText);
const lockSha256 = sha256(lockText);
const buildScriptSha256 = sha256(fs.readFileSync(fileURLToPath(import.meta.url)));
const force = cliArgs.includes('--force');
const cacheDir = resolveCacheDir();

if (cliArgs.includes('--help') || cliArgs.includes('-h')) {
  process.stdout.write([
    'Usage: node scripts/build-realesrgan-sidecar.mjs [--target <tauri-target-triple>] [--force]',
    '',
    'Supported targets: x86_64-pc-windows-msvc, aarch64-apple-darwin, x86_64-apple-darwin, universal-apple-darwin.',
    'Windows requires VULKAN_SDK. macOS also requires LUMINA_MOLTENVK_STATIC_LIBRARY.',
    'The pinned sources and model checksums are in scripts/realesrgan-sidecar.lock.json.',
    '',
  ].join('\n'));
  process.exit(0);
}

const target = readTarget(cliArgs) ?? resolveHostTarget();

try {
  await main();
} catch (error) {
  process.stderr.write(`Real-ESRGAN sidecar build failed: ${error.message}\n`);
  process.exitCode = 1;
}

async function main() {
  assertSupportedTarget(target);
  verifyStaticManifest();

  const outputs = resolveOutputs(target);
  if (!force && canReuse(outputs)) {
    await ensureModelResources();
    process.stdout.write(`Real-ESRGAN sidecar is current: ${outputs.primary}\n`);
    return;
  }

  const toolchain = resolveToolchain(target);
  ensureBuildCommands(target);
  await ensureModelResources();
  const sourceDir = await prepareEngineSource();
  const buildMetadata = target === 'universal-apple-darwin'
    ? buildUniversalMacSidecar(sourceDir, toolchain, outputs)
    : buildSingleTargetSidecar(sourceDir, toolchain, target, outputs.primary);

  copySourceNotices(sourceDir);
  writeBuildMetadata(outputs, buildMetadata);
  process.stdout.write(`Real-ESRGAN sidecar built: ${outputs.primary}\n`);
}

function assertSupportedTarget(targetTriple) {
  if (![
    'x86_64-pc-windows-msvc',
    'aarch64-apple-darwin',
    'x86_64-apple-darwin',
    'universal-apple-darwin',
  ].includes(targetTriple)) {
    throw new Error(
      `Real-ESRGAN V1 supports Windows x64 and macOS only; received target ${targetTriple}.`,
    );
  }
  if (targetTriple.includes('windows') && process.platform !== 'win32') {
    throw new Error('The Windows Real-ESRGAN sidecar must be built on Windows.');
  }
  if (targetTriple.includes('apple') && process.platform !== 'darwin') {
    throw new Error('The macOS Real-ESRGAN sidecar must be built on macOS.');
  }
}

function verifyStaticManifest() {
  const manifestPath = path.join(resourceDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.sidecar?.name !== lock.sidecar.name || manifest.sidecar?.version !== lock.sidecar.version) {
    throw new Error(`Resource manifest sidecar identity does not match ${lockFile}.`);
  }
  if (manifest.engine?.tag !== lock.engineSource.tag
    || manifest.engine?.commitPrefix !== lock.engineSource.commitPrefix
    || manifest.engine?.sourceArchiveSha256 !== lock.engineSource.archiveSha256
    || manifest.engine?.ncnn?.commit !== lock.submodules.ncnn.commit
    || manifest.engine?.libwebp?.commit !== lock.submodules.libwebp.commit
    || manifest.engine?.moltenVk?.vulkanSdkVersion !== lock.toolchains.macos.vulkanSdkVersion
    || manifest.engine?.moltenVk?.vulkanSdkArtifact !== lock.toolchains.macos.vulkanSdkArtifact
    || manifest.engine?.moltenVk?.vulkanSdkUrl !== lock.toolchains.macos.vulkanSdkUrl
    || manifest.engine?.moltenVk?.vulkanSdkSha256 !== lock.toolchains.macos.vulkanSdkSha256) {
    throw new Error(`Resource manifest engine provenance does not match ${lockFile}.`);
  }
  if (manifest.model?.name !== lock.model.name
    || manifest.model?.sourceRelease !== lock.model.source.release
    || manifest.model?.sourceUrl !== lock.model.source.archiveUrl
    || manifest.model?.sourceArchiveSha256 !== lock.model.source.archiveSha256) {
    throw new Error(`Resource manifest model provenance does not match ${lockFile}.`);
  }
  for (const expected of lock.model.files) {
    const actual = manifest.model.files?.find((entry) => entry.name === expected.name);
    if (!actual || actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) {
      throw new Error(`Resource manifest does not match the locked model file ${expected.name}.`);
    }
  }
}

async function ensureModelResources() {
  fs.mkdirSync(modelDir, { recursive: true });
  if (lock.model.files.every((model) => hasExpectedFile(path.join(modelDir, model.name), model))) {
    return;
  }

  ensureCommand('tar', ['--version']);
  const downloadsDir = path.join(cacheDir, 'downloads');
  const modelArchive = path.join(downloadsDir, 'Real-ESRGAN-v0.2.5.0-models.tar.xz');
  await downloadAndVerify(
    lock.model.source.archiveUrl,
    modelArchive,
    lock.model.source.archiveSha256,
    'Real-ESRGAN model archive',
  );

  const extractionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-realesrgan-models-'));
  try {
    extractArchive(modelArchive, extractionDir);
    for (const model of lock.model.files) {
      const extractedFile = findNamedFile(extractionDir, model.name);
      if (!extractedFile) {
        throw new Error(`Locked model file ${model.name} is absent from ${modelArchive}.`);
      }
      assertExpectedFile(extractedFile, model);
      fs.copyFileSync(extractedFile, path.join(modelDir, model.name));
      assertExpectedFile(path.join(modelDir, model.name), model);
    }
  } finally {
    fs.rmSync(extractionDir, { recursive: true, force: true });
  }
}

function resolveOutputs(targetTriple) {
  if (targetTriple === 'universal-apple-darwin') {
    const primary = path.join(binariesDir, `${lock.sidecar.name}-universal-apple-darwin`);
    return {
      primary,
      files: [
        primary,
        path.join(binariesDir, `${lock.sidecar.name}-aarch64-apple-darwin`),
        path.join(binariesDir, `${lock.sidecar.name}-x86_64-apple-darwin`),
      ],
    };
  }

  const extension = targetTriple.includes('windows') ? '.exe' : '';
  const primary = path.join(binariesDir, `${lock.sidecar.name}-${targetTriple}${extension}`);
  return { primary, files: [primary] };
}

function canReuse(outputs) {
  const metadataPath = `${outputs.primary}.build.json`;
  if (!outputs.files.every((file) => isRegularFile(file)) || !isRegularFile(metadataPath)) {
    return false;
  }
  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    return metadata.lockSha256 === lockSha256
      && metadata.buildScriptSha256 === buildScriptSha256
      && metadata.sidecar?.sha256 === sha256File(outputs.primary);
  } catch {
    return false;
  }
}

function resolveToolchain(targetTriple) {
  const configuredSdk = process.env.VULKAN_SDK?.trim();
  if (!configuredSdk) {
    throw new Error(
      'VULKAN_SDK is required to build the Real-ESRGAN sidecar. Set it to the extracted SDK root on Windows or the macOS SDK directory on macOS.',
    );
  }

  const sdk = path.resolve(configuredSdk);
  const header = firstExistingPath([
    path.join(sdk, 'Include', 'vulkan', 'vulkan.h'),
    path.join(sdk, 'include', 'vulkan', 'vulkan.h'),
  ]);
  if (!header) {
    throw new Error(`VULKAN_SDK does not contain vulkan/vulkan.h: ${sdk}`);
  }

  const glslangValidator = firstExistingPath(targetTriple.includes('windows')
    ? [
      path.join(sdk, 'Bin', 'glslangValidator.exe'),
      path.join(sdk, 'bin', 'glslangValidator.exe'),
    ]
    : [
      path.join(sdk, 'bin', 'glslangValidator'),
      path.join(sdk, 'Bin', 'glslangValidator'),
    ]);
  if (!glslangValidator) {
    throw new Error(`VULKAN_SDK does not contain glslangValidator: ${sdk}`);
  }

  if (!targetTriple.includes('apple')) {
    return { sdk, header, glslangValidator };
  }

  const staticMoltenVk = firstExistingPath([
    process.env.LUMINA_MOLTENVK_STATIC_LIBRARY?.trim(),
    path.join(sdk, '..', 'MoltenVK', 'MoltenVK.xcframework', 'macos-arm64_x86_64', 'libMoltenVK.a'),
  ].filter(Boolean));
  if (!staticMoltenVk) {
    throw new Error(
      'LUMINA_MOLTENVK_STATIC_LIBRARY is required for macOS and must point to libMoltenVK.a from the locked Vulkan SDK.',
    );
  }
  return { sdk, header, glslangValidator, staticMoltenVk };
}

function ensureBuildCommands(targetTriple) {
  ensureCommand('cmake', ['--version']);
  ensureCommand('git', ['--version']);
  ensureCommand('tar', ['--version']);
  if (targetTriple === 'universal-apple-darwin') {
    ensureCommand('lipo', ['-version']);
  }
}

async function prepareEngineSource() {
  const sourceRoot = path.join(cacheDir, `engine-${lockSha256}`);
  const markerPath = path.join(sourceRoot, '.lumina-engine-source.json');
  if (isRegularFile(markerPath)
    && isRegularFile(path.join(sourceRoot, 'src', 'CMakeLists.txt'))
    && isRegularFile(path.join(sourceRoot, 'src', 'ncnn', 'CMakeLists.txt'))
    && isRegularFile(path.join(sourceRoot, 'src', 'ncnn', 'glslang', 'CMakeLists.txt'))
    && isRegularFile(path.join(sourceRoot, 'src', 'libwebp', 'CMakeLists.txt'))) {
    try {
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (marker.lockSha256 === lockSha256) {
        return sourceRoot;
      }
    } catch {
      // Recreate an incomplete or old cache entry below.
    }
  }

  const downloadsDir = path.join(cacheDir, 'downloads');
  const sourceArchive = path.join(downloadsDir, 'Real-ESRGAN-ncnn-vulkan-v0.2.0.tar.gz');
  await downloadAndVerify(
    lock.engineSource.archiveUrl,
    sourceArchive,
    lock.engineSource.archiveSha256,
    'Real-ESRGAN ncnn Vulkan source archive',
  );

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-realesrgan-source-'));
  try {
    const archiveDir = path.join(stagingDir, 'archive');
    extractArchive(sourceArchive, archiveDir);
    const extractedSource = findDirectoryContaining(archiveDir, path.join('src', 'CMakeLists.txt'));
    if (!extractedSource) {
      throw new Error(`Could not locate src/CMakeLists.txt in ${sourceArchive}.`);
    }

    const checkoutDir = path.join(stagingDir, 'submodule-checkout');
    run('git', ['clone', '--no-checkout', lock.engineSource.repository, checkoutDir]);
    run('git', ['-C', checkoutDir, 'checkout', '--detach', lock.engineSource.tag]);
    const commit = runOutput('git', ['-C', checkoutDir, 'rev-parse', 'HEAD']);
    if (!commit.startsWith(lock.engineSource.commitPrefix)) {
      throw new Error(`Unexpected Real-ESRGAN source commit ${commit}; expected ${lock.engineSource.commitPrefix}.`);
    }
    run('git', ['-C', checkoutDir, 'config', 'submodule.src/ncnn.url', lock.submodules.ncnn.repository]);
    run('git', ['-C', checkoutDir, 'config', 'submodule.src/libwebp.url', lock.submodules.libwebp.repository]);
    run('git', ['-C', checkoutDir, 'submodule', 'update', '--init', '--recursive']);

    const resolvedSubmodules = resolveSubmoduleCommits(checkoutDir);
    for (const [name, value] of Object.entries(resolvedSubmodules)) {
      if (value !== lock.submodules[name].commit) {
        throw new Error(
          `Unexpected ${name} submodule commit ${value}; expected ${lock.submodules[name].commit}.`,
        );
      }
    }

    fs.rmSync(path.join(extractedSource, 'src', 'ncnn'), { recursive: true, force: true });
    fs.rmSync(path.join(extractedSource, 'src', 'libwebp'), { recursive: true, force: true });
    fs.cpSync(path.join(checkoutDir, 'src', 'ncnn'), path.join(extractedSource, 'src', 'ncnn'), { recursive: true });
    fs.cpSync(path.join(checkoutDir, 'src', 'libwebp'), path.join(extractedSource, 'src', 'libwebp'), { recursive: true });
    writeJson(path.join(extractedSource, '.lumina-engine-source.json'), {
      lockSha256,
      engineCommit: commit,
      submodules: resolvedSubmodules,
    });

    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(sourceRoot), { recursive: true });
    fs.renameSync(extractedSource, sourceRoot);
    return sourceRoot;
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

function resolveSubmoduleCommits(checkoutDir) {
  return {
    ncnn: runOutput('git', ['-C', path.join(checkoutDir, 'src', 'ncnn'), 'rev-parse', 'HEAD']),
    libwebp: runOutput('git', ['-C', path.join(checkoutDir, 'src', 'libwebp'), 'rev-parse', 'HEAD']),
  };
}

function buildSingleTargetSidecar(sourceDir, toolchain, targetTriple, destination) {
  const built = compileTarget(sourceDir, toolchain, targetTriple, destination);
  return {
    engineCommit: built.engineCommit,
    submodules: built.submodules,
    target: targetTriple,
  };
}

function buildUniversalMacSidecar(sourceDir, toolchain, outputs) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-realesrgan-universal-'));
  try {
    const arm64Path = path.join(tempDir, 'realesrgan-ncnn-vulkan-arm64');
    const x64Path = path.join(tempDir, 'realesrgan-ncnn-vulkan-x86_64');
    const arm64 = compileTarget(sourceDir, toolchain, 'aarch64-apple-darwin', arm64Path);
    const x64 = compileTarget(sourceDir, toolchain, 'x86_64-apple-darwin', x64Path);
    fs.mkdirSync(path.dirname(outputs.primary), { recursive: true });
    run('lipo', ['-create', arm64Path, x64Path, '-output', outputs.primary]);
    run('lipo', ['-verify_arch', 'arm64', 'x86_64', outputs.primary]);
    fs.chmodSync(outputs.primary, 0o755);
    for (const destination of outputs.files.slice(1)) {
      fs.copyFileSync(outputs.primary, destination);
      fs.chmodSync(destination, 0o755);
    }
    return {
      engineCommit: arm64.engineCommit,
      submodules: arm64.submodules,
      target: 'universal-apple-darwin',
      architectures: ['arm64', 'x86_64'],
      staticMoltenVk: true,
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function compileTarget(sourceDir, toolchain, targetTriple, destination) {
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), `lumina-realesrgan-${targetTriple}-`));
  const sourceCmakeDir = path.join(sourceDir, 'src');
  const engineMarker = JSON.parse(fs.readFileSync(path.join(sourceDir, '.lumina-engine-source.json'), 'utf8'));
  const environment = { ...process.env, VULKAN_SDK: toolchain.sdk };
  try {
    const configureArgs = ['-S', sourceCmakeDir, '-B', buildDir, '-DCMAKE_BUILD_TYPE=Release'];
    if (targetTriple.includes('windows')) {
      configureArgs.push('-A', 'x64');
    } else {
      const architecture = targetTriple.startsWith('aarch64') ? 'arm64' : 'x86_64';
      configureArgs.push(
        `-DCMAKE_OSX_ARCHITECTURES=${architecture}`,
        '-DUSE_STATIC_MOLTENVK=ON',
        '-DCMAKE_DISABLE_FIND_PACKAGE_OpenMP=TRUE',
        `-DVulkan_INCLUDE_DIR=${path.dirname(path.dirname(toolchain.header))}`,
        `-DVulkan_LIBRARY=${toolchain.staticMoltenVk}`,
      );
    }
    run('cmake', configureArgs, { env: environment });

    const buildArgs = ['--build', buildDir, '--parallel'];
    if (targetTriple.includes('windows')) {
      buildArgs.push('--config', 'Release');
    }
    run('cmake', buildArgs, { env: environment });

    const binary = firstExistingPath(targetTriple.includes('windows')
      ? [path.join(buildDir, 'Release', `${lock.sidecar.name}.exe`)]
      : [path.join(buildDir, lock.sidecar.name)]);
    if (!binary) {
      throw new Error(`CMake completed without ${lock.sidecar.name} for ${targetTriple}.`);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(binary, destination);
    if (!targetTriple.includes('windows')) {
      fs.chmodSync(destination, 0o755);
    }
    return engineMarker;
  } finally {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
}

function copySourceNotices(sourceDir) {
  fs.mkdirSync(licensesDir, { recursive: true });
  copyRequiredNotice(
    [path.join(sourceDir, 'LICENSE')],
    path.join(licensesDir, 'Real-ESRGAN-ncnn-vulkan-MIT.txt'),
  );
  copyRequiredNotice(
    [
      path.join(sourceDir, 'src', 'ncnn', 'LICENSE.txt'),
      path.join(sourceDir, 'src', 'ncnn', 'LICENSE'),
      path.join(sourceDir, 'src', 'ncnn', 'COPYRIGHT.txt'),
    ],
    path.join(licensesDir, 'ncnn-BSD-3-Clause.txt'),
  );
  copyRequiredNotice(
    [
      path.join(sourceDir, 'src', 'ncnn', 'glslang', 'LICENSE.txt'),
      path.join(sourceDir, 'src', 'ncnn', 'glslang', 'LICENSE'),
    ],
    path.join(licensesDir, 'glslang-LICENSE.txt'),
  );
  copyRequiredNotice(
    [
      path.join(sourceDir, 'src', 'libwebp', 'COPYING'),
      path.join(sourceDir, 'src', 'libwebp', 'LICENSE'),
    ],
    path.join(licensesDir, 'libwebp-BSD-3-Clause.txt'),
  );
  writeFile(path.join(licensesDir, 'README.md'), [
    '# Generated Real-ESRGAN source notices',
    '',
    'These notices were copied from the source and submodules pinned by `scripts/realesrgan-sidecar.lock.json`.',
    'glslang is a transitive ncnn submodule, fixed by the ncnn Git commit recorded in the lock file.',
    'MoltenVK is statically linked on macOS; its Apache-2.0 notice and source URL are recorded in `../THIRD_PARTY_NOTICES.md`.',
    '',
  ].join('\n'));
}

function writeBuildMetadata(outputs, build) {
  const metadata = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    lockSha256,
    buildScriptSha256,
    target: build.target,
    architectures: build.architectures ?? null,
    staticMoltenVk: build.staticMoltenVk ?? false,
    engine: {
      name: lock.sidecar.name,
      version: lock.sidecar.version,
      sourceCommit: build.engineCommit,
      submodules: build.submodules,
    },
    model: {
      name: lock.model.name,
      files: lock.model.files,
    },
    sidecar: {
      file: path.basename(outputs.primary),
      sha256: sha256File(outputs.primary),
      bytes: fs.statSync(outputs.primary).size,
    },
  };
  writeJson(`${outputs.primary}.build.json`, metadata);
  writeJson(path.join(resourceDir, 'build-metadata.json'), metadata);
}

function copyRequiredNotice(candidates, destination) {
  const source = firstExistingPath(candidates);
  if (!source) {
    throw new Error(`Required third-party notice is missing: ${candidates.join(', ')}`);
  }
  fs.copyFileSync(source, destination);
}

async function downloadAndVerify(url, destination, expectedSha256, description) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (isRegularFile(destination) && sha256File(destination) === expectedSha256) {
    return;
  }

  const temporary = `${destination}.partial-${process.pid}`;
  fs.rmSync(temporary, { force: true });
  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`${description} download failed with HTTP ${response.status}: ${url}`);
    }
    fs.writeFileSync(temporary, Buffer.from(await response.arrayBuffer()));
    const actualSha256 = sha256File(temporary);
    if (actualSha256 !== expectedSha256) {
      throw new Error(
        `${description} SHA-256 mismatch. Expected ${expectedSha256}, received ${actualSha256}.`,
      );
    }
    fs.rmSync(destination, { force: true });
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function extractArchive(archive, destination) {
  fs.mkdirSync(destination, { recursive: true });
  run('tar', ['-xf', archive, '-C', destination]);
}

function assertExpectedFile(file, expected) {
  if (!hasExpectedFile(file, expected)) {
    const bytes = isRegularFile(file) ? fs.statSync(file).size : 'missing';
    const actualSha256 = isRegularFile(file) ? sha256File(file) : 'missing';
    throw new Error(
      `Model validation failed for ${expected.name}. Expected ${expected.bytes} bytes and ${expected.sha256}; received ${bytes} bytes and ${actualSha256}.`,
    );
  }
}

function hasExpectedFile(file, expected) {
  return isRegularFile(file)
    && fs.statSync(file).size === expected.bytes
    && sha256File(file) === expected.sha256;
}

function findDirectoryContaining(root, relativeFile) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = path.join(root, entry.name);
    if (isRegularFile(path.join(candidate, relativeFile))) {
      return candidate;
    }
  }
  return undefined;
}

function findNamedFile(root, fileName) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name === fileName) {
      return candidate;
    }
    if (entry.isDirectory()) {
      const nested = findNamedFile(candidate, fileName);
      if (nested) {
        return nested;
      }
    }
  }
  return undefined;
}

function firstExistingPath(candidates) {
  return candidates.find((candidate) => candidate && isRegularFile(candidate));
}

function isRegularFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function resolveCacheDir() {
  const configured = process.env.LUMINA_REALESRGAN_CACHE_DIR?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(os.tmpdir(), 'lumina-realesrgan-sidecar');
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
  throw new Error(`Unsupported Real-ESRGAN build host: ${process.platform}/${process.arch}`);
}

function readTarget(args) {
  const equalsArgument = args.find((value) => value.startsWith('--target='));
  if (equalsArgument) {
    return equalsArgument.slice('--target='.length).trim() || undefined;
  }
  const index = args.indexOf('--target');
  return index >= 0 ? args[index + 1]?.trim() || undefined : undefined;
}

function ensureCommand(command, args) {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  if (result.error || result.status !== 0) {
    throw new Error(`Required build command is unavailable: ${command} ${args.join(' ')}`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: options.capture ? 'utf8' : undefined,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const details = options.capture ? `\n${result.stderr ?? ''}` : '';
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}.${details}`);
  }
  return result;
}

function runOutput(command, args, options = {}) {
  return run(command, args, { ...options, capture: true }).stdout.trim();
}

function writeJson(destination, value) {
  writeFile(destination, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(destination, contents) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.partial-${process.pid}`;
  fs.writeFileSync(temporary, contents);
  fs.rmSync(destination, { force: true });
  fs.renameSync(temporary, destination);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}
