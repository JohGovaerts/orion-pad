# Orion Pad

Play your own GOG copy of **Master of Orion II** (DOS version) on an iPad in landscape,
as a home-screen web app. The emulator is [js-dos v8](https://js-dos.com) (DOSBox in WebAssembly).

No game files are included. You load your own zip once and it stays stored on the iPad.

## 1. Make the game zip (on your PC)

1. Install Master of Orion 2 from GOG.
2. Open the install folder (e.g. `C:\GOG Games\Master of Orion 2`).
3. Select **the files inside it** (not the folder itself), at least `ORION2.EXE`, `ORION150.EXE`, `SETSOUND.EXE`, the `150` folder,
   all `*.LBX` files and the `.CFG` files. You can leave out GOG's own
   `DOSBOX` folder and the uninstaller.
4. Right-click → *Send to → Compressed (zipped) folder*. Name it `moo2.zip`.
5. Put the zip in iCloud Drive or AirDrop it to the iPad, so it's in the **Files** app.

(If `ORION2.EXE` ends up inside a subfolder with a short name like `MOO2`, that works too.
Long names like `Master of Orion 2` don't, because DOS can't read them.)

## 2. Host the app (free, HTTPS)

Pick one:

- **Cloudflare Pages / Netlify:** drag this whole folder into "deploy manually".
- **GitHub Pages:** push this folder to a repo, then *Settings → Pages → Deploy from branch*.

The site holds no game data, so it's fine for it to be public.

## 3. Install on the iPad

1. Open the site in **Safari** (once with internet, so the emulator gets cached).
2. Share → **Add to Home Screen**.
3. Open *Orion Pad* from the home screen, tap **Load game .zip** and choose `moo2.zip`.
4. Tap **Play**. Turn on rotation lock in Control Center once you're in landscape.

## Controls

| Input | Action |
|---|---|
| Tap | Left-click at that spot |
| Long-press | Right-click (held until you lift) |
| Drag | Hold left button (sliders, scrollbars) |
| Two-finger tap | Esc |
| ⌨ button (top right) | Opens the iPad keyboard to type names (closes after Enter) |
| ☰ button (top right) | Esc / Enter / keyboard / cheats / fullscreen / save / quit |
| ☰ → Cheats | Sends Alt + a cheat code (e.g. moola) on the galaxy screen |
| Trackpad or mouse | Works normally, including right-click |
| Hardware keyboard | All game hotkeys |

## Saves

- Saves are kept on the iPad automatically every 90 seconds, when you leave the app,
  and when you quit via ☰. Use ☰ → *Save to iPad now* after saving in the game to be sure.
- **Settings → Export saves** gives you a zip to keep in Files. iPadOS can clear website
  storage if the device runs low on space, so export now and then.
- **Import saves** restores such a zip.

## Troubleshooting

- **Game runs slowly or the music stutters:** Settings → CPU speed → *Fixed 40000*
  (try 20000 or 60000 too).
- **No sound:** Settings → Launch → *Sound setup*, play, choose Sound Blaster 16
  (port 220, IRQ 7, DMA 1). Quit, set Launch back to *Game*.
- **Long-press acts like a middle click:** Settings → Right-click code → 2.
- **The emulator doesn't start:** the first launch needs internet to fetch js-dos.

## Files

- `index.html`, `style.css`: interface
- `app.js`: storage, DOSBox config, touch/trackpad/keyboard input, saves
- `sw.js`: offline cache for the app and the emulator
- `manifest.webmanifest`, `icons/`: home-screen app setup
