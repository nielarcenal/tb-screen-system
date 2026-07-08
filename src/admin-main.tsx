import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './i18n'; // side-effect: initialize i18next
import './index.css';
import AdminApp from './AdminApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);
