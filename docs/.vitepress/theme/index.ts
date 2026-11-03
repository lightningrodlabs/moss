// https://vitepress.dev/guide/custom-theme
import { h } from 'vue';
import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import VersionSwitcher from './VersionSwitcher.vue';
import VersionNotice from './VersionNotice.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      // https://vitepress.dev/guide/extending-default-theme#layout-slots
      'nav-bar-content-after': () => h(VersionSwitcher),
      'doc-before': () => h(VersionNotice),
    });
  },
  enhanceApp({ app, router, siteData }) {
    // ...
  },
} satisfies Theme;
