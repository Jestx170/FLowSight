<script setup>
import { useI18n } from 'vue-i18n'

const { t, locale } = useI18n()

const links = [
  { to: '/live', key: 'nav.live' },
  { to: '/dashboard', key: 'nav.dashboard' },
  { to: '/zones', key: 'nav.zones' },
  { to: '/behaviors', key: 'nav.behaviors' },
  { to: '/heatmap', key: 'nav.heatmap' },
  { to: '/settings', key: 'nav.settings' },
]

function toggleLang() {
  locale.value = locale.value === 'th' ? 'en' : 'th'
  localStorage.setItem('fs_lang', locale.value)
}
</script>

<template>
  <nav class="navbar">
    <div class="navbar-brand">FlowSight</div>
    <ul class="navbar-links">
      <li v-for="l in links" :key="l.to">
        <RouterLink :to="l.to">{{ t(l.key) }}</RouterLink>
      </li>
    </ul>
    <button class="lang-switch" @click="toggleLang">
      {{ locale === 'th' ? 'EN' : 'ไทย' }}
    </button>
  </nav>
</template>
