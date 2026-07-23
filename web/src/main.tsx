import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './i18n'; // side-effect: initialize i18next
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
