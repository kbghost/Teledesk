const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'), surface: v('surface'), raised: v('raised'), ink: v('ink'), muted: v('muted'), line: v('line'),
        brand: v('brand'), 'brand-ink': v('brand-ink'), gold: v('gold'), 'gold-ink': v('gold-ink'),
        ok: v('ok'), danger: v('danger'), accent: v('accent'), 'accent-ink': v('accent-ink'),
      },
      fontFamily: {
        display: ['Poppins', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Poppins', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },

      borderRadius: { ctl: '10px', card: '16px', bubble: '18px' },
      boxShadow: { pop: '0 12px 40px -12px rgb(var(--shadow) / 0.35)' },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        pop: { from: { opacity: '0', transform: 'translateY(8px) scale(.98)' }, to: { opacity: '1', transform: 'none' } },
        drawer: { from: { transform: 'translateX(100%)' }, to: { transform: 'none' } },
      },
      animation: { pop: 'pop .18s ease-out', drawer: 'drawer .22s ease-out' },
    },
  },
  plugins: [],
};
