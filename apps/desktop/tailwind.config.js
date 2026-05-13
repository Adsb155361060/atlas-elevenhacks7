/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Atlas brand placeholder palette — refined when public name + brand land
        atlas: {
          listening: '#10b981',
          thinking: '#f59e0b',
          speaking: '#a855f7',
          idle: '#475569',
        },
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
