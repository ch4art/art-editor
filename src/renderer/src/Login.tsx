import { useState } from 'react';

type LoginCode = { user_code: string; verification_uri: string };

export default function Login({ onLoggedIn }: { onLoggedIn: (login: string) => void }) {
  const [code, setCode] = useState<LoginCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login() {
    setError(null);
    setBusy(true);
    setCode(null);
    const off = window.api.github.onCode((c) => setCode(c));
    try {
      const res = await window.api.github.login();
      onLoggedIn(res.login);
    } catch (e) {
      setError(e instanceof Error ? e.message : '登入失敗');
    } finally {
      setBusy(false);
      off();
    }
  }

  return (
    <div className="wrap">
      <div className="card">
        <h1>🐣 可愛網站編輯器</h1>
        {!code ? (
          <>
            <p>先用 GitHub 登入一次,之後就能一鍵發布到你的網站。</p>
            <button className="btn" onClick={login} disabled={busy}>
              {busy ? '處理中…' : '用 GitHub 登入'}
            </button>
          </>
        ) : (
          <div className="codebox">
            <p>已經幫你開啟瀏覽器了!請在 GitHub 頁面輸入這組代碼並按授權:</p>
            <div className="code">{code.user_code}</div>
            <p className="hint">如果瀏覽器沒開,請手動前往:{code.verification_uri}</p>
            <p className="waiting">⏳ 授權完成後這裡會自動進入…</p>
          </div>
        )}
        {error && <p className="error">⚠️ {error}</p>}
      </div>
    </div>
  );
}
