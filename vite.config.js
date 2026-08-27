// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/你的-REPO-名稱/',   // ← 改這裡，例如 '/img-tools/'
})
