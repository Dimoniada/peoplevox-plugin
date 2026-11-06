# Peoplevox Range Label Printer

A Tampermonkey script for Peoplevox's **Manage locations** page (`rkb4952`). Type a barcode
range such as `HB6.B[1-10].L[3-9]`, press **Print**, and one label prints for every location,
in range order. It uses the printer, template and copies saved in Peoplevox's own
**Manage print options**.

## Install

1. Install Tampermonkey for your browser:
   - **Chrome or Opera (desktop):** Chrome Web Store.
   - **Firefox (desktop and Android):** addons.mozilla.org.
   - **Safari on Mac:** Mac App Store.
   - **Safari on iPhone/iPad:** App Store. Then turn it on in Settings → Safari → Extensions,
     and allow it on `wms.peoplevox.net`.
   - Chrome and Opera on phones can't run extensions, so use Safari (iOS) or Firefox (Android).
2. Open https://raw.githubusercontent.com/Dimoniada/peoplevox-plugin/main/peoplevox-range-printer.user.js in that browser. Tampermonkey shows its install page; click **Install**.

## Use

1. Open **Warehouse → Manage locations**. The window appears top-right.
2. If it says **Printer is not set**, click Peoplevox's *Manage print options* icon (the printer
   with the gear, above the grid). Pick the printer and template, then **Save**.
3. Type a range and press **Print** or Enter.
   - First it checks that every barcode exists ("Checking…"). If any are missing, it lists them
     and prints nothing.
   - While printing it shows progress like `21/700`. **Stop** finishes the current label, then
     stops.
   - If a print fails, it stops at once and shows the barcode and the reason.
   - If it says **Plugin disabled**, the remote switch is off (see below).
4. **×** hides the window until the page is reloaded. Tampermonkey's menu item
   **Show Range Printer** brings it back.
5. Drag the window by any part that isn't a field or a button.

**Range syntax:**
- `[a-b]` is inclusive. Numbers can count up or down (`[9-3]`), and single letters work too
  (`[A-C]`).
- Leading zeros are kept only if you type them: `[01-10]` gives 01…10.
- Several ranges nest left to right: `HB6.B[1-2].L[3-4]` gives B1.L3, B1.L4, B2.L3, B2.L4.

**Settings (gear):** transparency, theme (match page, light, dark, or a solid colour), and the
delay between labels. They're saved per browser.

## Updates

Updates are automatic. Tampermonkey checks this repo for a script with a higher `@version`
(by default about once a day) and installs it. To get it at once, use Tampermonkey's
**Check for userscript updates**.

To release: change `peoplevox-range-printer.user.js`, raise `@version`, run `npm test`, and push
to `main`.

## Remote switch

`application.yaml` in this repo holds `enabled: true`. The plugin reads it every time someone
presses **Print**. Set it to `enabled: false` and push: every machine then shows **Plugin
disabled** in red and prints nothing. Set it back to `true` to turn the plugin on again.

If GitHub can't be reached, the plugin keeps working; only an explicit `enabled: false` stops it.

## Development

Run `npm test` (Node 18+, no dependencies).

## Verified on

| Browser | Install | Print 1 / range | Drag | Theme / gear | × and menu | Printer not set | Stop |
|---|---|---|---|---|---|---|---|
| Firefox (Windows) | | | | | | | |
| Chrome | | | | | | | |
| Opera | | | | | | | |
| Safari (Mac) | | | | | | | |
| Safari (iPhone/iPad) | | | | | | | |
| Firefox (Android) | | | | | | | |
