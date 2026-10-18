# Tweak catalog contract and evidence limits

This catalog contains 59 distinct, free Windows settings (52 registry preferences/policies and 7 active-plan AC power options), rather than paid unlocks or numbered aliases. Related registry values that implement one visible setting are grouped as one tweak. `catalog.json` is the single source shared by the renderer and `tweaks.cjs`. All entries are data; only the native backend may apply them after review and backup. Both profiles intentionally omit experimental latency folklore, power tuning, browser policies, global notification blocking and accessibility changes.

The target is an Intel Core i5-14600, GeForce RTX 3060 and 32 GB RAM. This is a target profile, not evidence of detected hardware. The scanner must obtain actual hardware from Windows and must not invent temperatures, clock speeds, benchmarks, polling rates, input latency or FPS gains. A custom Windows installation may have already applied preferences, removed components or prevented policy changes. A registry write alone is not evidence that a component supports or honors a preference.

## Runtime eligibility and backup

- All entries require Windows 10 build 19041 or later unless a stricter `minBuild` or `maxBuild` is provided. Windows 11 Widgets and Windows 10 News and interests are mutually exclusive alternatives, not two settings to apply to one OS. Search highlights and Explorer cloud recommendations have explicit minimum builds.
- `requiresPath` means the registry path must exist before the tweak can be offered as supported. Browser settings deliberately require a detected machine-wide installation; a user-only installation may be skipped conservatively.
- Registry targets specify exact types and desired values. Back up existence, previous type, previous raw value, and newly created keys. Undo must restore the previous value/type, or remove a value that did not previously exist. Never recursively delete an unrelated parent key during undo.
- Power settings address the active plan and its AC value only. Back up the exact plan GUID and previous AC index, and restore that original plan's index. Do not touch battery/DC values. If a setting is not exposed on the machine, skip it and give a reason.
- Do not overwrite the first pre-apply backup when a user clicks Apply again. Indicate entries already at the desired state. Restore access to every successful partial change if a later operation fails.
- Many user interface registry preferences are cached. Their `signout` marker is deliberate: do not promise immediate application or forcibly log out the user.
- Enterprise/domain management may override local policies. Never change policy permissions or bypass management to force a tweak.

## What the changes can and cannot do

Game Mode and disabling unwanted game capture can remove competing work in specific conditions. Individual results require actual before/after frame-time measurements under the same game, resolution and workload. Cosmetic preferences primarily affect the Windows desktop. Personalization/history controls are privacy choices; they are not asserted to increase FPS.

CS2 uses raw mouse input. Windows Enhance pointer precision, cursor trails and menu/key-repeat settings must never be described as a fix for CS2 raw-input latency. USB selective suspend changes idle-device behavior; it does not increase polling rate. CPU, USB and PCIe AC options are optional because they can increase idle power, temperature and fan noise or worsen sustained performance under thermal limits. The catalog does not overclock, set RTX driver options or alter hybrid-core scheduling.

No setting disables Microsoft Defender, Windows Firewall, Windows Update, mitigations, driver signature enforcement, secure boot, encryption or security notifications. The catalog contains no HPET/BCD timer changes, IRQ changes, TCP/Nagle or network-reset folklore, GPU registry hacks, MSI-mode guesses, page-file disabling, undocumented scheduler values, blanket service disabling or AppX package removal.

Disabling update peer sharing keeps Windows Update and Store downloads enabled using HTTP delivery; it is not a general network bandwidth limit. Disabling app toasts, Store background activity, cloud clipboard/history or accessibility features has real usability tradeoffs and therefore is not included in a one-click recommended profile.

## Reference material

These are authoritative documentation entry points for reviewing Windows behavior. Network access to Microsoft Learn was blocked by the environment proxy during implementation (HTTP tunnel 403), so the implementation does not claim live documentation retrieval or Windows runtime verification in the Linux build workspace.

- [Windows Game DVR policy](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-gamedvr)
- [Windows Experience policies](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-experience)
- [Windows Search policies](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-search)
- [App privacy policies](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-privacy)
- [Clipboard and other ADMX system policies](https://learn.microsoft.com/en-us/windows/client-management/mdm/policy-csp-admx-system)
- [Delivery Optimization reference](https://learn.microsoft.com/en-us/windows/deployment/do/waas-delivery-optimization-reference)
- [Processor energy performance preference](https://learn.microsoft.com/en-us/windows-hardware/customize/power-settings/options-for-perf-state-engine-perfenergyperformancepreference)
- [Processor boost mode](https://learn.microsoft.com/en-us/windows-hardware/customize/power-settings/options-for-perf-state-engine-perfboostmode)
- [USB selective suspend](https://learn.microsoft.com/en-us/windows-hardware/drivers/usbcon/usb-selective-suspend)
- [Windows accessibility flag constants](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-systemparametersinfoa)
- [Edge background mode](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/backgroundmodeenabled)
- [Edge startup boost](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/startupboostenabled)
- [Chrome background mode policy](https://chromeenterprise.google/policies/#BackgroundModeEnabled)

Some long-standing per-user preference registry values are implementation details rather than a stable documented configuration API. Entries state that limitation where relevant and must be verified on the user's actual Windows build. Future Windows servicing can retire a feed or preference; do not equate storing its value with proof that Windows visibly changed.
