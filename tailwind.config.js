/** @type {import('tailwindcss').Config} */
const withOpacity = (variable) => `rgb(var(${variable}) / <alpha-value>)`;

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: withOpacity('--bg-rgb'),
          dark: withOpacity('--bg-rgb'),
        },
        surface: {
          DEFAULT: withOpacity('--surface-rgb'),
          dark: withOpacity('--surface-rgb'),
        },
        border: {
          DEFAULT: withOpacity('--border-rgb'),
          dark: withOpacity('--border-rgb'),
        },
        text: {
          DEFAULT: withOpacity('--text-rgb'),
          dark: withOpacity('--text-rgb'),
        },
        'text-muted': {
          DEFAULT: withOpacity('--text-muted-rgb'),
          dark: withOpacity('--text-muted-rgb'),
        },
        accent: withOpacity('--accent-rgb'),
        // shadcn-style tokens used by vendored beUI components, mapped onto Lumina's neutral palette.
        background: withOpacity('--surface-rgb'),
        foreground: withOpacity('--text-rgb'),
        card: withOpacity('--bg-rgb'),
        popover: withOpacity('--surface-rgb'),
        muted: {
          DEFAULT: withOpacity('--ui-muted-rgb'),
          foreground: withOpacity('--text-muted-rgb'),
        },
        primary: {
          DEFAULT: withOpacity('--text-rgb'),
          foreground: withOpacity('--surface-rgb'),
        },
        destructive: withOpacity('--danger-rgb'),
        ring: withOpacity('--text-muted-rgb'),
        input: withOpacity('--border-rgb'),
        danger: withOpacity('--danger-rgb'),
        warning: withOpacity('--warning-rgb'),
        success: withOpacity('--success-rgb'),
      },
      fontSize: {
        'node-xs': ['10px', '14px'],
        'node-sm': ['11px', '16px'],
      },
      transitionTimingFunction: {
        'ui-out': 'var(--ui-ease-out)',
      },
      fontFamily: {
        sans: ['Geist Variable', 'Noto Sans SC', 'PingFang SC', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono Variable', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      opacity: {
        14: '0.14',
        15: '0.15',
        16: '0.16',
        18: '0.18',
        35: '0.35',
        45: '0.45',
        55: '0.55',
        65: '0.65',
        85: '0.85',
      },
    },
  },
  plugins: [],
}
