// In-app auto-update. The editor is distributed as a zip the user unpacks;
// updates are published as GitHub Releases on the PUBLIC ch4art/art-editor repo
// (a release tag like v0.2.0 with the packaged zip attached).
//
// Flow: check latest release → if newer, the UI offers one-click update →
// download the zip → a tiny PowerShell helper waits for this app to quit, then
// overwrites the install folder in place and relaunches. No installer, no admin
// rights (as long as the app lives in a user-writable folder).
import { app } from 'electron';
import { spawn } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { createWriteStream, writeFileSync } from 'fs';
import { loadToken } from './github';

const RELEASES_API = 'https://api.github.com/repos/ch4art/art-editor/releases/latest';

export type UpdateInfo = { hasUpdate: boolean; version: string; current: string; url?: string };

/** "v0.2.0"/"0.2.0" → [0,2,0]; tolerant of extra labels. */
function parseVer(v: string): number[] {
  return v
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
}

function isNewer(remote: string, current: string): boolean {
  const a = parseVer(remote);
  const b = parseVer(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  // Use the login token if present — only to raise the API rate limit.
  const token = loadToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(RELEASES_API, { headers });
  if (!res.ok) throw new Error(`檢查更新失敗 (${res.status})`);
  const data = (await res.json()) as {
    tag_name?: string;
    assets?: { name: string; browser_download_url: string }[];
  };
  const version = (data.tag_name || '').replace(/^v/i, '');
  const zip = (data.assets || []).find((a) => /\.zip$/i.test(a.name));
  const hasUpdate = Boolean(version) && isNewer(version, current) && Boolean(zip);
  return { hasUpdate, version, current, url: zip?.browser_download_url };
}

/** The swap helper: waits for THIS process to exit, then overwrites the install
 *  folder in place (extract to temp → copy over, so a still-releasing file lock
 *  on the folder itself isn't fatal) and relaunches. Exported so tests exercise
 *  the exact same script that ships. Args: ProcId, Zip, Dir, Exe. */
export function helperScript(): string {
  return [
    'param([int]$ProcId,[string]$Zip,[string]$Dir,[string]$Exe)',
    'try { Wait-Process -Id $ProcId -Timeout 90 -ErrorAction SilentlyContinue } catch {}',
    'Start-Sleep -Seconds 1',
    'try {',
    '  Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '  $tmp = Join-Path $env:TEMP ("cueupd-" + [guid]::NewGuid().ToString())',
    '  [System.IO.Compression.ZipFile]::ExtractToDirectory($Zip, $tmp)',
    '  Copy-Item -Path (Join-Path $tmp "*") -Destination $Dir -Recurse -Force',
    '  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue',
    '} catch {}',
    'Remove-Item $Zip -Force -ErrorAction SilentlyContinue',
    'Start-Process -FilePath $Exe',
  ].join('\r\n');
}

/** Download the new zip then hand off to a helper that swaps + relaunches. */
export async function downloadAndApply(
  url: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  const zipPath = join(tmpdir(), `CuteEditor-update-${Date.now()}.zip`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`下載失敗 (${res.status})`);

  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  const file = createWriteStream(zipPath);
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  // Stream to disk so a 140MB download doesn't sit in memory.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    file.write(Buffer.from(value));
    received += value.length;
    if (total) onProgress(Math.min(100, Math.round((received / total) * 100)));
  }
  await new Promise<void>((resolve, reject) => {
    file.end((err?: Error | null) => (err ? reject(err) : resolve()));
  });

  // The packaged app root: the folder holding CuteEditor.exe.
  const exePath = app.getPath('exe');
  const appDir = join(exePath, '..');

  const helper = join(tmpdir(), `cuteeditor-update-${Date.now()}.ps1`);
  writeFileSync(helper, helperScript(), 'utf8');

  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Hidden',
      '-File',
      helper,
      String(process.pid),
      zipPath,
      appDir,
      exePath,
    ],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();

  // Give the helper a beat to start, then quit so it can swap the files.
  setTimeout(() => app.quit(), 400);
}
