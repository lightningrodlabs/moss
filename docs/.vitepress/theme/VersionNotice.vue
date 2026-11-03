<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, withBase } from 'vitepress';
import { versions, versionForPath, pathInVersion } from '../versions';

const route = useRoute();
const current = computed(() => versionForPath(route.path));
const latest = versions.find((v) => v.current)!;
const latestLink = computed(() => withBase(pathInVersion(route.path, latest)));
</script>

<template>
  <div v-if="!current.current" class="version-notice">
    You are reading the documentation for Moss {{ current.label }}.
    <a :href="latestLink">Switch to Moss {{ latest.label }}</a
    >, the current version.
  </div>
</template>

<style scoped>
.version-notice {
  margin-bottom: 24px;
  padding: 12px 16px;
  border-radius: 8px;
  background: var(--vp-c-warning-soft);
  border: 1px solid var(--vp-c-warning-1);
  font-size: 14px;
}
.version-notice a {
  font-weight: 600;
  text-decoration: underline;
}
</style>
