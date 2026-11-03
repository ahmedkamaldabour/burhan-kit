// The release rules, in one place, for release-guard, release-dist-tag, release-notes and github-release.
//   distTagFor(version)                -> 'latest' | 'next' | null
//   changelogSection(text, version)    -> the section body, '' when empty, null when there is no heading
//   releaseNotes(text, name, version)  -> { notes } or { problem }

const PLAIN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PRERELEASE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-(0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(\.(0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written YYYY-MM-DD: 2026-02-29 and 2026-13-99 have the shape of a date but are not one. */
function isDate(text) {
  if (!DATE.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/** The npm dist-tag of a package version: `latest` for X.Y.Z, `next` for X.Y.Z-<prerelease>, null for anything else
 *  (build metadata, a leading v, more or fewer than three numbers, leading zeros, an empty identifier, not a string). */
export function distTagFor(version) {
  if (typeof version !== 'string') return null;
  if (PLAIN.test(version)) return 'latest';
  if (PRERELEASE.test(version)) return 'next';
  return null;
}

/** The body of the CHANGELOG section of `version`: from the line that is exactly `## <version>` or
 *  `## <version> — YYYY-MM-DD` (a real calendar date) to the next `## ` line, without the heading, blank lines trimmed at both ends.
 *  '' when the section is empty; null when there is no such heading. */
export function changelogSection(text, version) {
  const lines = text.split(/\r?\n/);
  const heading = `## ${version}`;
  const start = lines.findIndex((line) => line === heading
    || (line.startsWith(`${heading} — `) && isDate(line.slice(heading.length + 3))));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  const body = rest.slice(0, end === -1 ? undefined : end);
  while (body.length > 0 && body[0].trim() === '') body.shift();
  while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();
  return body.join('\n');
}

/** The install line under the notes: a prerelease names its exact version for a new project too. */
function installLine(name, version) {
  if (distTagFor(version) === 'next') {
    return `Install or upgrade: \`npx ${name}@${version} upgrade --apply\` in a project that already has burhan, or \`npx ${name}@${version}\` for a new one. This is a prerelease on the npm dist-tag \`next\`: \`npx ${name}\` still installs the latest stable version.`;
  }
  return `Install or upgrade: \`npx ${name}@${version} upgrade --apply\` in a project that already has burhan, or \`npx ${name}\` for a new one.`;
}

/** The GitHub Release body of `version`: its CHANGELOG section, a blank line and the install line.
 *  { problem } instead when the section is missing or empty. */
export function releaseNotes(text, name, version) {
  const section = changelogSection(text, version);
  if (section === null) return { problem: `CHANGELOG.md has no section for ${version}` };
  if (section === '') return { problem: `the CHANGELOG.md section for ${version} is empty` };
  return { notes: `${section}\n\n${installLine(name, version)}\n` };
}
