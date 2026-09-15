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
          redsoft: 'var(--c-red-soft)',
          gold: 'var(--c-gold)',
          goldsoft: 'var(--c-gold-soft)',
          paper: 'var(--c-paper)',
          card: 'var(--c-card)',
          ink: 'var(--c-ink)',
          muted: 'var(--c-muted)',
          line: 'var(--c-line)',
          linestrong: 'var(--c-line-strong)'
        }
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      borderRadius: {
        card: '16px', // permukaan data (kartu, modal, frame)
        ctl: '12px' // kontrol: tombol, input, icon-btn
      },
      boxShadow: {
        soft: '0 1px 2px rgba(32,26,22,.05), 0 4px 12px rgba(32,26,22,.06)',
        lift: '0 2px 4px rgba(32,26,22,.06), 0 10px 24px rgba(32,26,22,.10)'
      }
    }
  },
  plugins: []
} satisfies Config
