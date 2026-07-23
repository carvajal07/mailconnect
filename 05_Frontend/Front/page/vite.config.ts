import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // El editor pdfsketch (src/pdfsketch) se copió del prototipo, que usa el
      // alias '@' para sus imports internos. El resto del front NO usa '@'.
      '@': path.resolve(__dirname, './src/pdfsketch'),
    },
  },
})
