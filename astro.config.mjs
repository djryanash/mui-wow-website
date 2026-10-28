import { defineConfig } from 'astro/config';

// Trilingual per ADR 0003: English at root, Spanish and Cantonese under prefixes.
export default defineConfig({
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es', 'zh-hk'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
});