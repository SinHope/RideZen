/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        zen: {
          primary: '#1B6CA8',
          'primary-light': '#4AACCF',
          'primary-pale': '#D6EEF8',
          secondary: '#2D6A4F',
          'secondary-light': '#74C69D',
          stone: '#6B7280',
          earth: '#8B6F47',
          gold: '#F4A035',
          bg: '#F0F8FF',
          surface: '#FFFFFF',
          text: '#0D3B5E',
          muted: '#6B7280',
          ok: '#2D6A4F',
          'ok-bg': '#D6F0E2',
          warn: '#C45E0A',
          'warn-bg': '#FDE9D3',
          urgent: '#B45309',
          'urgent-bg': '#FEF3C7',
          danger: '#CC0000',
          'danger-bg': '#FFDDDD',
        },
      },
      fontFamily: {
        playfair: ['PlayfairDisplay_400Regular', 'serif'],
        'playfair-medium': ['PlayfairDisplay_500Medium', 'serif'],
        'playfair-semibold': ['PlayfairDisplay_600SemiBold', 'serif'],
        inter: ['Inter_400Regular', 'sans-serif'],
        'inter-medium': ['Inter_500Medium', 'sans-serif'],
        'inter-semibold': ['Inter_600SemiBold', 'sans-serif'],
        'inter-light': ['Inter_300Light', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '24px',
        '4xl': '32px',
      },
      boxShadow: {
        zen: '0 4px 16px rgba(27, 108, 168, 0.10)',
        'zen-sm': '0 2px 8px rgba(27, 108, 168, 0.08)',
        'zen-lg': '0 8px 32px rgba(27, 108, 168, 0.12)',
      },
    },
  },
  plugins: [],
};
