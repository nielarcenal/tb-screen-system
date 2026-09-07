import { resolve } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        // Facility portal (TB-DOTS staff + midwives).
        main: resolve(__dirname, 'index.html'),
        // Developer portal (admin provisioning) — deliberately a separate page.
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
});
