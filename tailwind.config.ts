import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          red: 'var(--c-red)',
          btn: 'var(--c-btn)',
          redtext: 'var(--c-redtext)',
          gold: 'var(--c-gold)',
          paper: 'var(--c-paper)',
          card: 'var(--c-card)',
          ink: 'var(--c-ink)',
          muted: 'var(--c-muted)',
          line: 'var(--c-line)'
        }
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        pop: '0 2px 0 0 rgba(26,21,18,0.9)'
      },
      borderRadius: {
        card: '10px'
      }
    }
  },
  plugins: []
} satisfies Config
