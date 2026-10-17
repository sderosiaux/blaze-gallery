import type { Config } from 'tailwindcss'

// Same tokens as the app (src/app/globals.css there): the photos carry the color.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: token('paper'),
        sunken: token('sunken'),
        ink: {
          DEFAULT: token('ink'),
          soft: token('ink-soft'),
          muted: token('ink-muted'),
          faint: token('ink-faint'),
        },
        line: { DEFAULT: token('line'), strong: token('line-strong') },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        display: ['clamp(2.5rem, 5.4vw, 4.75rem)', { lineHeight: '1.02', letterSpacing: '-0.035em' }],
        h2: ['clamp(2rem, 3.6vw, 3rem)', { lineHeight: '1.08', letterSpacing: '-0.025em' }],
        lead: ['1.25rem', { lineHeight: '1.6' }],
      },
      maxWidth: { page: '77.5rem', prose: '38rem' },
      boxShadow: {
        frame: '0 1px 2px rgb(24 24 27 / 0.04), 0 12px 40px -12px rgb(24 24 27 / 0.18)',
      },
      transitionTimingFunction: { 'out-soft': 'cubic-bezier(0.22, 1, 0.36, 1)' },
    },
  },
  plugins: [],
}
export default config
