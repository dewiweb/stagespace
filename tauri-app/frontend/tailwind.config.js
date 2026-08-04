/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        stagespace: {
          bg: '#0a0a0f',
          panel: '#12121a',
          border: '#1e1e2e',
          accent: '#3b82f6',
        },
      },
    },
  },
  plugins: [],
};
