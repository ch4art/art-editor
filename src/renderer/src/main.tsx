import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/fredoka';
import '@fontsource-variable/nunito';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
