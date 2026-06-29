/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        panel: '#1b1f27',
        panel2: '#232834',
        ink: '#e7ebf2',
        accent: '#3b9dff',
      },
    },
  },
  plugins: [],
};
