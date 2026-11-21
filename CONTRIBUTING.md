# Contributing

Small, reproducible bug reports and focused patches are welcome. Please include
your DSH version, plugin version and reproduction steps, with tokens, signed URLs,
paths identifying you and private conversation content removed.

Run `npm run check`, `npm test` and `npm run verify:package` before opening a PR.
Tests must use synthetic data and must not require a real DeepSeek account. Add
regressions for changes to streaming, branches, attachments or request validation.

To check an import across a cold reopen, run
`node scripts/check-import-reopen.mjs <DSH node_modules/@deepseek-ai path>`
with the runtime bundled with DSH. For the desktop build, run its executable in
Node mode (`ELECTRON_RUN_AS_NODE=1`) and use the package root inside
`resources/app.asar/dsh/node_modules/@deepseek-ai`. The check uses a temporary
log directory and a simulated follow-up, with no profile or model calls.

New original contributions are offered under this project's PolyForm
Noncommercial 1.0.0 license. Keep applicable upstream notices, identify any
third-party material you add, and only contribute work you have the right to
license. Do not submit credentials, account exports or real conversation fixtures.
