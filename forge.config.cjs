/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const entitlementsPath = join(__dirname, 'electron/entitlements.plist');
const iconPath = existsSync(join(__dirname, 'electron/icons/icon.icns'))
  ? './electron/icons/icon'
  : undefined;

module.exports = {
  makers: [
    {
      config: {},
      name: '@electron-forge/maker-squirrel',
    },
    {
      arch: ['arm64'],
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    },
    {
      config: {},
      name: '@electron-forge/maker-deb',
    },
    {
      config: {},
      name: '@electron-forge/maker-rpm',
    },
  ],
  packagerConfig: {
    appBundleId: 'dev.nkzw-tech.codiff',
    appCopyright: 'Copyright (c) 2026-current Nakazawa Tech',
    asar: false,
    ...(iconPath ? { icon: iconPath } : {}),
    ignore: [
      /^\/\.DS_Store$/,
      /^\/\.enum_manifest\.json$/,
      /^\/\.env(?:$|[.])/,
      /^\/\.git(?:$|\/)/,
      /^\/\.gitignore$/,
      /^\/\.github(?:$|\/)/,
      /^\/\.vite-hooks(?:$|\/)/,
      /^\/\.vscode(?:$|\/)/,
      /^\/README\.md$/,
      /^\/coverage(?:$|\/)/,
      /^\/docs(?:$|\/)/,
      /^\/forge\.config\.cjs$/,
      /^\/index\.html$/,
      /^\/out(?:$|\/)/,
      /^\/pnpm-workspace\.yaml$/,
      /^\/public(?:$|\/)/,
      /^\/src(?:$|\/)/,
      /^\/tsconfig/,
      /^\/vite\.config\./,
    ],
    osxNotarize: {
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
      tool: 'notarytool',
    },
    osxSign: {
      continueOnError: false,
      hardenedRuntime: true,
      identity: process.env.APPLE_SIGNING_IDENTITY,
      optionsForFile: () => ({
        entitlements: entitlementsPath,
      }),
    },
    protocols: [
      {
        name: 'Codiff',
        schemes: ['codiff'],
      },
    ],
  },
  rebuildConfig: {},
};
