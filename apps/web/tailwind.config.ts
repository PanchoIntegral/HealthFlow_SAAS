import type { Config } from 'tailwindcss';

/** Paleta de marca de los mockups: azul confianza → teal enlace → verde salud. */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          blue: '#2563EB',
          teal: '#0BA5B5',
          green: '#10B981',
        },
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
