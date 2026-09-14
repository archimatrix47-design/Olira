/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  // Dark mode is driven by an explicit [data-theme="dark"] on <html> (set by the
  // no-flash script in BaseLayout), which also lets prefers-color-scheme win when
  // the visitor hasn't chosen. Admin pages force data-theme="light".
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // ----------------------------------------------------------------
        // Brand accent — TEAL, taken straight from the logo wordmark
        // (#186078). This is the single action colour: buttons, links, active
        // states, one focal graphic. Every stop is variable-backed so dark mode
        // can lift the mid/dark tones for on-dark legibility while the hue holds.
        // (Formerly a flat green ramp; the rebrand to the logo's teal happens
        // purely by swapping these values, so all existing primary-* classes
        // inherit the new identity.)
        // ----------------------------------------------------------------
        primary: {
          50:  'rgb(var(--p-50) / <alpha-value>)',
          100: 'rgb(var(--p-100) / <alpha-value>)',
          200: 'rgb(var(--p-200) / <alpha-value>)',
          300: 'rgb(var(--p-300) / <alpha-value>)',
          400: 'rgb(var(--p-400) / <alpha-value>)',
          500: 'rgb(var(--p-500) / <alpha-value>)',
          600: 'rgb(var(--p-600) / <alpha-value>)',
          700: 'rgb(var(--p-700) / <alpha-value>)',
          800: 'rgb(var(--p-800) / <alpha-value>)',
          900: 'rgb(var(--p-900) / <alpha-value>)',
        },

        // Olive — the leaf half of the logo (#607818). The ORGANIC note only:
        // atmospheric backgrounds, the contour motif, agricultural accents.
        // Never an action colour, so it never competes with teal.
        olive: {
          100: '#eaf0d6',
          200: '#d3e0ab',
          300: '#b3c876',
          400: '#8ba03f',
          500: '#6f8a2a',
          600: '#607818',
          700: '#4c5f16',
          800: '#3a4914',
        },

        // ----------------------------------------------------------------
        // Warm neutral system (ambient-ui). Text is warm charcoal, canvas is
        // paper — never pure white page / grey cards. All variable-backed so a
        // single [data-theme] swap flips the whole site.
        // ----------------------------------------------------------------
        canvas:      'rgb(var(--canvas) / <alpha-value>)',
        surface:     'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          2:       'rgb(var(--ink-2) / <alpha-value>)',
          3:       'rgb(var(--ink-3) / <alpha-value>)',
        },
        // Alpha borders — the alpha rides on the variable, so it reads correctly
        // on every surface and in both themes.
        line:          'rgb(var(--line) / var(--line-a))',
        'line-strong': 'rgb(var(--line) / calc(var(--line-a) * 1.8))',

        white: '#ffffff',
        black: '#000000',
        // Kept for data/neutral surfaces that must stay hue-free.
        gray: {
          50:  '#f9f9f9',
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
        heading: ['Lora', 'Georgia', 'Cambria', 'ui-serif', 'serif'],
      },
      // Type scale with line-heights that tighten and tracking that goes negative
      // as size grows (ambient-ui §3). 5xl/6xl were previously undefined, so
      // `text-5xl`/`text-6xl` silently fell back to Tailwind defaults and some
      // headings shrank at the lg breakpoint; the scale is now monotonic.
      fontSize: {
        xs:   ['12px', { lineHeight: '16px', letterSpacing: '0.01em' }],
        sm:   ['14px', { lineHeight: '20px' }],
        base: ['16px', { lineHeight: '26px' }],
        lg:   ['20px', { lineHeight: '30px' }],
        xl:   ['24px', { lineHeight: '32px' }],
        '2xl': ['32px', { lineHeight: '40px', letterSpacing: '-0.01em' }],
        // Display steps are FLUID (clamp): they scale with the viewport so large
        // multi-word headings never clip on a phone yet stay commanding on
        // desktop. min → max sizes noted in comments.
        '3xl': ['clamp(2rem, 1.4rem + 2.6vw, 2.75rem)',   { lineHeight: '1.1',  letterSpacing: '-0.015em' }], // 32→44
        '4xl': ['clamp(2.25rem, 1.4rem + 3.6vw, 3.5rem)', { lineHeight: '1.06', letterSpacing: '-0.018em' }], // 36→56
        '5xl': ['clamp(2.5rem, 1.5rem + 4.4vw, 4rem)',    { lineHeight: '1.04', letterSpacing: '-0.02em' }],  // 40→64
        '6xl': ['clamp(2.75rem, 1.5rem + 5.4vw, 4.75rem)',{ lineHeight: '1.02', letterSpacing: '-0.025em' }], // 44→76
        '7xl': ['clamp(3rem, 1.4rem + 6.9vw, 6rem)',      { lineHeight: '1.0',  letterSpacing: '-0.03em' }],  // 48→96
      },
      boxShadow: {
        // Elevation = a 1px ring carried IN the shadow + wide soft layers at tiny
        // alpha (ambient-ui §6). Never a hard drop shadow. In dark mode these
        // fade (dark-on-dark); depth is carried by surface-lightness steps.
        e1: '0 0 0 1px rgba(0,0,0,.06), 0 1px 2px -1px rgba(0,0,0,.05)',
        e2: '0 0 0 1px rgba(0,0,0,.06), 0 3px 3px -1.5px rgba(0,0,0,.06), 0 10px 20px 1px rgba(0,0,0,.04), 0 24px 24px -12px rgba(0,0,0,.04)',
        e3: '0 0 0 1px rgba(0,0,0,.06), 0 12px 32px 0 rgba(0,0,0,.02), 0 24px 48px -12px rgba(0,0,0,.08)',
      },
      transitionTimingFunction: {
        standard: 'cubic-bezier(.4,0,.2,1)',
        'out-soft': 'cubic-bezier(0,0,.2,1)',
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
        // Certification cards & feature badges. Teal + olive, drawn from the logo.
        'gradient-green':   'linear-gradient(135deg, rgb(var(--p-500)) 0%, rgb(var(--p-700)) 100%)',
        'gradient-dark':    'linear-gradient(135deg, rgb(var(--p-800)) 0%, rgb(var(--p-900)) 100%)',
        'gradient-teal':    'linear-gradient(135deg, rgb(var(--p-400)) 0%, rgb(var(--p-600)) 100%)',
        'gradient-organic': 'linear-gradient(135deg, #b3c876 0%, rgb(var(--p-500)) 55%, rgb(var(--p-700)) 100%)',
        'gradient-card':    'linear-gradient(135deg, rgb(var(--surface-2)) 0%, rgb(var(--surface)) 100%)',
      },
    },
  },
  plugins: [],
}
