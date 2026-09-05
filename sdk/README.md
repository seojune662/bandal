# Bandal plugin SDK

Type-only package: `sdk/plugin-api/index.d.ts`. The runtime injects `Bandal` into `activate`; there is no runtime SDK import or Node `require` inside plugins.

From the repository root (Node 24):

```sh
pnpm plugin create /path/to/my-plugin publisher.my-plugin
pnpm plugin validate /path/to/my-plugin
pnpm plugin pack /path/to/my-plugin /path/to/plugin.zip
pnpm plugin:test
```

The CLI builds into `out/plugin-cli/plugin.cjs`. It scaffolds JavaScript, validates archives and packages deterministic ZIPs. Compile TypeScript and bundle dependencies into CommonJS `main.js` yourself; place panel assets under `ui/`. Do not place release files under the skipped `dist` directory.

For TypeScript development, install the local type package as a dev dependency (`file:/path/to/bandal/sdk/plugin-api`) and use `import type { BandalPlugin } from '@bandal/plugin-api'`. For JS, use a JSDoc import pointing to that declaration file.

See [API v2](../docs/plugins-v2.md), [examples](../examples/plugins), and [marketplace deployment](../docs/marketplace.md). This is Bandal's API, not a VS Code/Obsidian compatibility layer.
