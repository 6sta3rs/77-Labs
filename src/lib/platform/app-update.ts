// App self-update through the Tauri updater: signed NSIS builds and `latest.json` on GitHub Releases
// (endpoint and public key in src-tauri/tauri.conf.json; release steps in docs/features/aktualizacje-aplikacji.md).
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { invoke } from '@tauri-apps/api/core'

export type { Update }

/** False only when the app itself says this build has no update feed (source/dev builds); a failed command counts as supported. */
export const updatesSupported = () => invoke<boolean>('app_updates_supported').catch(() => true)

/** Newer signed release, or null when this build is the latest. */
export const findAppUpdate = () => check({ timeout: 30_000 })

/** Downloads, verifies the signature, runs the installer and restarts the app. */
export async function installAppUpdate(update: Update, onprogress: (done: number, total: number) => void) {
  let done = 0, total = 0
  await update.downloadAndInstall(event => {
    if (event.event === 'Started') total = event.data.contentLength ?? 0
    else if (event.event === 'Progress') { done += event.data.chunkLength; onprogress(done, total) }
  })
  await relaunch()
}
