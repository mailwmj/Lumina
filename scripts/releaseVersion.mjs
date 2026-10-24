const STABLE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const VERSION_CORE_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

function parseVersionCore(version) {
  const match = VERSION_CORE_PATTERN.exec(version);
  if (!match) {
    throw new Error(`Invalid version: ${version}`);
  }
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  const leftParts = parseVersionCore(left);
  const rightParts = parseVersionCore(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

export function selectReleaseBaseline(versions, packageVersion) {
  const stableVersions = versions.filter((version) => STABLE_VERSION_PATTERN.test(version));
  return stableVersions.reduce(
    (baseline, version) => (compareVersions(version, baseline) > 0 ? version : baseline),
    packageVersion,
  );
}
