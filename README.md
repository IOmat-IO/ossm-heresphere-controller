# OSSM HereSphere Controller

**Community app by IOmat**

OSSM HereSphere Controller is a free Windows application that connects HereSphere directly to an OSSM through the device's native BLE Streaming mode and plays matching `.funscript` files without requiring Intiface, Buttplug, MultiFunPlayer, Node.js, or any other companion software on the end-user PC.

This is an independent community project. It is not officially affiliated with Research & Desire.

## Main features

- Direct HereSphere timestamp reception over the local network.
- Direct BLE connection to a compatible OSSM using native Streaming mode.
- Automatic loading of a matching funscript from a user-selected repository.
- Recursive search inside repository subfolders.
- Optional one-off manual funscript loading.
- Automatic arming when HereSphere, the script, and the OSSM are ready.
- Streaming auto-park when playback is paused or stopped.
- `Reverse` direction option.
- Optional `Simplified R+D` mode.
- Adjustable motor limits, device buffer, and time offset.
- Optional diagnostic logs, disabled by default and capped automatically.
- Prevents the PC from sleeping while the application is running.
- French, English, Spanish, and Brazilian Portuguese interface.

## Requirements

- Windows 10 or Windows 11, 64-bit Intel/AMD PC.
- A working Bluetooth Low Energy adapter and Windows Bluetooth driver.
- A compatible OSSM exposing the native OSSM BLE Streaming service.
- HereSphere running on a device reachable from the PC on the same local network.
- HereSphere playback speed set to `1.000x`.
- Matching `.funscript` files for the videos you want to play.

### OSSM compatibility

Device discovery is based on the OSSM BLE service UUID, not only on the advertised device name. An OSSM running compatible firmware with the native Streaming service should appear in the device picker. Compatibility cannot be guaranteed for old firmware, custom firmware, clones, or devices that do not expose the expected OSSM service and characteristics.

## First session: recommended order

### 1. Install and launch

Download the latest Windows installer from the GitHub **Releases** page and run:

```text
OSSM-HereSphere-Setup-0.1.8-x64.exe
```

The installer is currently unsigned, so Windows SmartScreen may display a warning. Use **More info** and then **Run anyway** only if you downloaded the file from the official project release page.

No development tools are required after installation. The end user does not need Node.js, npm, Python, Electron, Intiface, or MultiFunPlayer.

### 2. Choose the interface language

On first launch, select French, English, Spanish, or Brazilian Portuguese. The choice is remembered and can be changed later from the top-right language selector.

### 3. Start HereSphere and establish the network connection

Start HereSphere and make sure the headset or playback device is on the same local network as the PC.

The application automatically searches for HereSphere on TCP port `23554`. The last detected address is tried first on future launches. The detected IP address is visible under:

```text
Configuration > HereSphere connection
```

Use **Search now** to restart discovery. The application reconnects automatically unless reconnection has been suspended.

### 4. Select the funscript repository

Open:

```text
Configuration > Script folder > Choose folder
```

Select the folder that contains your `.funscript` collection. The application searches only inside that folder and its subfolders. The selected path is remembered.

For automatic matching, use the same base name for the video and script, for example:

```text
My Video.mp4
My Video.funscript
```

The application also supports the full video filename form:

```text
My Video.mp4.funscript
```

The full video filename match has priority. If multiple scripts with the same matching name are found, the application reports an ambiguity instead of choosing one silently.

### 5. Optional: load a script for this session only

To test a file outside the repository, use:

```text
Choose a funscript manually
```

This loads a one-off script for the current session. It does not replace or redefine the saved repository folder.

### 6. Connect the OSSM

Turn on the OSSM, then click:

```text
Connect OSSM
```

Choose the device in the Bluetooth picker. After connection, the application switches the device to native Streaming mode and applies the remembered limits.

Start with conservative speed, stroke, depth, and acceleration values. Keep the red **STOP** button accessible and verify operation at low intensity before increasing any limit.

### 7. Check `Reverse`

`Reverse` changes the mapping between funscript positions and the physical OSSM direction:

```text
normal:   script 0 -> OSSM 0,   script 100 -> OSSM 100
reverse:  script 0 -> OSSM 100, script 100 -> OSSM 0
```

It does not modify the funscript file. Leave it enabled if the movement direction matches your setup. Toggle it if the machine moves opposite to the intended script direction.

### 8. Choose classic or `Simplified R+D` playback

