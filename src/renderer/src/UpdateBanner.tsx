import { useEffect, useState } from 'react';

// 一條可愛橫幅:啟動時偷偷檢查有沒有新版本,有的話讓使用者一鍵更新。
// 下載完會自動換檔重開,她什麼都不用做。
export default function UpdateBanner() {
  const [info, setInfo] = useState<{ version: string; url?: string } | null>(null);
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'error'>('idle');
  const [pct, setPct] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    window.api.update
      .check()
      .then((r) => {
        if (r.hasUpdate && r.url) setInfo({ version: r.version, url: r.url });
      })
      .catch(() => {
        /* 檢查失敗就當作沒有新版,不打擾 */
      });
  }, []);

  useEffect(() => {
    if (phase !== 'downloading') return;
    const off = window.api.update.onProgress(setPct);
    return off;
  }, [phase]);

  if (!info || dismissed) return null;

  async function update() {
    if (!info?.url) return;
    setPhase('downloading');
    setPct(0);
    try {
      await window.api.update.apply(info.url);
      // 成功的話程式會被換檔程式關掉重開,不會走到這裡
    } catch {
      setPhase('error');
    }
  }

  return (
    <div className="updatebar">
      {phase === 'downloading' ? (
        <span>
          <span className="spin-egg">🐣</span> 更新下載中… {pct}%(下載好會自動重開,等一下下~)
        </span>
      ) : phase === 'error' ? (
        <span>
          😢 更新失敗,等等再試,或請工程師幫忙。
          <button className="ub-btn" onClick={update}>
            再試一次
          </button>
        </span>
      ) : (
        <span>
          🎉 有新版本 v{info.version}!
          <button className="ub-btn" onClick={update}>
            ✨ 一鍵更新
          </button>
          <button className="ub-x" onClick={() => setDismissed(true)} title="這次先不要">
            ✕
          </button>
        </span>
      )}
    </div>
  );
}
