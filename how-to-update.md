# How to update RideZen on the phone

Phone: Vivo X300 Pro. Package id: `com.tulusnas.ridezen`.

**Do NOT use the EAS browser/QR install on the Vivo.** The build artifact is a `.tar.gz` containing two APKs (`debug/app-debug.apk`, `release/app-release.apk`) and Vivo's browser/file manager can't unpack it. Always install over USB with adb.

`adb install -r` overwrites the app and **keeps all app data** (vehicles, logs, settings). The phone only needs to be plugged in to install, not to use the app.

## One-time setup (already done)

- Developer options + USB debugging enabled on the phone.
- adb is NOT on PATH. Full path: `C:/Users/User/AppData/Local/Android/Sdk/platform-tools/adb.exe`
- `ANDROID_HOME` is unset.

## Steps

1. **Run tests** (about 2 min): `npm test`
2. **Build the APK** (uses the `preview` profile in `eas.json`, `assembleRelease`):
   ```
   eas build --profile preview --platform android
   ```
   Wait for it to finish.
3. **Plug in the phone**, accept "Allow USB debugging", then check:
   ```
   adb devices
   ```
   It must say `device`, not `unauthorized` (use the full adb path above).
4. **Get the artifact URL** of the latest build:
   ```
   eas build:list --platform android --limit 1 --json --non-interactive
   ```
   (`eas build:run` does NOT work here: it prompts about multiple apps and stdin isn't readable.)
5. **Download and unpack** into a fresh empty folder:
   ```
   curl -sL "<artifact url>" -o build.tar.gz
   tar -xzf build.tar.gz
   ```
6. **Install the release APK** (standalone, works offline):
   ```
   adb install -r ./release/app-release.apk
   ```
7. **Launch:**
   ```
   adb shell monkey -p com.tulusnas.ridezen -c android.intent.category.LAUNCHER 1
   ```

## If USB / adb is flaky (phone shows `offline` or `unauthorized`)

Happened on 2026-11-16: `adb devices` flipped between `offline` and `device` and installs failed with "device offline" / "no devices/emulators found". Restarting adb did not help (only one adb was running), so it was the phone/cable link.

Try in order:
1. Phone: Developer options > **Revoke USB debugging authorizations**, toggle USB debugging off/on, replug, tap **Allow** (tick "Always allow"). USB mode must be **File transfer**.
2. Use the original cable, plugged directly into the PC (no hub or front-panel port).
3. Vivo may show an extra "Allow install via USB" prompt during `adb install`: tap Allow.
4. Don't run `adb wait-for-device` in the foreground: it hangs forever when the phone is offline.

**Fallback: install the APK by hand** (this is what worked when USB would not):
1. Do steps 1-5 above to get `release/app-release.apk`. If `curl` exits with code 6 (can't resolve host), just retry.
2. Copy it to the Desktop as `RideZen.apk`.
3. Get it onto the phone (USB File Transfer, or send it to yourself via Telegram/WhatsApp/Drive).
4. On the phone: Files > tap `RideZen.apk` > allow "Install unknown apps" if asked > Install. It installs over the old app and keeps data.

## Other notes

- When `eas build` finishes it asks "Install and run the Android build on an emulator? (Y/n)". Answer **n**.
- **Expo Go cannot be used.** It only opens dev-server projects and lacks RideZen's native modules (background location, notifications). Only the APK works.
- The EAS link/QR downloads the `.tar.gz`, which Vivo can't open. Only the unpacked `app-release.apk` installs.
- **Sending to a friend:** works on any Android phone. They allow "Install unknown apps" and tap "Install anyway" on the Play Protect warning. They start with empty data (the app is local-only) and must be sent a new APK for every update. Send it privately, not publicly.

## Checks on the phone after an update

- Manual ride: start, lock the phone, ride about 1 km, confirm the distance counts.
- GPS idle reminder: appears with the app open and in the background; "Turn off GPS" works with the app open, backgrounded and swiped away; "Leave it" dismisses only.
- Maintenance reminders don't remove the idle reminder.

### Maintenance notifications (new: this update adds native modules, so it needs a fresh APK, not just a reload)

- **Permission:** on the first launch after installing, Android asks "Allow RideZen to send notifications?" once (if it was already allowed before, nothing is shown).
- **Settings > Reminders:** "Push notifications" stays where you leave it after you leave the screen and come back. "Notification time" opens a clock dialog and shows the chosen time. "Group into one summary" is remembered. The time and summary rows are greyed out while Push notifications is OFF.
- **km-based item:** Edit the vehicle odometer to within the "final reminder" distance of a service (default 200 km before due). Within about 2 seconds a "Service urgent" notification arrives. Tap it: it opens that item's service screen. Reopening the app must NOT send the same one again.
- **Date-based item:** set an item's due date so a level starts today, set Notification time to 2-3 minutes from now, then swipe RideZen away from recents. The notification must still arrive at that time. Repeat after restarting the phone.
- **Reset:** Log the service for that item. Its badge goes back to "all good" and it will notify again at the next cycle.
- **Switch OFF / ON:** with Push notifications OFF nothing arrives. Switching it ON sends anything that came due while it was off.
- **Group into one summary:** with two or more items due at once, OFF gives one notification each, ON gives one "N services need attention" (tap opens Home).
- **Vivo:** in phone Settings allow RideZen background activity and set battery use to "No restriction" (and Auto-start ON). Otherwise Vivo can delay or drop the scheduled notifications and the daily check, even though the app did everything right.

## Note for Claude

When the user says "push/install/update to my phone", follow this file. Run the steps for them (after the EAS build finishes) instead of asking again. If `adb devices` shows no device, `offline` or `unauthorized`, follow the troubleshooting section above, and fall back to the manual APK install (copy to Desktop) rather than looping on adb. Don't re-explain why Expo Go or the QR install won't work; it's documented here.
