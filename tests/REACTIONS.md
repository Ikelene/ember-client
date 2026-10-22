Reaction checks
===============

`node --test tests/reaction-usage.mjs` (from the repo root) checks frequency
ordering, account separation, persistence, custom emoji and storage failures.

`node tests/reactions.browser.mjs` requires Playwright and an installed browser
(defaults to Windows Edge; override BROWSER_PATH). It bundles the actual menu,
emoji picker and sheet manager, mocking only account/API/media services. Set
BONFIRE_ANDROID_ROOT to a local Android source folder to include its bundled
touch layer in the checks. ESBUILD_MODULE, PLAYWRIGHT_MODULE and
REACTION_TEST_DEPS can point to existing dependency installations.

For the physical Pixel check, generate debug fixture assets with the browser
test using BONFIRE_ANDROID_ROOT, REACTION_WRITE_ANDROID_FIXTURE=1 and
REACTION_ONLY_FIXTURE=1, then install the Android debug build, launch with
gesture_test=true and forward WebView debugging to localhost:9223. Run
`node tests/reactions.pixel.mjs` from the repository root.
ADB_BIN and BONFIRE_TEST_SERIAL select the ADB executable/test device.
The device test refuses to run against a real conversation.

Verified: six usage checks, 28 integrated browser checks (desktop, mobile and
Android touch layer), nine physical Pixel checks and the complete-composer
scope regression. APIs are mocked: no test reactions are sent to production.
Quick reaction history is saved per account on the current device, records only
successful additions, and does not count removals or failed requests.
