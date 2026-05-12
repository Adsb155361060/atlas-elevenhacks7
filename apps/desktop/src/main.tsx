import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { MiniMode } from './components/MiniMode';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('#root element missing from index.html');
}

// Two Tauri windows share the same bundle; the URL query string tells us
// which one we're in. The mini window has `?mode=mini` (see tauri.conf.json).
const mode = new URLSearchParams(window.location.search).get('mode');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    {mode === 'mini' ? <MiniMode /> : <App />}
  </React.StrictMode>,
);
