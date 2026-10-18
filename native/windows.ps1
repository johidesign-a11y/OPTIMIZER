# Windows PowerShell 5.1 bridge. One JSON request on stdin; one JSON response on stdout.
[CmdletBinding()]
param()
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$script:DataDir = $null
$script:Lock = $null

function Has-Property($Object, [string]$Name) {
    return ($null -ne $Object -and $null -ne $Object.PSObject.Properties[$Name])
}
function Get-Property($Object, [string]$Name, $Default = $null) {
    if (Has-Property $Object $Name) { return $Object.$Name }
    return $Default
}
function Assert-Approved($Payload) {
    if ((Get-Property $Payload 'approved' $false) -ne $true) {
        throw 'Review this operation in the app and explicitly approve it before changes can be made.'
    }
}
function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Assert-Administrator {
    if (-not (Test-Administrator)) { throw 'Administrator access is required. Relaunch the optimizer as administrator and try again.' }
}
function Initialize-DataDir([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { throw 'The desktop app did not provide its private backup directory.' }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $allowed = $false
    foreach ($root in @([Environment]::GetFolderPath('LocalApplicationData'), [Environment]::GetFolderPath('ApplicationData'))) {
        if ($root -and $full.StartsWith(($root.TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) { $allowed = $true }
    }
    if (-not $allowed) { throw 'Backups must be stored in the app directory under the current user AppData folder.' }
    $script:DataDir = $full
    [void][IO.Directory]::CreateDirectory($full)
    [void][IO.Directory]::CreateDirectory((Join-Path $full 'transactions'))
    [void][IO.Directory]::CreateDirectory((Join-Path $full 'cs2'))
}
function Enter-OperationLock {
    try { $script:Lock = [IO.File]::Open((Join-Path $script:DataDir 'operation.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { throw 'Another optimizer operation is running. Wait for it to finish before trying again.' }
}
function Save-Json([string]$Path, $Value) {
    $temporary = $Path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    $json = ConvertTo-Json -InputObject $Value -Depth 40 -Compress
    $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($json)
    $stream = [IO.File]::Open($temporary, 'CreateNew', 'Write', 'None')
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) }
    finally { $stream.Dispose() }
    if ([IO.File]::Exists($Path)) {
        try { [IO.File]::Replace($temporary, $Path, [System.Management.Automation.Language.NullString]::Value) }
        catch { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }; throw }
    } else { [IO.File]::Move($temporary, $Path) }
}
function Get-TransactionPath([string]$Id) {
    if ($Id -notmatch '^[a-f0-9]{32}$') { throw 'Invalid backup identifier.' }
    return Join-Path (Join-Path $script:DataDir 'transactions') ($Id + '.json')
}
function Get-Transactions {
    $items = @()
    foreach ($file in @(Get-ChildItem -LiteralPath (Join-Path $script:DataDir 'transactions') -Filter '*.json' -File)) {
        try {
            $entry = [IO.File]::ReadAllText($file.FullName) | ConvertFrom-Json
            if ((Get-Property $entry 'id' '') -match '^[a-f0-9]{32}$') { $items += $entry }
        } catch { throw ('A backup journal cannot be read: ' + $file.Name + '. Preserve the file and repair it before applying more changes.') }
    }
    return @($items | Sort-Object -Property createdAt -Descending)
}
function Get-History {
    return @(Get-Transactions | ForEach-Object {
        [pscustomobject]@{
            id = $_.id; createdAt = $_.createdAt; status = $_.status
            tweakIds = @($_.tweakIds); restoredAt = (Get-Property $_ 'restoredAt')
            errors = @(Get-Property $_ 'errors' @()); restorePoint = (Get-Property $_ 'restorePoint')
        }
    })
}
function Get-AppliedIds {
    $ids = @()
    foreach ($entry in @(Get-Transactions)) {
        if ($entry.status -in @('restored', 'rolledBack')) { continue }
        foreach ($operation in @($entry.operations)) {
            if ($operation.status -in @('applied', 'applying', 'rollbackFailed', 'restoreFailed')) { $ids += $operation.tweakId }
        }
    }
    return @($ids | Sort-Object -Unique)
}
function Invoke-PowerCfg([string[]]$Arguments) {
    $output = @(& "$env:SystemRoot\System32\powercfg.exe" @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) { throw ('Windows rejected the power setting: ' + (($output | Out-String).Trim())) }
    return ($output | Out-String)
}
function Assert-Guid([string]$Value) {
    $parsed = [Guid]::Empty
    if (-not [Guid]::TryParse($Value, [ref]$parsed)) { throw 'A power setting has an invalid identifier.' }
}
function Get-ActivePowerScheme {
    $output = Invoke-PowerCfg @('/getactivescheme')
    $match = [regex]::Match($output, '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')
    if (-not $match.Success) { throw 'Windows did not report the active power plan.' }
    return $match.Value
}
function Get-PowerSnapshot($Setting, [string]$Scheme) {
    Assert-Guid $Setting.subgroup; Assert-Guid $Setting.setting
    # /query accepts scheme and subgroup; query the group and isolate the exact setting.
    # /qh exposes settings hidden by the Windows control panel without unhiding them.
    $output = Invoke-PowerCfg @('/query', $Scheme, $Setting.subgroup)
    if ($output.IndexOf($Setting.setting, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        $output = Invoke-PowerCfg @('/qh', $Scheme, $Setting.subgroup)
    }
    $block = ''; $reading = $false
    foreach ($line in @($output -split '\r?\n')) {
        if ($line.IndexOf($Setting.setting, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $reading = $true }
        elseif ($reading -and $line -match '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}') { break }
        if ($reading) { $block += $line + "`n" }
    }
    $indexes = [regex]::Matches($block, '0x([0-9a-fA-F]{8})')
    if ($indexes.Count -lt 2) { throw 'This power setting is not exposed by your Windows installation.' }
    return [pscustomobject]@{
        scheme = $Scheme; subgroup = $Setting.subgroup; setting = $Setting.setting
        ac = [Convert]::ToUInt32($indexes[$indexes.Count - 2].Groups[1].Value, 16)
        dc = [Convert]::ToUInt32($indexes[$indexes.Count - 1].Groups[1].Value, 16)
    }
}
function Get-RegParts([string]$Path) {
    if ($Path -notmatch '^(HKCU|HKLM):\\(.+)$' -or $Path.Contains('..')) { throw 'A registry target is outside the supported registry roots.' }
    $hive = $Matches[1]; $subpath = $Matches[2].TrimEnd('\')
    if ($hive -eq 'HKCU') { $base = [Microsoft.Win32.Registry]::CurrentUser }
    else { $base = [Microsoft.Win32.Registry]::LocalMachine }
    return [pscustomobject]@{ base = $base; subpath = $subpath; hive = $hive }
}
function Get-RegistrySnapshot($Target) {
    $parts = Get-RegParts $Target.path
    $key = $parts.base.OpenSubKey($parts.subpath, $false)
    $missing = @(); $cursor = $parts.subpath
    while ($cursor) {
        $parent = $parts.base.OpenSubKey($cursor, $false)
        if ($null -ne $parent) { $parent.Dispose(); break }
        $missing += ($parts.hive + ':\' + $cursor)
        $separator = $cursor.LastIndexOf('\')
        if ($separator -lt 0) { break }; $cursor = $cursor.Substring(0, $separator)
    }
    $exists = $false; $kind = $null; $value = $null
    if ($null -ne $key) {
        try {
            $exists = @($key.GetValueNames()) -contains [string]$Target.name
            if ($exists) {
                $kind = $key.GetValueKind([string]$Target.name).ToString()
                $raw = $key.GetValue([string]$Target.name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
                if ($kind -in @('Binary', 'None')) { $value = [Convert]::ToBase64String([byte[]]$raw) }
                elseif ($kind -eq 'QWord') { $value = [string]$raw }
                elseif ($kind -eq 'MultiString') { $value = @([string[]]$raw) }
                else { $value = $raw }
            }
        } finally { $key.Dispose() }
    }
    return [pscustomobject]@{ path = $Target.path; name = $Target.name; exists = $exists; kind = $kind; value = $value; absentKeys = @($missing) }
}
function Test-RegistryMatches($Snapshot, $Target) {
    if (-not $Snapshot.exists -or $Snapshot.kind -ne $Target.type) { return $false }
    switch ($Target.type) {
        'DWord' {
            [decimal]$before = $Snapshot.value; [decimal]$desired = $Target.value
            if ($before -lt 0) { $before += 4294967296 }
            if ($desired -lt 0) { $desired += 4294967296 }
            return ($before -eq $desired)
        }
        'String' { return [string]::Equals([string]$Snapshot.value, [string]$Target.value, [StringComparison]::Ordinal) }
        'Binary' { return ([string]$Snapshot.value -ceq [Convert]::ToBase64String([byte[]]$Target.value)) }
    }
    return $false
}
function Set-RegistryValue([string]$Path, [string]$Name, [string]$Kind, $Value, [bool]$FromSnapshot = $false) {
    $parts = Get-RegParts $Path
    $key = $parts.base.CreateSubKey($parts.subpath, $true)
    try {
        $registryKind = [Microsoft.Win32.RegistryValueKind]::$Kind
        switch ($Kind) {
            'DWord' {
                if ([long]$Value -gt [int]::MaxValue) { $converted = [BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]$Value), 0) }
                else { $converted = [int]$Value }
            }
            'QWord' { $converted = [long]$Value }
            'Binary' {
                if ($FromSnapshot) { $converted = [Convert]::FromBase64String([string]$Value) }
                else { $converted = [byte[]]$Value }
            }
            'None' { $converted = [Convert]::FromBase64String([string]$Value) }
            'MultiString' { $converted = [string[]]$Value }
            default { $converted = [string]$Value }
        }
        $key.SetValue($Name, $converted, $registryKind)
    } finally { $key.Dispose() }
}
function Restore-RegistryValue($Snapshot) {
    if ($Snapshot.exists) { Set-RegistryValue $Snapshot.path $Snapshot.name $Snapshot.kind $Snapshot.value $true; return }
    $parts = Get-RegParts $Snapshot.path
    $key = $parts.base.OpenSubKey($parts.subpath, $true)
    if ($null -ne $key) { try { $key.DeleteValue([string]$Snapshot.name, $false) } finally { $key.Dispose() } }
    # Remove only empty keys introduced by this transaction, deepest first.
    foreach ($path in @($Snapshot.absentKeys)) {
        $part = Get-RegParts $path
        $candidate = $part.base.OpenSubKey($part.subpath, $false)
        if ($null -eq $candidate) { continue }
        try { $empty = ($candidate.SubKeyCount -eq 0 -and $candidate.ValueCount -eq 0) }
        finally { $candidate.Dispose() }
        if ($empty) { $part.base.DeleteSubKey($part.subpath, $false) }
    }
}
function Get-ServiceSnapshot($ServiceSetting) {
    if ($ServiceSetting.name -notmatch '^[a-zA-Z0-9_.-]+$') { throw 'Invalid Windows service name.' }
    $service = Get-CimInstance -ClassName Win32_Service -Filter ("Name='" + $ServiceSetting.name + "'")
    if ($null -eq $service) { throw ('Windows service is unavailable: ' + $ServiceSetting.name) }
    $delayed = Get-ItemProperty -LiteralPath ('HKLM:\SYSTEM\CurrentControlSet\Services\' + $ServiceSetting.name) -Name DelayedAutoStart -ErrorAction SilentlyContinue
    return [pscustomobject]@{ name = $service.Name; startMode = $service.StartMode; delayed = [bool](Get-Property $delayed 'DelayedAutoStart' 0) }
}
function Get-RestorePointCreatedAt($Point) {
    $value = $Point.CreationTime
    if ($value -is [DateTime]) { return $value.ToUniversalTime() }
    return [Management.ManagementDateTimeConverter]::ToDateTime([string]$value).ToUniversalTime()
}
function New-NativeRestorePoint {
    Assert-Administrator
    if (-not (Get-Command Checkpoint-Computer -ErrorAction SilentlyContinue)) { throw 'Windows System Restore is unavailable on this installation. No tweaks were applied.' }
    $savedPath = Join-Path $script:DataDir 'restore-point.json'
    # Reuse only our own recent checkpoint after Windows confirms it still exists.
    # Each batch still receives a separate exact setting snapshot.
    if ([IO.File]::Exists($savedPath)) {
        try {
            $saved = [IO.File]::ReadAllText($savedPath) | ConvertFrom-Json
            $recent = @(Get-ComputerRestorePoint -ErrorAction Stop | Where-Object { $_.SequenceNumber -eq $saved.sequenceNumber -and $_.Description -eq $saved.description })
            if ($recent.Count -gt 0) {
                $createdAt = Get-RestorePointCreatedAt $recent[-1]
                $age = [DateTime]::UtcNow - $createdAt
                if ($age.TotalHours -ge 0 -and $age.TotalHours -lt 24 -and $saved.description -match '^OPTIMIZER [a-f0-9]{32}$') {
                    return [pscustomobject]@{ sequenceNumber = $saved.sequenceNumber; description = $saved.description; createdAt = $createdAt.ToString('o'); reused = $true }
                }
            }
        } catch { } # An unverifiable cache is never a reason to bypass point creation.
    }
    $description = 'OPTIMIZER ' + [Guid]::NewGuid().ToString('N')
    try {
        Checkpoint-Computer -Description $description -RestorePointType MODIFY_SETTINGS -ErrorAction Stop -WarningAction SilentlyContinue
        $created = @(Get-ComputerRestorePoint -ErrorAction Stop | Where-Object { $_.Description -eq $description })
        if ($created.Count -eq 0) { throw 'Windows did not create a new verified restore point.' }
        $point = [pscustomobject]@{ sequenceNumber = $created[-1].SequenceNumber; description = $description; createdAt = (Get-RestorePointCreatedAt $created[-1]).ToString('o'); reused = $false }
        Save-Json $savedPath $point
        return $point
    } catch {
        throw ('A new Windows restore point could not be verified. No tweaks were applied. Your custom Windows may disable System Protection, or Windows may be enforcing its restore-point frequency limit. Enable System Protection or wait for that limit before retrying. Details: ' + $_.Exception.Message)
    }
}
function Get-RestoreSupport {
    $available = $false; $status = 'unverified'
    try {
        $command = Get-Command Checkpoint-Computer -ErrorAction SilentlyContinue
        $vss = Get-Service -Name VSS -ErrorAction Stop
        $policy = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\SystemRestore' -ErrorAction SilentlyContinue
        $available = ($null -ne $command -and $vss.StartType -ne 'Disabled' -and (Get-Property $policy 'DisableSR' 0) -ne 1)
        if (-not $available) { $status = 'unavailable' }
    } catch { $status = 'unavailable' }
    return [pscustomobject]@{ available = $available; status = $status }
}
function New-TweakOperations($Ids, $Catalog) {
    $operations = @(); $scheme = $null; $skipped = @(); $accepted = @()
    $build = [int](Get-CimInstance Win32_OperatingSystem).BuildNumber
    $uniqueIds = @($Ids | Select-Object -Unique)
    if ($uniqueIds.Count -eq 0) { throw 'Select at least one tweak.' }
    if ($uniqueIds.Count -gt 150) { throw 'Too many tweaks requested at once.' }
    :tweakLoop foreach ($id in $uniqueIds) {
        $matches = @($Catalog | Where-Object { $_.id -eq $id })
        if ($matches.Count -ne 1) { throw ('Unknown tweak: ' + $id) }
        $tweak = $matches[0]
        $applicability = Get-Property $tweak 'applicability' $tweak
        $reason = $null
        if ((Has-Property $applicability 'minBuild') -and $build -lt [int]$applicability.minBuild) { $reason = 'This tweak requires a newer Windows build.' }
        if ((Has-Property $applicability 'maxBuild') -and $build -gt [int]$applicability.maxBuild) { $reason = 'This tweak does not apply to this Windows build.' }
        if ((Has-Property $applicability 'requiresPath') -and -not (Test-Path -LiteralPath $applicability.requiresPath)) { $reason = 'The application or Windows component for this tweak is not installed.' }
        if ($reason) { $skipped += [pscustomobject]@{ id = $id; reason = $reason }; continue tweakLoop }
        $beforeCount = $operations.Count
        switch ($tweak.kind) {
            'registry' {
                foreach ($target in @($tweak.targets)) {
                    if ($target.type -notin @('DWord', 'String', 'Binary')) { throw 'Unsupported tweak registry value type.' }
                    $registryBefore = Get-RegistrySnapshot $target
                    if (Test-RegistryMatches $registryBefore $target) { continue }
                    $operations += [pscustomobject]@{ tweakId = $id; kind = 'registry'; target = $target; before = $registryBefore; status = 'pending'; error = $null }
                }
            }
            'power' {
                if ($null -eq $scheme) { $scheme = Get-ActivePowerScheme }
                try { $powerBefore = Get-PowerSnapshot $tweak.power $scheme }
                catch { $skipped += [pscustomobject]@{ id = $id; reason = ('This power setting is unavailable: ' + $_.Exception.Message) }; continue tweakLoop }
                $powerMatches = ([decimal]$powerBefore.ac -eq [decimal]$tweak.power.ac)
                if (Has-Property $tweak.power 'dc') { $powerMatches = ($powerMatches -and [decimal]$powerBefore.dc -eq [decimal]$tweak.power.dc) }
                if (-not $powerMatches) { $operations += [pscustomobject]@{ tweakId = $id; kind = 'power'; target = $tweak.power; before = $powerBefore; status = 'pending'; error = $null } }
            }
            'service' {
                if ($tweak.service.startup -notin @('Manual', 'Disabled')) { throw 'Unsupported service startup choice.' }
                $operations += [pscustomobject]@{ tweakId = $id; kind = 'service'; target = $tweak.service; before = (Get-ServiceSnapshot $tweak.service); status = 'pending'; error = $null }
            }
            default { throw 'Unsupported tweak operation.' }
        }
        if ($operations.Count -eq $beforeCount) { $skipped += [pscustomobject]@{ id = $id; reason = 'Already matches selected setting'; alreadyMatches = $true } }
        else { $accepted += $id }
    }
    return [pscustomobject]@{ operations = @($operations); skipped = @($skipped); acceptedIds = @($accepted) }
}
function Invoke-TweakOperation($Operation) {
    switch ($Operation.kind) {
        'registry' { Set-RegistryValue $Operation.target.path $Operation.target.name $Operation.target.type $Operation.target.value }
        'power' {
            [void](Invoke-PowerCfg @('/setacvalueindex', $Operation.before.scheme, $Operation.target.subgroup, $Operation.target.setting, [string]$Operation.target.ac))
            if (Has-Property $Operation.target 'dc') { [void](Invoke-PowerCfg @('/setdcvalueindex', $Operation.before.scheme, $Operation.target.subgroup, $Operation.target.setting, [string]$Operation.target.dc)) }
            [void](Invoke-PowerCfg @('/setactive', $Operation.before.scheme))
        }
        'service' { Set-Service -Name $Operation.target.name -StartupType $Operation.target.startup }
    }
}
function Undo-TweakOperation($Operation) {
    switch ($Operation.kind) {
        'registry' { Restore-RegistryValue $Operation.before }
        'power' {
            [void](Invoke-PowerCfg @('/setacvalueindex', $Operation.before.scheme, $Operation.before.subgroup, $Operation.before.setting, [string]$Operation.before.ac))
            if (Has-Property $Operation.target 'dc') { [void](Invoke-PowerCfg @('/setdcvalueindex', $Operation.before.scheme, $Operation.before.subgroup, $Operation.before.setting, [string]$Operation.before.dc)) }
            [void](Invoke-PowerCfg @('/setactive', $Operation.before.scheme))
        }
        'service' {
            $mode = switch ($Operation.before.startMode) { 'Auto' { 'Automatic' }; 'Manual' { 'Manual' }; 'Disabled' { 'Disabled' }; default { throw 'Unknown previous service mode.' } }
            Set-Service -Name $Operation.before.name -StartupType $mode
            if ($mode -eq 'Automatic' -and $Operation.before.delayed) {
                $ignored = & "$env:SystemRoot\System32\sc.exe" config $Operation.before.name 'start=' 'delayed-auto' 2>&1
                if ($LASTEXITCODE -ne 0) { throw 'Could not restore delayed automatic service startup.' }
            }
        }
    }
}
function Apply-Tweaks($Payload, $Catalog) {
    Assert-Approved $Payload; Assert-Administrator
    if ((Get-Property $Payload 'createRestorePoint' $true) -ne $true) { throw 'A verified Windows restore point is mandatory before applying tweaks.' }
    $pending = @(Get-Transactions | Where-Object { $_.status -in @('prepared', 'applying', 'rollingBack', 'partial', 'restoring', 'restoreFailed') })
    if ($pending.Count -gt 0) { throw 'A previous operation needs recovery. Restore its backup before applying more tweaks.' }
    $prepared = New-TweakOperations (Get-Property $Payload 'ids' @()) $Catalog
    $operations = @($prepared.operations)
    if ($operations.Count -eq 0) { return @{ ok = $true; changedCount = 0; message = 'No setting changes were needed. Review skipped entries for existing settings or compatibility details.'; appliedIds = @(Get-AppliedIds); history = @(Get-History); skipped = @($prepared.skipped) } }
    $restorePoint = New-NativeRestorePoint
    $transaction = [pscustomobject]@{
        id = [Guid]::NewGuid().ToString('N'); createdAt = [DateTime]::UtcNow.ToString('o')
        status = 'prepared'; tweakIds = @($prepared.acceptedIds)
        restorePoint = $restorePoint; operations = $operations; errors = @(); restoredAt = $null
    }
    $path = Get-TransactionPath $transaction.id
    # All prior values and absent keys are durable before the first system setting changes.
    Save-Json $path $transaction
    try {
        $transaction.status = 'applying'; Save-Json $path $transaction
        foreach ($operation in $transaction.operations) {
            $operation.status = 'applying'; Save-Json $path $transaction
            Invoke-TweakOperation $operation
            $operation.status = 'applied'; Save-Json $path $transaction
        }
        $transaction.status = 'applied'; Save-Json $path $transaction
        return @{ ok = $true; changedCount = @($prepared.acceptedIds).Count; backupId = $transaction.id; restorePoint = $restorePoint; appliedIds = @(Get-AppliedIds); history = @(Get-History); skipped = @($prepared.skipped) }
    } catch {
        $reason = $_.Exception.Message
        $transaction.errors += $reason; $transaction.status = 'rollingBack'; Save-Json $path $transaction
        for ($i = $transaction.operations.Count - 1; $i -ge 0; $i--) {
            $operation = $transaction.operations[$i]
            if ($operation.status -notin @('applied', 'applying')) { continue }
            try { Undo-TweakOperation $operation; $operation.status = 'rolledBack' }
            catch { $operation.status = 'rollbackFailed'; $operation.error = $_.Exception.Message; $transaction.errors += $_.Exception.Message }
            Save-Json $path $transaction
        }
        $remaining = @($transaction.operations | Where-Object { $_.status -eq 'rollbackFailed' })
        if ($remaining.Count -gt 0) { $transaction.status = 'partial'; $reason += ' Some changes could not be rolled back. Restore this backup before continuing.' }
        else { $transaction.status = 'rolledBack'; $reason += ' Any changes already made were rolled back.' }
        Save-Json $path $transaction
        return @{ ok = $false; error = $reason; backupId = $transaction.id; appliedIds = @(Get-AppliedIds); history = @(Get-History); skipped = @($prepared.skipped) }
    }
}
function Restore-Tweaks($Payload) {
    Assert-Approved $Payload; Assert-Administrator
    $active = @(Get-Transactions | Where-Object { $_.status -notin @('restored', 'rolledBack') })
    if ($active.Count -eq 0) { throw 'There are no tweak backups to restore.' }
    $id = [string](Get-Property $Payload 'id' (Get-Property $Payload 'backupId' $active[0].id))
    if ($id -ne $active[0].id) { throw 'Restore the newest active backup first so newer changes are not overwritten.' }
    $path = Get-TransactionPath $id; $transaction = $active[0]
    $transaction.status = 'restoring'; Save-Json $path $transaction
    $errors = @()
    for ($i = $transaction.operations.Count - 1; $i -ge 0; $i--) {
        $operation = $transaction.operations[$i]
        if ($operation.status -in @('pending', 'restored', 'rolledBack')) { continue }
        try { Undo-TweakOperation $operation; $operation.status = 'restored'; $operation.error = $null }
        catch { $operation.status = 'restoreFailed'; $operation.error = $_.Exception.Message; $errors += $_.Exception.Message }
        Save-Json $path $transaction
    }
    if ($errors.Count -eq 0) { $transaction.status = 'restored'; $transaction.restoredAt = [DateTime]::UtcNow.ToString('o') }
    else { $transaction.status = 'restoreFailed'; $transaction.errors += $errors }
    Save-Json $path $transaction
    return @{ ok = ($errors.Count -eq 0); error = $(if ($errors.Count) { $errors -join '; ' } else { $null }); appliedIds = @(Get-AppliedIds); history = @(Get-History); backupId = $id }
}
function Get-RegistryVram([string]$Name) {
    try {
        foreach ($adapter in @(Get-ChildItem -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Video' -ErrorAction SilentlyContinue)) {
            $properties = Get-ItemProperty -LiteralPath ($adapter.PSPath + '\0000') -ErrorAction SilentlyContinue
            if ($null -eq $properties -or (Get-Property $properties 'DriverDesc' '') -ne $Name) { continue }
            $memory = Get-Property $properties 'HardwareInformation.qwMemorySize'
            if ($null -ne $memory) {
                if ($memory -is [byte[]]) { if ($memory.Length -ge 8) { return [BitConverter]::ToUInt64($memory, 0) } }
                elseif ([decimal]$memory -gt 0) { return [decimal]$memory }
            }
        }
    } catch { }
    return $null
}
function Scan-PC {
    $cpu = @(Get-CimInstance Win32_Processor)
    $system = Get-CimInstance Win32_ComputerSystem
    $os = Get-CimInstance Win32_OperatingSystem
    $board = @(Get-CimInstance Win32_BaseBoard)[0]
    $bios = Get-CimInstance Win32_BIOS
    $controllers = @(Get-CimInstance Win32_VideoController)
    $gpu = @($controllers | ForEach-Object {
        # AdapterRAM is a UInt32 field and truncates modern VRAM. Never label it exact.
        [pscustomobject]@{ name = $_.Name; driverVersion = $_.DriverVersion; pnpDeviceId = $_.PNPDeviceID; vramBytes = (Get-RegistryVram $_.Name); vramSource = 'driver-registry-or-unavailable' }
    })
    $memory = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object {
        [pscustomobject]@{ manufacturer = $_.Manufacturer; partNumber = ([string]$_.PartNumber).Trim(); capacityBytes = [decimal]$_.Capacity; speedMhz = $_.Speed; configuredSpeedMhz = $_.ConfiguredClockSpeed; slot = $_.DeviceLocator }
    })
    $disks = @(Get-CimInstance Win32_DiskDrive | ForEach-Object {
        [pscustomobject]@{ model = $_.Model; sizeBytes = [decimal]$_.Size; interfaceType = $_.InterfaceType; mediaType = $_.MediaType }
    })
    $network = @(Get-CimInstance Win32_NetworkAdapter -Filter 'PhysicalAdapter=True' | ForEach-Object {
        [pscustomobject]@{ name = $_.Name; macAddress = $_.MACAddress; speedBps = $_.Speed; status = $_.NetConnectionStatus }
    })
    $monitors = @($controllers | Where-Object { $_.CurrentHorizontalResolution } | ForEach-Object {
        [pscustomobject]@{ name = $_.Name; width = $_.CurrentHorizontalResolution; height = $_.CurrentVerticalResolution; refreshRate = $_.CurrentRefreshRate }
    })
    $storage = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
        [pscustomobject]@{ drive = $_.DeviceID; totalBytes = [decimal]$_.Size; freeBytes = [decimal]$_.FreeSpace }
    })
    return @{
        ok = $true; mode = 'windows'; scannedAt = [DateTime]::UtcNow.ToString('o')
        cpu = @{ name = ($cpu.Name -join ' / '); cores = ($cpu | Measure-Object NumberOfCores -Sum).Sum; logicalProcessors = ($cpu | Measure-Object NumberOfLogicalProcessors -Sum).Sum; maxClockMhz = $cpu[0].MaxClockSpeed }
        gpu = $gpu; memory = @{ totalBytes = [decimal]$system.TotalPhysicalMemory; slots = $memory }
        os = @{ name = $os.Caption; version = $os.Version; build = $os.BuildNumber; architecture = $os.OSArchitecture }
        board = @{ manufacturer = $board.Manufacturer; product = $board.Product }
        bios = @{ manufacturer = $bios.Manufacturer; version = ($bios.SMBIOSBIOSVersion); releaseDate = [string]$bios.ReleaseDate }
        disks = $disks; network = $network; monitors = $monitors; storage = $storage
    }
}
function Get-CleanupRoots {
    # Fixed OS/user roots only. Renderer paths and file inventories are never accepted.
    $roots = @([pscustomobject]@{ id = 'user-temp'; title = 'User temporary files'; path = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Temp') })
    $roots += [pscustomobject]@{ id = 'windows-temp'; title = 'Windows temporary files'; path = (Join-Path $env:SystemRoot 'Temp') }
    return $roots
}
function Test-ReparseFree([string]$Path) {
    $cursor = [IO.Path]::GetFullPath($Path)
    while ($cursor) {
        if ([IO.Directory]::Exists($cursor)) {
            $attributes = [IO.File]::GetAttributes($cursor)
            if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break }; $cursor = $parent
    }
    return $true
}
function Get-OldTempFiles([string]$Root) {
    $files = @(); $skipped = 0; $cutoff = [DateTime]::UtcNow.AddHours(-48)
    if (-not [IO.Directory]::Exists($Root)) { return [pscustomobject]@{ files = @(); skipped = 0 } }
    if (-not (Test-ReparseFree $Root)) { return [pscustomobject]@{ files = @(); skipped = 1 } }
    $queue = New-Object 'System.Collections.Generic.Queue[string]'; $queue.Enqueue($Root)
    while ($queue.Count -gt 0) {
        $directory = $queue.Dequeue()
        if (-not (Test-ReparseFree $directory)) { $skipped++; continue }
        try {
            foreach ($entry in @(Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop)) {
                if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $skipped++; continue }
                if ($entry.PSIsContainer) { $queue.Enqueue($entry.FullName) }
                elseif ($entry.LastWriteTimeUtc -lt $cutoff -and $entry.CreationTimeUtc -lt $cutoff) {
                    if ($entry.FullName.StartsWith($script:DataDir + '\', [StringComparison]::OrdinalIgnoreCase)) { continue }
                    $handle = $null
                    try {
                        $handle = [IO.File]::Open($entry.FullName, 'Open', 'Read', 'None')
                        $files += [pscustomobject]@{ path = $entry.FullName; bytes = [long]$entry.Length }
                    } catch { $skipped++ }
                    finally { if ($null -ne $handle) { $handle.Dispose() } }
                }
            }
        } catch { $skipped++ }
    }
    return [pscustomobject]@{ files = @($files); skipped = $skipped }
}
function Analyze-Cleanup {
    $categories = @(); [long]$total = 0
    foreach ($root in @(Get-CleanupRoots)) {
        $inventory = Get-OldTempFiles $root.path
        [long]$bytes = 0; foreach ($file in @($inventory.files)) { $bytes += $file.bytes }
        $total += $bytes
        $categories += [pscustomobject]@{ id = $root.id; title = $root.title; bytes = $bytes; fileCount = @($inventory.files).Count; skipped = $inventory.skipped }
    }
    return @{ ok = $true; categories = $categories; totalBytes = $total; minimumAgeHours = 48; irreversible = $true }
}
function Initialize-NativeCleanup {
    if ('OptimizerNative.TempFiles' -as [type]) { return }
    # Opening without delete-on-close lets us validate the resolved handle path before
    # marking that same file for deletion, even if an ancestor changed to a junction.
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace OptimizerNative {
  public static class TempFiles {
    [StructLayout(LayoutKind.Sequential)]
    private struct FileInfo {
      public uint Attributes;
      public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
      public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
      public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
      public uint VolumeSerialNumber, SizeHigh, SizeLow, NumberOfLinks, FileIndexHigh, FileIndexLow;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Disposition { [MarshalAs(UnmanagedType.U1)] public bool DeleteFile; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern uint GetFinalPathNameByHandleW(SafeFileHandle file, StringBuilder path, uint length, uint flags);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInfo information);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool SetFileInformationByHandle(SafeFileHandle file, int informationClass, ref Disposition information, uint size);
    private static DateTime ToUtc(System.Runtime.InteropServices.ComTypes.FILETIME time) {
      return DateTime.FromFileTimeUtc(((long)time.dwHighDateTime << 32) | (uint)time.dwLowDateTime);
    }
    private static string FinalPath(SafeFileHandle handle) {
      StringBuilder buffer = new StringBuilder(32768);
      uint length = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 0);
      if (length == 0 || length >= buffer.Capacity) return null;
      string path = buffer.ToString();
      if (path.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) return @"\\" + path.Substring(8);
      if (path.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase)) return path.Substring(4);
      return path;
    }
    public static bool IsExactFile(SafeFileHandle handle, string path) {
      FileInfo info;
      return GetFileInformationByHandle(handle, out info) && (info.Attributes & (0x10 | 0x400)) == 0 &&
        String.Equals(FinalPath(handle), Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase);
    }
    public static bool DeleteIfHashesMatch(string path, string[] hashes) {
      using (SafeFileHandle handle = CreateFileW(path, 0x80010000, 0, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero)) {
        if (handle.IsInvalid || !IsExactFile(handle, path)) return false;
        using (FileStream stream = new FileStream(handle, FileAccess.Read)) {
          if (stream.Length > 4194304) return false;
          string hash;
          using (System.Security.Cryptography.SHA256 sha = System.Security.Cryptography.SHA256.Create()) {
            hash = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
          }
          bool matches = false;
          foreach (string expected in hashes) if (String.Equals(hash, expected, StringComparison.Ordinal)) matches = true;
          if (!matches) return false;
          Disposition disposition = new Disposition(); disposition.DeleteFile = true;
          return SetFileInformationByHandle(handle, 4, ref disposition, (uint)Marshal.SizeOf(typeof(Disposition)));
        }
      }
    }
    public static bool DeleteCandidate(string path, string root, DateTime cutoffUtc, out long bytes) {
      bytes = 0;
      // DELETE | GENERIC_READ, no sharing, OPEN_EXISTING, OPEN_REPARSE_POINT.
      using (SafeFileHandle handle = CreateFileW(path, 0x80010000, 0, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero)) {
        if (handle.IsInvalid) return false;
        FileInfo info;
        if (!GetFileInformationByHandle(handle, out info) || (info.Attributes & (0x10 | 0x400)) != 0) return false;
        if (ToUtc(info.CreationTime) >= cutoffUtc || ToUtc(info.LastWriteTime) >= cutoffUtc) return false;
        string finalPath = FinalPath(handle);
        if (finalPath == null) return false;
        string approvedRoot = Path.GetFullPath(root).TrimEnd('\\') + @"\";
        if (!finalPath.StartsWith(approvedRoot, StringComparison.OrdinalIgnoreCase)) return false;
        Disposition disposition = new Disposition(); disposition.DeleteFile = true;
        if (!SetFileInformationByHandle(handle, 4, ref disposition, (uint)Marshal.SizeOf(typeof(Disposition)))) return false;
        bytes = ((long)info.SizeHigh << 32) | info.SizeLow;
        return true;
      }
    }
  }
}
'@
}
function Clean-TemporaryFiles($Payload) {
    Assert-Approved $Payload
    $ids = @(Get-Property $Payload 'categories' (Get-Property $Payload 'ids' @('user-temp')))
    if ($ids.Count -eq 0) { throw 'Select a temporary-file category first.' }
    if (@($ids | Where-Object { $_ -notin @('user-temp', 'windows-temp') }).Count -gt 0) { throw 'Unsupported cleanup category.' }
    if ($ids -contains 'windows-temp') { Assert-Administrator }
    Initialize-NativeCleanup
    [long]$bytes = 0; $removed = 0; $skipped = 0; $cutoff = [DateTime]::UtcNow.AddHours(-48)
    foreach ($root in @(Get-CleanupRoots | Where-Object { $ids -contains $_.id })) {
        $inventory = Get-OldTempFiles $root.path; $skipped += $inventory.skipped
        foreach ($file in @($inventory.files)) {
            try {
                if (-not (Test-ReparseFree ([IO.Path]::GetDirectoryName($file.path)))) { $skipped++; continue }
                [long]$size = 0
                if ([OptimizerNative.TempFiles]::DeleteCandidate($file.path, $root.path, $cutoff, [ref]$size)) { $bytes += $size; $removed++ }
                else { $skipped++ }
            } catch { $skipped++ }
        }
    }
    return @{ ok = $true; bytesRemoved = $bytes; filesRemoved = $removed; skipped = $skipped; irreversible = $true }
}
function Get-CS2Installation {
    $libraries = @()
    foreach ($key in @('HKCU:\Software\Valve\Steam', 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam', 'HKLM:\SOFTWARE\Valve\Steam')) {
        $properties = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
        foreach ($field in @('SteamPath', 'InstallPath')) {
            $path = [string](Get-Property $properties $field '')
            if ($path -and [IO.Directory]::Exists($path)) { $libraries += $path.Replace('/', '\') }
        }
    }
    foreach ($library in @($libraries | Select-Object -Unique)) {
        $vdf = Join-Path $library 'steamapps\libraryfolders.vdf'
        if ([IO.File]::Exists($vdf)) {
            $contents = [IO.File]::ReadAllText($vdf)
            foreach ($match in [regex]::Matches($contents, '"path"\s+"((?:\\.|[^"\\])*)"')) {
                $path = $match.Groups[1].Value.Replace('\\', '\').Replace('\/', '/')
                if ([IO.Directory]::Exists($path)) { $libraries += $path }
            }
        }
    }
    foreach ($library in @($libraries | Select-Object -Unique)) {
        $steamapps = Join-Path $library 'steamapps'
        $installDir = 'Counter-Strike Global Offensive'
        $manifest = Join-Path $steamapps 'appmanifest_730.acf'
        if ([IO.File]::Exists($manifest)) {
            $match = [regex]::Match([IO.File]::ReadAllText($manifest), '"installdir"\s+"([^"\r\n]+)"')
            if ($match.Success -and $match.Groups[1].Value -notmatch '[\\/:]' -and $match.Groups[1].Value -notin @('.', '..')) { $installDir = $match.Groups[1].Value }
        }
        $install = Join-Path (Join-Path $steamapps 'common') $installDir
        $game = Join-Path $install 'game\bin\win64\cs2.exe'
        if ([IO.File]::Exists($game)) {
            return [pscustomobject]@{ installed = $true; installPath = $install; autoexecPath = (Join-Path $install 'game\csgo\cfg\autoexec.cfg') }
        }
    }
    return [pscustomobject]@{ installed = $false; installPath = $null; autoexecPath = $null }
}
function Get-CS2Backups {
    $entries = @()
    foreach ($file in @(Get-ChildItem -LiteralPath (Join-Path $script:DataDir 'cs2') -Filter '*.json' -File)) {
        $entry = [IO.File]::ReadAllText($file.FullName) | ConvertFrom-Json
        $entries += $entry
    }
    return @($entries | Sort-Object createdAt -Descending)
}
function Get-BytesHash([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function Write-CS2Atomic([string]$Path, [byte[]]$Bytes, [string[]]$ExpectedHashes, [bool]$ExpectExists) {
    Initialize-NativeCleanup
    $temporary = $Path + '.optimizer-' + [Guid]::NewGuid().ToString('N') + '.tmp'
    $stage = $null; $lock = $null
    try {
        $stage = [IO.File]::Open($temporary, 'CreateNew', 'Write', 'None')
        $stage.Write($Bytes, 0, $Bytes.Length); $stage.Flush($true); $stage.Dispose(); $stage = $null
        if ($ExpectExists) {
            # ReplaceFileW needs READ and DELETE sharing; ordinary writers remain blocked.
            $lock = [IO.File]::Open($Path, 'Open', 'Read', 'Read, Delete')
            if ($lock.Length -gt 4194304 -or -not [OptimizerNative.TempFiles]::IsExactFile($lock.SafeFileHandle, $Path)) { throw 'The autoexec is too large, linked, or moved; it was left unchanged.' }
            $buffer = New-Object IO.MemoryStream
            try { $lock.CopyTo($buffer); $hash = Get-BytesHash $buffer.ToArray() } finally { $buffer.Dispose() }
            if ($ExpectedHashes -notcontains $hash) { throw 'The autoexec changed during approval. It was left unchanged; review and retry.' }
            [IO.File]::Replace($temporary, $Path, [System.Management.Automation.Language.NullString]::Value)
        } else {
            # Move is atomic and refuses to overwrite a file created since review.
            [IO.File]::Move($temporary, $Path)
        }
    } finally {
        if ($null -ne $lock) { $lock.Dispose() }
        if ($null -ne $stage) { $stage.Dispose() }
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}
function Scan-CS2 {
    $installation = Get-CS2Installation
    $managed = $false
    if ($installation.installed -and [IO.File]::Exists($installation.autoexecPath)) {
        $managed = [IO.File]::ReadAllText($installation.autoexecPath).Contains('// BEGIN OPTIMIZER MANAGED SETTINGS')
    }
    return @{ ok = $true; installed = $installation.installed; installPath = $installation.installPath; autoexecPath = $installation.autoexecPath; managed = $managed; backups = @(Get-CS2Backups); requiresAutoexec = $true; configPreview = (Get-CS2ManagedBlock); settings = @(@{ command = 'fps_max 300'; description = 'Caps game frame rate at 300 FPS as a conservative baseline. Benchmark frame times and use an appropriate sustainable cap for your display.' }, @{ command = 'fps_max_ui 60'; description = 'Caps menu frame rate at 60 FPS to reduce GPU load while using the menu.' }) }
}
function Get-CS2ManagedBlock {
    return "`r`n// BEGIN OPTIMIZER MANAGED SETTINGS`r`n// Conservative baseline; benchmark frame times on your system.`r`nfps_max 300`r`nfps_max_ui 60`r`n// END OPTIMIZER MANAGED SETTINGS`r`n"
}
function Set-CS2Profile($Payload) {
    Assert-Approved $Payload
    $installation = Get-CS2Installation
    if (-not $installation.installed) { throw 'Counter-Strike 2 was not found in your registered Steam libraries.' }
    $path = $installation.autoexecPath
    if (-not (Test-ReparseFree ([IO.Path]::GetDirectoryName($path)))) { throw 'The CS2 configuration directory uses a junction or symbolic link; automatic editing is unavailable.' }
    if (-not [IO.Directory]::Exists([IO.Path]::GetDirectoryName($path))) { throw 'The CS2 cfg directory is missing. Verify the game installation in Steam first.' }
    $existed = [IO.File]::Exists($path); $oldBytes = [byte[]]@(); $text = ''
    if ($existed) {
        $file = Get-Item -LiteralPath $path
        if (($file.Attributes -band ([IO.FileAttributes]::ReadOnly -bor [IO.FileAttributes]::ReparsePoint)) -ne 0) { throw 'The existing autoexec is read-only or linked; it was left unchanged.' }
        if ($file.Length -gt 4194304) { throw 'The autoexec is larger than 4 MiB. Automatic editing was stopped.' }
        $oldBytes = [IO.File]::ReadAllBytes($path)
        $text = [IO.File]::ReadAllText($path)
        if ($text.Contains('// BEGIN OPTIMIZER MANAGED SETTINGS') -or $text.Contains('// END OPTIMIZER MANAGED SETTINGS')) { throw 'An optimizer-managed block already exists. Restore its backup before applying another profile.' }
        # Preserve existing user choices, including commands defined in an unmarked autoexec.
        if ($text -match '(?im)(?:^\s*|;[ \t]*)"?(fps_max|fps_max_ui)"?(?=\s|;)') { throw 'Your autoexec already defines an FPS limit. It was left unchanged to preserve your settings.' }
    }
    $id = [Guid]::NewGuid().ToString('N'); $dir = Join-Path $script:DataDir 'cs2'
    $snapshot = Join-Path $dir ($id + '.bin')
    $metadata = [pscustomobject]@{ id = $id; createdAt = [DateTime]::UtcNow.ToString('o'); path = $path; existed = $existed; status = 'prepared'; originalHash = (Get-BytesHash $oldBytes); appliedHash = $null; restoredAt = $null }
    $fileStream = [IO.File]::Open($snapshot, 'CreateNew', 'Write', 'None')
    try { $fileStream.Write($oldBytes, 0, $oldBytes.Length); $fileStream.Flush($true) } finally { $fileStream.Dispose() }
    Save-Json (Join-Path $dir ($id + '.json')) $metadata
    # Only stable Source 2 frame-limit commands; no obsolete CS:GO network cvars.
    $block = Get-CS2ManagedBlock
    if ($existed -and $oldBytes.Length -ge 2 -and (($oldBytes[0] -eq 255 -and $oldBytes[1] -eq 254) -or ($oldBytes[0] -eq 254 -and $oldBytes[1] -eq 255))) { throw 'The existing autoexec uses UTF-16. Its backup is saved, but no edit was made; use a UTF-8 autoexec before applying this profile.' }
    $addition = (New-Object Text.UTF8Encoding($false)).GetBytes($block)
    $newBytes = New-Object byte[] ($oldBytes.Length + $addition.Length)
    [Array]::Copy($oldBytes, 0, $newBytes, 0, $oldBytes.Length); [Array]::Copy($addition, 0, $newBytes, $oldBytes.Length, $addition.Length)
    $metadata.appliedHash = Get-BytesHash $newBytes; $metadata.status = 'applying'; Save-Json (Join-Path $dir ($id + '.json')) $metadata
    try {
        Write-CS2Atomic $path $newBytes @($metadata.originalHash) $existed
        $metadata.status = 'applied'; Save-Json (Join-Path $dir ($id + '.json')) $metadata
    } catch { throw ('CS2 profile was not completed. Its original file is backed up as ' + $id + '. ' + $_.Exception.Message) }
    return @{ ok = $true; backupId = $id; autoexecPath = $path; commands = @('fps_max 300', 'fps_max_ui 60'); restart = 'Restart CS2 to load autoexec.cfg.'; backups = @(Get-CS2Backups) }
}
function Restore-CS2Profile($Payload) {
    Assert-Approved $Payload
    $backups = @(Get-CS2Backups | Where-Object { $_.status -ne 'restored' })
    if ($backups.Count -eq 0) { throw 'No CS2 profile backup is available.' }
    $id = [string](Get-Property $Payload 'id' (Get-Property $Payload 'backupId' $backups[0].id))
    if ($id -notmatch '^[a-f0-9]{32}$' -or $id -ne $backups[0].id) { throw 'Restore the newest CS2 backup first.' }
    $metadata = $backups[0]; $path = [string]$metadata.path
    $installation = Get-CS2Installation
    if (-not $installation.installed -or $path -ne $installation.autoexecPath) { throw 'The CS2 installation has moved. The saved backup is preserved; automatic restore was stopped.' }
    if (-not (Test-ReparseFree ([IO.Path]::GetDirectoryName($path)))) { throw 'The CS2 cfg directory is linked; automatic restoration was stopped.' }
    $snapshot = Join-Path (Join-Path $script:DataDir 'cs2') ($id + '.bin')
    $bytes = [IO.File]::ReadAllBytes($snapshot)
    if ((Get-BytesHash $bytes) -ne $metadata.originalHash) { throw 'The CS2 backup checksum does not match. No file was changed.' }
    if ([IO.File]::Exists($path)) {
        $info = Get-Item -LiteralPath $path
        if (($info.Attributes -band ([IO.FileAttributes]::ReadOnly -bor [IO.FileAttributes]::ReparsePoint)) -ne 0) { throw 'The current autoexec is read-only or linked; it was left unchanged.' }
        $current = [IO.File]::ReadAllBytes($path); $hash = Get-BytesHash $current
        if ($hash -ne $metadata.appliedHash -and $hash -ne $metadata.originalHash) { throw 'Your autoexec changed after the optimizer edit. Automatic restore was stopped to preserve those changes; the original backup is retained.' }
    }
    $metadata.status = 'restoring'; Save-Json (Join-Path (Join-Path $script:DataDir 'cs2') ($id + '.json')) $metadata
    if ($metadata.existed) { Write-CS2Atomic $path $bytes @($metadata.appliedHash, $metadata.originalHash) ([IO.File]::Exists($path)) }
    elseif ([IO.File]::Exists($path)) {
        Initialize-NativeCleanup
        if (-not [OptimizerNative.TempFiles]::DeleteIfHashesMatch($path, [string[]]@($metadata.appliedHash, $metadata.originalHash))) { throw 'The autoexec changed or is locked. It was left unchanged; review and retry.' }
    }
    $metadata.status = 'restored'; $metadata.restoredAt = [DateTime]::UtcNow.ToString('o')
    Save-Json (Join-Path (Join-Path $script:DataDir 'cs2') ($id + '.json')) $metadata
    return @{ ok = $true; backupId = $id; backups = @(Get-CS2Backups) }
}

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'The native optimizer backend requires Windows 10 or Windows 11.' }
    $inputText = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($inputText)) { throw 'No optimizer request was provided.' }
    $request = $inputText | ConvertFrom-Json
    Initialize-DataDir ([string](Get-Property $request 'dataDir' ''))
    $payload = Get-Property $request 'payload' ([pscustomobject]@{})
    $action = [string](Get-Property $request 'action' '')
    if ($action -in @('apply', 'restore', 'restorePoint', 'clean', 'cs2Apply', 'cs2Restore')) { Assert-Approved $payload; Enter-OperationLock }
    $result = switch ($action) {
        'state' {
            $support = Get-RestoreSupport
            @{ ok = $true; mode = 'windows'; isAdmin = (Test-Administrator); restoreAvailable = $support.available; restoreStatus = $support.status; appliedIds = @(Get-AppliedIds); history = @(Get-History) }
        }
        'scan' { Scan-PC }
        'apply' { Apply-Tweaks $payload (Get-Property $request 'catalog' @()) }
        'history' { @{ ok = $true; history = @(Get-History); appliedIds = @(Get-AppliedIds) } }
        'restore' { Restore-Tweaks $payload }
        'restorePoint' { @{ ok = $true; restorePoint = (New-NativeRestorePoint) } }
        'analyzeCleanup' { Analyze-Cleanup }
        'clean' { Clean-TemporaryFiles $payload }
        'cs2Scan' { Scan-CS2 }
        'cs2Apply' { Set-CS2Profile $payload }
        'cs2Restore' { Restore-CS2Profile $payload }
        default { throw 'Unknown optimizer action.' }
    }
} catch {
    $result = @{ ok = $false; error = $_.Exception.Message }
} finally {
    if ($null -ne $script:Lock) { $script:Lock.Dispose() }
}
[Console]::Out.Write((ConvertTo-Json -InputObject $result -Depth 40 -Compress))
