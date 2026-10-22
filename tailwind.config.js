/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        stage: { 950: '#07110d', 900: '#0b1a14', 800: '#10251c', 700: '#173327', 600: '#21473a' },
        brass: { 300: '#f3d58b', 400: '#e8bd5a', 500: '#d6a23a' },
      },
      fontFamily: {
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
