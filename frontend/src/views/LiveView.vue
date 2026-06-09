<script setup>
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>

<template>
  <section class="placeholder-view">
    <h1>{{ t('nav.live') }}</h1>
    <p>{{ t('scaffold.placeholder') }}</p>
  </section>
</template>
