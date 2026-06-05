import { useEffect, useState } from 'react';
import Login from './Login';
import Editor from './Editor';

type Auth = { loading: boolean; login?: string };

export default function App() {
  const [auth, setAuth] = useState<Auth>({ loading: true });

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
