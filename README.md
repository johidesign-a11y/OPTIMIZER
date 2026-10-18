# Frameforge

A free, local Windows gaming optimizer built for an **Intel Core i5-14600, NVIDIA RTX 3060, and 32 GB RAM**, with a dedicated Counter-Strike 2 workflow. The target build is a profile, not fabricated scanner output.

## Download the Windows app

Open [Frameforge downloads on GitHub Releases](https://github.com/johidesign-a11y/OPTIMIZER/releases), choose the newest published release, and download **Frameforge-1.0.0-win.zip** from **Assets**. Right-click the downloaded ZIP in Windows, choose **Extract All**, open the extracted folder, and double-click **Frameforge.exe**. Keep the other extracted files with the executable. If an installer ending in **Setup.1.0.0.exe** is also listed, it can be installed directly instead.

The ZIP contains the complete Windows application. Source-code archives are for development; the ready-to-open app is the separately listed Windows ZIP. After applying approved settings, close Frameforge before playing. Changes remain saved; follow any sign-out/restart markers shown by the selected settings.

## What works

- **59 individually selectable settings** with descriptions, restart requirements, and trade-offs: Game Mode/capture, mouse and keyboard preferences, desktop effects, optional Windows background features, privacy preferences, update peer sharing, and optional AC power tuning.
- **Click to review and apply** either a curated profile or your own selection. No registry commands need to be copied into a terminal.
- **Real Windows hardware scan**: processor, GPU/driver/VRAM when reported, RAM modules and speeds, motherboard, BIOS, disks, network adapters, Windows build, and active display modes. Unavailable fields remain unknown.
- **System cleanup**: analyze first, then permanently remove approved, unlocked temporary files older than 48 hours. Downloads, game files, shader caches, and Prefetch are excluded.
- **Recovery**: verified Windows restore points plus durable, typed per-setting snapshots and a transaction journal. Failed batches attempt rollback; settings backups restore newest first.
- **CS2**: discover Steam libraries and add a backed-up, managed `autoexec.cfg` block with `fps_max 300` and `fps_max_ui 60`. Existing FPS limits and later user edits are protected. These are starting caps to benchmark, not an automatic Reflex or driver modification.

Every mutation asks for approval. Nothing in the browser preview changes Windows, and it never pretends to scan the browsing device. All features are free; there are no accounts or paid unlocks.

## Windows app

Extract the Windows ZIP from `release/` and open **Frameforge.exe**. Keep the executable together with its resources and other extracted files. The ZIP is a complete Windows application, not just the executable alone. An installer can also be built on Windows with `npm run dist:win`.

Open the app, scan your PC, select the settings you want, and approve the reviewed batch. The app requests administrator access through Windows UAC when you choose administrator mode. It does not silently escalate or restart Windows.

System Protection must be available before system tweaks can be applied. A verified recent Frameforge restore point may be reused; otherwise the app creates and verifies one before any settings change. If your custom Windows removed System Restore or Windows refuses a checkpoint, the operation stops. Exact-setting backups are retained separately under the app's user-data directory (normally `%APPDATA%\\Frameforge`). Keep this directory while you need recovery. Full Windows System Restore remains a separate Windows recovery operation; the app's Restore button restores its own setting snapshots.

Temporary-file cleanup is irreversible and is not covered by settings backups or restore points. Read the deletion confirmation before approving.

## Development

Node.js 22.12+ (or 24 LTS) and npm are required. Use the existing checkout; cloud tasks already provide isolation and do not need an additional Git worktree.

```sh
npm ci
npm run dev
```

`npm run dev` starts the visual browser preview. On Windows, `npm run desktop:dev` starts Vite and Electron together, and `npm run desktop` opens the production renderer in Electron. Native operations require Windows 10 build 19041+ or Windows 11, built-in Windows PowerShell 5.1, and the relevant Windows components. Administrator mode is required for system changes.

```sh
npm run build
npm test
npm run test:ui
```

The UI suite uses an installed Chromium at `/usr/bin/chromium` or the `FRAMEFORGE_CHROMIUM` executable. Its Windows bridge is mocked to check approval, results, error handling, and all views; this does not validate Windows management APIs. Native transaction tests parse the production PowerShell and mock Windows operations:

```powershell
powershell -NoProfile -File tests/native.test.ps1
```

Build a Windows installer with `npm run dist:win` or a ZIP with `npm run dist:win:zip`. Packaging downloads verified Electron/build artifacts. On a proxy-based Node 24 environment, `NODE_USE_ENV_PROXY=1` may be needed. Installation/build caches can be relocated with `ELECTRON_CACHE` and `ELECTRON_BUILDER_CACHE`; TLS and checksum verification must stay enabled. Packaged builds are unsigned unless you provide your own signing configuration.

## Performance and validation limits

This app does not promise a specific FPS increase, network ping reduction, or measured mouse latency. CS2 uses raw input; Windows pointer acceleration and desktop keyboard settings do not change its raw input pipeline. Cosmetic/privacy tweaks primarily affect Windows behavior. CPU/USB/PCIe power settings are optional and can raise temperatures or power draw. NVIDIA Reflex and driver-level settings are not silently changed through guessed registry values.

The app preserves Defender, Firewall, Windows Update, security mitigations, driver checks, timers/HPET, and the networking stack. Custom Windows builds may ignore or remove some settings; unsupported entries are skipped when detectable. A successful registry write is not proof of a measurable gaming benefit.

Linux validation covers the renderer build, Node request guards/catalog tests, browser interaction tests, PowerShell syntax, and mocked transaction recovery. **Actual Windows scanning, registry/power changes, Windows restore points, UAC, cleanup, and CS2 installation integration still require testing on Windows before relying on them on your gaming PC.** See [native/README.md](native/README.md) for the Windows validation cases and [shared/catalog-notes.md](shared/catalog-notes.md) for setting semantics.
