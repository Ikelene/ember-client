import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// The commit this bundle is built from (shown in About, and compared with GitHub + the served copy to offer an update).
// EMBER_COMMIT overrides it for builds made outside a git checkout; no commit at all builds as "dev" (update checks are skipped).
const git = args => { try { return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return '' } }
const commit = process.env.EMBER_COMMIT || git('rev-parse HEAD') || 'dev'
const dirty = !process.env.EMBER_COMMIT && !!git('status --porcelain --untracked-files=no')
const builtAt = new Date().toISOString()

// <outDir>/version.json: what a host serves so clients can tell which commit is live
const versionFile = () => ({
  name: 'ember-version-file',
  apply: 'build',
  writeBundle(opts) {
    mkdirSync(opts.dir, { recursive: true })
    writeFileSync(join(opts.dir, 'version.json'), JSON.stringify({ commit, dirty, builtAt }) + '\n')
  },
})

// `npm run dev` proxies everything that is not the client itself to a running Velora (VELORA_ORIGIN, default http://localhost:3100)
const target = process.env.VELORA_ORIGIN || 'http://localhost:3100'
const proxied = ['/chat/', '/api', '/bonfire', '/assets', '/u', '/me', '/im', '/groups', '/friends', '/account', '/push', '/media', '/admin', '/login', '/build.json']
const proxy = Object.fromEntries(proxied.map(p => [p, { target, changeOrigin: true }]))
proxy['/ws'] = { target, ws: true, changeOrigin: true }

export default defineConfig(({ command }) => ({
  plugins: [react(), versionFile()],
  // Velora serves the built bundle under /ember/ (and index.html at /chat); `npm run dev` runs at the root
  base: command === 'build' ? (process.env.EMBER_BASE || '/ember/') : '/',
  define: {
    __EMBER_COMMIT__: JSON.stringify(commit),
    __EMBER_REPO__: JSON.stringify(process.env.EMBER_REPO || 'Ikelene/ember-client'),
  },
  server: { proxy },
  build: { outDir: 'dist', emptyOutDir: true },
}))
