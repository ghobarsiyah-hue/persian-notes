import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        // Persian app: Sahel stays first for full RTL/Persian coverage.
        // Geist Sans/Mono is appended for Latin/code glyphs where supported.
        sans: ['Sahel', 'Geist', 'Tahoma', 'Segoe UI', 'sans-serif'],
        mono: ['Sahel', 'Geist Mono', 'Consolas', 'monospace'],
      },
      colors: {
        // Near-monochrome neutral ramp (Vercel "ink" aesthetic), re-mapped
        // from the old blue scale to a gallery-like neutral so every surface
        // inherits the new system automatically.
        ink: {
          50: '#fafafa',
          100: '#f6f6f6',
          200: '#ededed',
          300: '#d9d9d9',
          400: '#a3a3a3',
          500: '#6f6f6f',
          600: '#525252',
          700: '#343434',
          800: '#1f1f1f',
          900: '#171717',
          950: '#0d0d0d',
        },
        // Workflow accent colors (Vercel)
        ship: '#ff5b4f',
        preview: '#de1d8d',
        develop: '#0a72ef',
        // Brand accent — petrol blue (آبی نفتی), used for CTAs, active
        // states and educational-block highlights across the hub and editor.
        accent: {
          50: '#eef6f9',
          100: '#d5e9ef',
          200: '#a9d1de',
          300: '#74b2c7',
          400: '#4490ad',
          500: '#1f7396',
          600: '#175e7d',
          700: '#114b64',
          800: '#0d3b4f',
          900: '#0a2d3d',
          950: '#061d27',
        },
      },
      boxShadow: {
        // Shadow-as-border technique: crisp 1px ring + ambient depth + inner
        // white highlight — replaces traditional `border` on cards/inputs.
        ring: '0 0 0 1px rgba(0, 0, 0, 0.08)',
        'ring-strong': '0 0 0 1px rgba(0, 0, 0, 0.16)',
        card: '0 0 0 1px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(255, 255, 255, 0.6)',
        'card-hover': '0 0 0 1px rgba(0, 0, 0, 0.14), 0 4px 14px rgba(0, 0, 0, 0.10), 0 0 0 1px rgba(255, 255, 255, 0.6)',
        'card-accent': '0 0 0 1px rgba(31, 115, 150, 0.25), 0 2px 8px rgba(31, 115, 150, 0.10)',
        'card-accent-hover': '0 0 0 1px rgba(31, 115, 150, 0.45), 0 4px 16px rgba(31, 115, 150, 0.16)',
        'popover': '0 0 0 1px rgba(0, 0, 0, 0.08), 0 24px 48px rgba(0, 0, 0, 0.16), 0 2px 6px rgba(0, 0, 0, 0.08)',
        'focus': '0 0 0 2px rgba(31, 115, 150, 0.45), 0 0 0 1px rgba(0, 0, 0, 0.12)',
      },
      borderRadius: {
        field: '8px',
        card: '12px',
      },
      backgroundImage: {
        'accent-gradient': 'linear-gradient(135deg, #114b64 0%, #1f7396 55%, #4490ad 100%)',
      },
      letterSpacing: {
        // extreme negative tracking for display headings (Vercel "minified" text)
        tight: '-0.02em',
        tighter: '-0.03em',
      },
      keyframes: {
        'spin': { to: { transform: 'rotate(360deg)' } },
      },
      animation: {
        'spin': 'spin 0.7s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
