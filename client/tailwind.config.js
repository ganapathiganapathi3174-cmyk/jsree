/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Semantic surfaces — driven by CSS variables (light on :root, dark on .dark)
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          muted: 'rgb(var(--ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--ink-faint) / <alpha-value>)',
        },
        // Brand — royal purple actions (secondary #7B1E7A), navy-dark end
        primary: {
          50: '#F9F4FA',
          100: '#F2E6F4',
          200: '#E7CDEA',
          300: '#D6A7DB',
          400: '#BE74C3',
          500: '#9F44A4',
          600: '#7B1E7A',
          700: '#651764',
          800: '#4A1455',
          900: '#2A1040',
          950: '#0C0A3E',
          DEFAULT: '#7B1E7A',
        },
        accent: {
          400: '#C77DCC',
          500: '#9F44A4',
          600: '#7B1E7A',
          DEFAULT: '#7B1E7A',
        },
        success: {
          50: '#F0FDF4',
          100: '#DCFCE7',
          200: '#BBF7D0',
          400: '#4ADE80',
          500: '#22C55E',
          600: '#16A34A',
          700: '#15803D',
          DEFAULT: '#16A34A',
        },
        warning: {
          50: '#FFFBEB',
          100: '#FEF3C7',
          200: '#FDE68A',
          400: '#FBBF24',
          500: '#F59E0B',
          600: '#D97706',
          700: '#B45309',
          DEFAULT: '#D97706',
        },
        error: {
          50: '#FEF2F2',
          100: '#FEE2E2',
          200: '#FECACA',
          400: '#F87171',
          500: '#EF4444',
          600: '#DC2626',
          700: '#B91C1C',
          DEFAULT: '#DC2626',
        },
        info: {
          50: '#F0F9FF',
          100: '#E0F2FE',
          200: '#BAE6FD',
          400: '#38BDF8',
          500: '#0EA5E9',
          600: '#0284C7',
          700: '#0369A1',
          DEFAULT: '#0284C7',
        },
        // Legacy token kept for components not yet migrated
        night: {
          DEFAULT: '#0C0A3E',
          800: '#181238',
          700: '#231B4A',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
        elevation: 'var(--shadow-elevation)',
        glow: '0 0 0 1px rgba(123, 30, 122, 0.30), 0 8px 24px -8px rgba(123, 30, 122, 0.38)',
        'glow-sm': '0 0 0 1px rgba(123, 30, 122, 0.18), 0 4px 14px -6px rgba(123, 30, 122, 0.28)',
      },
      borderRadius: {
        card: '1rem',
      },
      maxWidth: {
        shell: '80rem',
      },
    },
  },
  plugins: [],
}