Classic mode is the default and sends the complete action list. It is generally more faithful to scripts containing meaningful intermediate speed changes.

`Simplified R+D` keeps mainly direction changes and removes intermediate points along the same direction. It may improve fluidity with unusually dense or noisy scripts, but it can reduce some intentional detail.

For the scripts tested during development, classic mode was stable and often felt more faithful. Use `Simplified R+D` as an advanced compatibility option rather than a mandatory setting.

### 9. Set the device buffer and time offset

The application uses the device buffer and time offset to compensate for transport and firmware latency.

A reasonable initial test value is:

```text
Time offset: 15 ms
```

Change only one synchronization setting at a time:

- If movement consistently feels late, increase the time offset in small 5 ms steps.
- If movement consistently feels early, decrease it in small 5 ms steps.

Do not use the time offset to compensate for isolated lags or physically impossible script segments.

### 10. Start playback

When all three conditions are ready, the application arms automatically:

- HereSphere connected and sending timestamps;
- a matching funscript loaded;
- OSSM connected.

Start the video in HereSphere. Pausing or stopping playback triggers the Streaming auto-park. Resuming playback restarts scheduling from the current HereSphere timestamp.

### 11. Stop immediately when required

Use the red **STOP** button to disable automatic motion immediately. Use **Resume automation** only after checking that the situation is safe.

## Diagnostic logs

Detailed diagnostic logs are disabled by default.

Enable them only when investigating a problem:

```text
Diagnostic > Record diagnostic logs
```

When enabled:

- log files are split at approximately 10 MB;
- total detailed log storage is capped at approximately 100 MB;
- older detailed logs are deleted automatically when the cap is exceeded;
- the log folder can be opened from the application;
- logs can be purged from the application.

A very small critical-error log may still be retained when detailed logs are disabled. The application does not intentionally upload logs or analytics. Logs remain on the local PC unless the user shares them manually.

## Safety

This software controls motorized hardware. Use it at your own risk.

- Test at low speed and limited stroke first.
- Keep the hardware emergency stop and the application's red **STOP** button accessible.
- Do not use the machine unattended.
- Confirm that the script, direction, limits, and physical setup are correct before use.
- Stop immediately if motion becomes unexpected, painful, unstable, or mechanically abnormal.

## Known limitations

- Windows x64 only in the current release.
- Installer and executable are currently unsigned.
- The default Electron icon is used in this release candidate.
- HereSphere playback rates other than `1.000x` are not supported.
- Bluetooth and firmware behavior can vary between PCs and OSSM firmware versions.
- Extremely fast full-stroke script segments may exceed the physical capability of the machine even when every command is transmitted correctly.

## Troubleshooting

### HereSphere is not detected

- Confirm that the PC and HereSphere device are on the same local network.
- Confirm that HereSphere is running.
- Use **Search now**.
- Check Windows Firewall if prompted.
- Avoid guest Wi-Fi or client-isolated networks that block communication between devices.

### The funscript is not found

- Confirm that the correct repository folder is selected.
- Click **Refresh** after adding or renaming scripts.
- Confirm that the video and funscript base names match.
- Check for duplicate matching filenames in different subfolders.
- Load the file manually to test it.

### The OSSM is not shown

- Confirm that Bluetooth is enabled.
- Confirm that the OSSM is powered on and not already connected to another application or device.
- Close other OSSM, Intiface, or Bluetooth-control applications.
- Confirm that the firmware exposes the native OSSM BLE service.
- Restart Bluetooth or power-cycle the OSSM if necessary.

### Motion feels reversed

Toggle `Reverse`. The setting is remembered.

### Motion feels consistently early or late

Adjust the time offset in 5 ms steps. Keep the same script and other settings while comparing.

### A problem needs investigation

Enable diagnostic logs before reproducing the issue, then use **Open log folder** and share the generated files with the developer or community support contact.

## Credits

Created by **IOmat** for the OSSM community.

The application uses the native OSSM Streaming approach and a funscript scheduling model based on public work and reference behavior published by **Research & Desire**. Research & Desire, OSSM, HereSphere, and other product names remain the property of their respective owners.

This is an independent community project and is not officially affiliated with or endorsed by Research & Desire or HereSphere.

See [NOTICE.md](NOTICE.md) and [NO_LICENSE.md](NO_LICENSE.md) before redistributing, repackaging, modifying, or selling this project.
