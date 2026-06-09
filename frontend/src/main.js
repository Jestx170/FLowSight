import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import App from './App.vue'
import router from './router'
import en from './i18n/locales/en.js'
import th from './i18n/locales/th.js'
import './assets/style.css'

// Language persists across reloads, matching the legacy `localStorage fs_lang`.
const savedLang = localStorage.getItem('fs_lang') || 'en'

const i18n = createI18n({
  legacy: false,
  locale: savedLang,
  fallbackLocale: 'en',
  messages: { en, th },
})

createApp(App)
  .use(createPinia())
  .use(router)
  .use(i18n)
  .mount('#app')
