/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brass-and-Ink palette (mirrors the CSS variables in styles.css).
        // Tailwind utilities can reach these as `bg-ink`, `text-brass`, etc.
        ink: {
          DEFAULT: '#14110e',
          2: '#1a1612',
          3: '#221c17',
        },
        cream: {
          DEFAULT: '#f4efe6',
          dim: '#c8c0b2',
          mute: '#8a8377',
          faint: '#4a453e',
        },
        brass: {
          DEFAULT: '#c9a04f',
          deep: '#8b6b2a',
          glow: '#e8c77a',
        },
        sage: {
          DEFAULT: '#8fae9f',
          deep: '#5c7a6b',
        },
        signal: { red: '#b85841' },
        // Legacy keys still referenced in older components; resolved to the
        // brass-and-ink equivalents while we migrate.
        atlas: {
          listening: '#8fae9f',
          thinking: '#c9a04f',
          speaking: '#e8c77a',
          idle: '#4a453e',
        },
      },
      fontFamily: {
        serif: ['Fraunces', 'Iowan Old Style', 'Georgia', 'ui-serif', 'serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out both',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
