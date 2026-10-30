# Ember client

The web client for **Ember**, a chat system made of servers, channels, direct messages, friends and voice. It is a React + Vite single-page app that builds to a static bundle.

**Ember is an open protocol.** Anyone can write their own Ember client and talk to Ember servers; this app is just the one the Velora ecosystem uses. Nothing in here is required to take part.

## Where it runs

[Velora](https://nookara.cc/) hosts the built bundle. Its source lives here. Velora serves:

- `index.html` at `/chat`
- everything else from this build (`assets/*`, `version.json`) under `/ember/`

The bundle expects the host to provide, at the site root, the API (`/chat/...`, `/api/v1/...`, `/bonfire/...`, `/ws`, ...) and the shared static files under `/assets/` (sounds in `/assets/sounds/chat`, emoji, flags, the Ember logos in `/assets/bonfire`). Those stay with Velora.

## Develop

```sh
npm install
npm run dev     # http://localhost:5173/chat
npm run build   # static bundle in dist/
npm test
```

`npm run dev` proxies the API and `/assets` to a running Velora (`VELORA_ORIGIN`, default `http://localhost:3100`; Velora's `scripts/dev-stack.sh` starts one).

## Versions and updates

The build is stamped with the git commit it was made from (`vite.config.js`):

- `dist/version.json` holds `{ commit, dirty, builtAt }`; the host serves it next to the bundle.
- the same commit is compiled into the app and shown in Settings → About, next to the license and copyright, which are read from this GitHub repository (cached for a day, with a fallback when GitHub can't be reached).

Updating works in two steps. The app watches GitHub for a newer commit on `main`; it then checks whether the host actually serves that commit (`version.json`) and only offers *Reload* once it does. If GitHub can't be reached, it just compares with what the host serves. Builds without a commit (`dev`) skip all of this.

Set `EMBER_COMMIT=<sha>` to build outside a git checkout and `EMBER_BASE` to serve the bundle from somewhere other than `/ember/`.

## Getting a build onto Velora

Velora pins the commit it ships in `ember-client.lock` and builds it with `scripts/sync-ember-client.sh` (see Velora's `README-dev.md`). Pushing to `main` here is therefore not enough: Velora has to be updated to the new commit before anyone is asked to reload.

## Credits

The **AOL** and **PlayStation** message sounds belong to their respective owners (AOL and Sony Interactive Entertainment). They are not part of Ember and are not covered by this repository's license.
