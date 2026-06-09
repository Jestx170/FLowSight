// Copies the Vite build output into the Flask app so it can serve the SPA:
//   dist/index.html   -> backend/templates/index_vue.html  (served at /v2)
//   dist/assets/*     -> backend/static/assets/*   (icons etc. are preserved)
//
// index_vue.html (not index.html) so we never clobber the functional legacy UI
// served at /. At cutover (Phase 9) this switches to index.html.
//
// Used for local builds. The Docker multi-stage build does the equivalent COPY
// steps itself, so this script is host-only.
import { cp, mkdir, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const dist = resolve(here, '../dist')
const backend = resolve(here, '../../backend')

await mkdir(resolve(backend, 'templates'), { recursive: true })
await mkdir(resolve(backend, 'static/assets'), { recursive: true })

await copyFile(resolve(dist, 'index.html'), resolve(backend, 'templates/index_vue.html'))
await cp(resolve(dist, 'assets'), resolve(backend, 'static/assets'), { recursive: true })

console.log('Deployed Vue build -> backend/templates + backend/static/assets')
