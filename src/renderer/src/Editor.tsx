import { useState } from 'react';
import PostForm from './PostForm';
import WorkForm from './WorkForm';

export default function Editor({ login, onLogout }: { login: string; onLogout: () => void }) {
  const [tab, setTab] = useState<'post' | 'work'>('post');

  return (
    <div className="editor">
      <header className="topbar">
        <span className="brand">🐣 可愛編輯器</span>
        <nav className="tabs">
          <button className={tab === 'post' ? 'tab active' : 'tab'} onClick={() => setTab('post')}>
            ✏️ 寫文章
          </button>
          <button className={tab === 'work' ? 'tab active' : 'tab'} onClick={() => setTab('work')}>
            🎨 加作品
          </button>
        </nav>
        <span className="who">
          {login} ·{' '}
          <button className="link" onClick={onLogout}>
            登出
          </button>
        </span>
      </header>

      {tab === 'post' ? <PostForm /> : <WorkForm />}
    </div>
  );
}
