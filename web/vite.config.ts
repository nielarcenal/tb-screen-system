import { resolve } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        // One page per role. All three boot from src/, share the component
        // tree, and differ only in which shell they mount — see App's header.
        // Facility portal (TB-DOTS staff).
        main: resolve(__dirname, 'index.html'),
        // Midwife portal (BHW management for one barangay).
        midwife: resolve(__dirname, 'midwife.html'),
        // Developer portal (admin provisioning).
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
});
