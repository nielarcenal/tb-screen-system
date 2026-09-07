/**
 * Entry point for midwife.html. Same <App> as the facility portal — only the
 * `portal` prop differs, which selects the sign-in wording and the page a
 * mismatched role is redirected to. See App's header.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './i18n'; // side-effect: initialize i18next
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App portal="midwife" />
  </StrictMode>,
);
