import { useEffect, useState } from 'react';
import Login from './Login';
import Editor from './Editor';

type Auth = { loading: boolean; login?: string };

function useClickSparkles() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const COLORS = ['#FF9FCB', '#F2569E', '#9AD3FF', '#FFE27A', '#9B6DFF', '#5FE0DA'];
    const GLYPHS = ['✦', '✧', '●', '★'];
    const onDown = (e: PointerEvent) => {
      for (let i = 0; i < 12; i++) {
        const s = document.createElement('span');
        s.className = 'spark';
        s.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        s.style.color = COLORS[Math.floor(Math.random() * COLORS.length)];
        s.style.left = `${e.clientX}px`;
        s.style.top = `${e.clientY}px`;
        s.style.fontSize = `${12 + Math.random() * 10}px`;
        s.style.animationDuration = `${0.5 + Math.random() * 0.4}s`;
        const ang = Math.random() * Math.PI * 2;
        const dist = 30 + Math.random() * 55;
        s.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
        s.style.setProperty('--dy', `${Math.sin(ang) * dist}px`);
        s.addEventListener('animationend', () => s.remove());
        document.body.appendChild(s);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);
}

export default function App() {
  const [auth, setAuth] = useState<Auth>({ loading: true });
  useClickSparkles();

  useEffect(() => {
    window.api.github
      .status()
      .then((s) => setAuth({ loading: false, login: s.loggedIn ? s.login : undefined }));
  }, []);

  if (auth.loading) {
    return (
      <div className="wrap">
        <div className="card">
          <p>載入中…</p>
        </div>
      </div>
    );
  }

  if (!auth.login) {
    return <Login onLoggedIn={(login) => setAuth({ loading: false, login })} />;
  }

  return (
    <Editor
      login={auth.login}
      onLogout={async () => {
        await window.api.github.logout();
        setAuth({ loading: false, login: undefined });
      }}
    />
  );
}
