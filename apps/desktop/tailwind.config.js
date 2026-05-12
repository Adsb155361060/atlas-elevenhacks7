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
    },
  },
  plugins: [],
};
