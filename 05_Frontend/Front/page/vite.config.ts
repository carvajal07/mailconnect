import { defineConfig } from 'vitest/config'
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
  // Pruebas del constructor de correos (saneamiento + generación email-safe). Necesitan
  // DOM porque el sanitizador usa DOMParser, que es API del navegador.
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
