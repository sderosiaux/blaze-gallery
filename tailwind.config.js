/** @type {import('tailwindcss').Config} */

// Colors come only from the CSS variables in src/app/globals.css. The default
// Tailwind palette is replaced, not extended, so a stray `gray-500` generates
// nothing and is easy to find.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      paper: token('paper'),
      sidebar: token('sidebar'),
      surface: {
        DEFAULT: token('surface'),
        sunken: token('surface-sunken'),
      },
      ink: {
        DEFAULT: token('ink'),
        soft: token('ink-soft'),
        muted: token('ink-muted'),
        faint: token('ink-faint'),
      },
      line: {
        DEFAULT: token('line'),
        strong: token('line-strong'),
      },
      accent: {
        DEFAULT: token('accent'),
        strong: token('accent-strong'),
        soft: token('accent-soft'),
      },
      favorite: token('favorite'),
      success: { DEFAULT: token('success'), soft: token('success-soft') },
      warning: { DEFAULT: token('warning'), soft: token('warning-soft') },
      danger: { DEFAULT: token('danger'), soft: token('danger-soft') },
      info: { DEFAULT: token('info'), soft: token('info-soft') },
      scrim: token('scrim'),
      'on-photo': token('on-photo'),
      chart: {
        1: token('chart-1'),
        2: token('chart-2'),
        3: token('chart-3'),
        4: token('chart-4'),
        5: token('chart-5'),
        6: token('chart-6'),
      },
      hue: {
        red: token('hue-red'),
        orange: token('hue-orange'),
        yellow: token('hue-yellow'),
        green: token('hue-green'),
        teal: token('hue-teal'),
        blue: token('hue-blue'),
        purple: token('hue-purple'),
        pink: token('hue-pink'),
        brown: token('hue-brown'),
        black: token('hue-black'),
        grey: token('hue-grey'),
        white: token('hue-white'),
      },
    },
    extend: {
      fontFamily: {
        // One family: titles differ from body by weight and size, not by face.
        display: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'display-xl': ['clamp(2.75rem, 1.6rem + 4.2vw, 5rem)', { lineHeight: '1.02', letterSpacing: '-0.02em' }],
        'display-lg': ['clamp(2.25rem, 1.5rem + 2.8vw, 3.75rem)', { lineHeight: '1.05', letterSpacing: '-0.018em' }],
        'display-md': ['clamp(1.75rem, 1.35rem + 1.4vw, 2.5rem)', { lineHeight: '1.1', letterSpacing: '-0.012em' }],
        'display-sm': ['1.375rem', { lineHeight: '1.25', letterSpacing: '-0.006em' }],
        kicker: ['0.75rem', { lineHeight: '1rem', letterSpacing: '0.12em' }],
      },
      borderRadius: {
        DEFAULT: '6px',
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '16px',
      },
      boxShadow: {
        lift: '0 1px 2px rgb(var(--ink) / 0.04), 0 8px 24px -12px rgb(var(--ink) / 0.18)',
        pop: '0 12px 40px -12px rgb(var(--ink) / 0.28), 0 2px 6px rgb(var(--ink) / 0.06)',
      },
      transitionTimingFunction: {
        'out-soft': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      zIndex: {
        topbar: '20',
        sidebar: '30',
        overlay: '40',
        dialog: '70',
        viewer: '60',
        toast: '80',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          from: { backgroundPosition: '-200% 0' },
          to: { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'rise-in': 'rise-in 320ms cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
