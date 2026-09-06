/**
 * Nothing that dumps a device belongs in this repository.
 *
 * On 2026-09-01 a 7.4 MB Android bugreport was committed and pushed to a
 * public remote. A bugreport is a 38 MB transcript of everything the
 * phone was doing — the full logcat, every installed package, wifi state,
 * the system's own Google API keys — and it sat in the tree for five days
 * before anyone looked. This one came from an emulator and carried none
 * of the project's secrets, which was luck rather than design: the same
 * command run against a real handset would have published its owner's
 * accounts, networks and location history.
 *
 * `.gitignore` now refuses the shapes these arrive in. This test refuses
 * them a second time, because a `git add -f` and a stale checkout both
 * get past `.gitignore` and neither gets past a failing build.
 *
 * Deliberate exceptions are listed, named, and justified — not pattern
 * holes someone can widen by accident.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const REPO = path.join(__dirname, '..');

/**
 * Files that match a rule below and are meant to be here.
 *
 * `debug.keystore` is the well-known `androiddebugkey` shipped with the
 * Android SDK — CN=Android Debug, password `android`, the same bytes in
 * every project on earth. It is committed on purpose so every build of a
 * debug variant carries one signature.
 */
const ALLOWED = new Set(['android/app/debug.keystore']);

const FORBIDDEN: ReadonlyArray<{ why: string; test: RegExp }> = [
  {
    why: 'device dump (logcat, packages, wifi, system keys)',
    test: /(^|\/)(bugreport|dumpstate|anr_)[^/]*$/i,
  },
  { why: 'heap dump', test: /\.hprof$/i },
  {
    why: 'loose archive — how every device dump arrives',
    test: /\.(zip|tar|tgz|tar\.gz)$/i,
  },
  { why: 'signing key', test: /\.(jks|keystore|p12|pfx)$/i },
  // NOT `.pem`: that extension carries public certificates at least as
  // often as private keys, and this repo legitimately commits one (the
  // Habous intermediate CA, so the dataset importer can verify its
  // source). The next test reads the file rather than guessing from the
  // name, which is the only way to tell the two apart.
  { why: 'private key', test: /\.(key|p8)$/i },
  {
    why: 'build artifact (belongs on a GitHub release)',
    test: /\.(apk|aab|ipa)$/i,
  },
  { why: 'environment file', test: /(^|\/)\.env($|\.)/i },
  {
    why: 'real signing config (only the .example is committed)',
    test: /(^|\/)(keystore|local)\.properties$/i,
  },
];

function trackedFiles(): string[] | null {
  try {
    return execSync('git ls-files', { cwd: REPO, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    // No git (a source tarball, a sandboxed CI step). Nothing to check.
    return null;
  }
}

describe('repository hygiene', () => {
  const tracked = trackedFiles();

  it('tracks no device dump, key, archive or build artifact', () => {
    if (!tracked) return;
    const offenders: string[] = [];
    for (const file of tracked) {
      if (ALLOWED.has(file)) continue;
      for (const rule of FORBIDDEN) {
        if (rule.test.test(file)) offenders.push(`${file} — ${rule.why}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // A .pem is allowed through as a public certificate and nothing else.
  // The extension alone cannot tell the two apart, so read the file.
  it('holds no private key inside a committed certificate', () => {
    if (!tracked) return;
    const offenders = tracked
      .filter(f => /\.(pem|crt|cer)$/i.test(f))
      .filter(f => {
        const body = fs.readFileSync(path.join(REPO, f), 'utf8');
        return /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(body);
      });
    expect(offenders).toEqual([]);
  });

  it('keeps the .gitignore rules that stop these at the door', () => {
    const ignore = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
    for (const rule of [
      'bugreport*.zip',
      '*.hprof',
      '*.zip',
      '*.jks',
      '*.apk',
      '*.aab',
    ]) {
      expect(ignore).toContain(rule);
    }
  });

  it('names every exception, so none is a silent hole', () => {
    if (!tracked) return;
    for (const allowed of ALLOWED) {
      expect(tracked).toContain(allowed);
    }
  });
});
