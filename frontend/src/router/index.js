import { createRouter, createWebHashHistory } from 'vue-router'

// Hash history keeps client-side routing working under Flask without needing a
// server-side catch-all route. Empty base => links are "#/path" relative to
// whatever path serves the HTML (works at /v2 now, and at / after cutover).
const routes = [
  { path: '/', redirect: '/live' },
  { path: '/live', name: 'live', component: () => import('../views/LiveView.vue') },
  { path: '/dashboard', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
  { path: '/zones', name: 'zones', component: () => import('../views/ZonesView.vue') },
  { path: '/behaviors', name: 'behaviors', component: () => import('../views/BehaviorsView.vue') },
  { path: '/heatmap', name: 'heatmap', component: () => import('../views/HeatMapView.vue') },
  { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
]

export default createRouter({
  history: createWebHashHistory(),
  routes,
})
