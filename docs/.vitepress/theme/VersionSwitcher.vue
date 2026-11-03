<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter, withBase } from 'vitepress';
import { versions, versionForPath, pathInVersion } from '../versions';

const route = useRoute();
const router = useRouter();

const current = computed(() => versionForPath(route.path));

function switchTo(event: Event) {
  const label = (event.target as HTMLSelectElement).value;
  const target = versions.find((v) => v.label === label);
  if (!target || target === current.value) return;
  router.go(withBase(pathInVersion(route.path, target)));
}
</script>

<template>
  <label class="version-switcher">
    <span class="visually-hidden">Documentation version</span>
    <select :value="current.label" @change="switchTo" aria-label="Documentation version">
      <option v-for="v in versions" :key="v.label" :value="v.label">
        Moss {{ v.label }}{{ v.current ? ' (current)' : '' }}
      </option>
    </select>
  </label>
</template>

<style scoped>
.version-switcher {
  display: flex;
  align-items: center;
  margin-left: 16px;
}
.version-switcher select {
  font-size: 13px;
  font-weight: 500;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
