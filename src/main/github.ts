import { app, safeStorage } from 'electron';
import { join } from 'path';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';

// GitHub OAuth App client_id (device flow). This is NOT a secret.
export const CLIENT_ID = 'Ov23livKXtwEV7WWxc8F';
const SCOPE = 'public_repo'; // write access to the public ch4art.github.io repo

// The repo the editor publishes to.
export const REPO = { owner: 'ch4art', repo: 'ch4art.github.io', branch: 'main' };

const tokenPath = (): string => join(app.getPath('userData'), 'gh-token.bin');

export function saveToken(token: string): void {
  const buf = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(token)
    : Buffer.from(token, 'utf8');
  writeFileSync(tokenPath(), buf);
}

export function loadToken(): string | null {
  const p = tokenPath();
  if (!existsSync(p)) return null;
  try {
    const buf = readFileSync(p);
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf8');
  } catch {
    return null;
  }
}

export function clearToken(): void {
  const p = tokenPath();
  if (existsSync(p)) unlinkSync(p);
}

export type DeviceCode = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

export async function requestDeviceCode(): Promise<DeviceCode> {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }),
  });
  if (!res.ok) throw new Error(`無法取得登入代碼 (${res.status})`);
  return (await res.json()) as DeviceCode;
}

export async function pollForToken(
  deviceCode: string,
  intervalSec: number,
  expiresIn: number,
): Promise<string> {
  const deadline = Date.now() + expiresIn * 1000;
  let interval = Math.max(intervalSec, 5);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const data = (await res.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (data.access_token) return data.access_token;
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') {
      interval += 5;
      continue;
    }
    throw new Error(data.error_description || data.error || '登入失敗');
  }
  throw new Error('登入逾時,請再試一次');
}

export async function whoami(token: string): Promise<string> {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error('登入已失效');
  const data = (await res.json()) as { login: string };
  return data.login;
}
