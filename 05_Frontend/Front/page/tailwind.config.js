/**
 * Tailwind SOLO para el editor pdfsketch (src/pdfsketch/**). El resto del
 * portal es MUI puro, por eso:
 *   - content acotado a la carpeta del editor (no genera clases para el portal)
 *   - preflight APAGADO (el reset global de Tailwind rompería los estilos MUI)
 * El theme es el del prototipo pdfsketch (tokens CSS var scopeados bajo .mc-sketch).
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/pdfsketch/**/*.{ts,tsx}'],
  darkMode: 'class',
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        bg: { 0: 'var(--bg-0)', 1: 'var(--bg-1)', 2: 'var(--bg-2)', 3: 'var(--bg-3)', 4: 'var(--bg-4)' },
        ink: { DEFAULT: 'var(--ink)', 2: 'var(--ink-2)', muted: 'var(--muted)' },
        line: { DEFAULT: 'var(--line)', 2: 'var(--line-2)', 3: 'var(--line-3)' },
        accent: { DEFAULT: 'var(--accent)', dim: 'var(--accent-dim)', soft: 'var(--accent-soft)' },
        sel: 'var(--sel)',
        canvas: 'var(--canvas)',
        paper: 'var(--paper)',
        danger: 'var(--danger)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: { 11: ['11px', '14px'], 12: ['12px', '16px'] },
      borderRadius: { 3: '3px', 5: '5px' },
      boxShadow: {
        panel: '0 10px 40px rgba(0,0,0,0.5)',
        paper: '0 2px 20px rgba(0,0,0,0.45), 0 0 0 1px rgba(0,0,0,0.4)',
      },
    },
  },
  plugins: [],
};
