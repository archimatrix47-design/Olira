/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // Premium organic green palette.
        // Light tints (50–200) are now actual TINTS — near-white with a hint of green —
        // rather than saturated lime, so subtle backgrounds breathe instead of shouting.
        // Dark anchors (600, 800, 900) keep the existing brand identity.
        primary: {
          50:  '#f4f9ed',  // Near-white, faintest green hint (subtle backgrounds)
          100: '#e6f1d0',  // Very pale green (cards, hover states)
          200: '#c8dba3',  // Light sage (borders, dividers)
          300: '#a3c074',  // Sage
          400: '#76944c',  // Medium green
          500: '#547d46',  // Medium-dark
          600: '#39572f',  // Brand dark green (CTAs, primary)
          700: '#2c4424',  // Deeper
          800: '#21341a',  // Very dark
          900: '#0a1407',  // Near-black
        },
        // Teal and blue accents from logo palette
        teal: {
          light: '#7fa6b5',    // Light blue-gray
          accent: '#2c7a7b',   // Deep teal
          dark: '#1a5a5b',     // Dark teal
        },
        // Organic muted blues and grays
        organic: {
          'blue-light': '#7fa6b5',
          'blue-muted': '#5a8a99',
          'green-sage': '#a8c46e',
          'green-lime': '#c5e89b',
        },
        white: '#ffffff',
        black: '#000000',
        gray: {
          50: '#f9f9f9',
          100: '#f3f3f3',
          200: '#e5e5e5',
          300: '#d4d4d4',
          400: '#a3a3a3',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          900: '#171717',
        },
      },
      fontFamily: {
        sans: ['Sora', 'system-ui', '-apple-system', 'sans-serif'],
        heading: ['Lora', 'serif'],
      },
      fontSize: {
        xs: ['12px', '16px'],
        sm: ['14px', '20px'],
        base: ['16px', '24px'],
        lg: ['20px', '28px'],
        xl: ['24px', '32px'],
        '2xl': ['32px', '40px'],
        '3xl': ['48px', '56px'],
        '4xl': ['64px', '72px'],
      },
      animation: {
        fadeIn: 'fadeIn 0.8s ease-out',
        slideUp: 'slideUp 0.8s ease-out',
        slideInLeft: 'slideInLeft 0.8s ease-out',
        slideInRight: 'slideInRight 0.8s ease-out',
        scaleIn: 'scaleIn 0.6s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(30px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInLeft: {
          '0%': { opacity: '0', transform: 'translateX(-40px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(40px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      backgroundImage: {
        // Used on certification cards & feature badges. Keeps a richer green pop
        // (these need to stand out against white sections) while harmonizing with
        // the new lighter palette.
        'gradient-green': 'linear-gradient(135deg, #76944c 0%, #39572f 100%)',
        'gradient-dark':  'linear-gradient(135deg, #21341a 0%, #0a1407 100%)',
        'gradient-teal':  'linear-gradient(135deg, #4a9b9c 0%, #2c7a7b 100%)',
        'gradient-organic': 'linear-gradient(135deg, #c8dba3 0%, #4a9b9c 50%, #2c7a7b 100%)',
        'gradient-card': 'linear-gradient(135deg, #f4f9ed 0%, #ffffff 100%)',
      },
    },
  },
  plugins: [],
}
