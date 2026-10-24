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
  const leftPre = left.split('+')[0].split('-').slice(1).join('-');
  const rightPre = right.split('+')[0].split('-').slice(1).join('-');
  if (!leftPre || !rightPre) return Number(!leftPre) - Number(!rightPre);
  const leftIds = leftPre.split('.');
  const rightIds = rightPre.split('.');
  for (let index = 0; index < Math.max(leftIds.length, rightIds.length); index += 1) {
    const a = leftIds[index];
    const b = rightIds[index];
    if (a === b) continue;
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const numericA = /^\d+$/.test(a);
    const numericB = /^\d+$/.test(b);
    if (numericA && numericB) return Number(a) - Number(b);
    if (numericA !== numericB) return numericA ? -1 : 1;
    return a < b ? -1 : 1;
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

export function validateReleaseVersion(target, versions, packageVersion) {
  if (versions.includes(target)) {
    throw new Error(`Tag v${target} already exists (local or origin).`);
  }
  const baseline = selectReleaseBaseline(versions, packageVersion);
  if (compareVersions(target, baseline) <= 0) {
    throw new Error(`Target version ${target} must be newer than ${baseline}.`);
  }
}
