param([string]$Repository = (Split-Path $PSScriptRoot -Parent))
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$tokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $Repository 'native/windows.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
# Load declarations only. The production dispatch and all Windows operations are never executed.
foreach ($function in @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false))) {
    Invoke-Expression $function.Extent.Text
}
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Expect-Throw([scriptblock]$Block, [string]$Pattern) {
    try { & $Block; throw 'Expected an exception but operation succeeded.' }
    catch { if ($_.Exception.Message -notmatch $Pattern) { throw } }
}
$testDir = Join-Path ([IO.Path]::GetTempPath()) ('frameforge-test-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory((Join-Path $testDir 'transactions'))
$script:DataDir = $testDir
$script:Changes = @(); $script:Undos = @(); $script:FailOn = ''; $script:RestoreFails = $false
function Assert-Administrator { }
function Get-CimInstance { return [pscustomobject]@{ BuildNumber = '22631' } }
function Get-RegistrySnapshot($Target) { return [pscustomobject]@{ path=$Target.path; name=$Target.name; exists=$true; kind='String'; value='original'; absentKeys=@() } }
function New-NativeRestorePoint {
    if ($script:RestoreFails) { throw 'restore checkpoint failed' }
    return [pscustomobject]@{ sequenceNumber=1; description='test'; createdAt=[DateTime]::UtcNow.ToString('o') }
}
function Invoke-TweakOperation($Operation) {
    $journal = @(Get-Transactions)[0]
    Assert ($journal.status -eq 'applying') 'Mutation started before journal was durable.'
    Assert (@($journal.operations | Where-Object { $_.tweakId -eq $Operation.tweakId -and $_.status -eq 'applying' }).Count -eq 1) 'Mutation intent was not journaled.'
    Assert ($Operation.before.value -eq 'original') 'Original value was not saved before mutation.'
    $script:Changes += $Operation.tweakId
    if ($Operation.tweakId -eq $script:FailOn) { throw 'injected setting failure' }
}
function Undo-TweakOperation($Operation) { $script:Undos += $Operation.tweakId }
$catalog = @('first','second' | ForEach-Object {
    [pscustomobject]@{ id=$_; kind='registry'; minBuild=19041; targets=@([pscustomobject]@{ path='HKCU:\Software\FrameforgeTest'; name=$_; type='DWord'; value=1 }) }
})
$payload = [pscustomobject]@{ approved=$true; createRestorePoint=$true; ids=@('first','second') }
$count = 0
try {
    Expect-Throw { Assert-Approved ([pscustomobject]@{ approved=$false }) } 'approve'
    $count++
    $script:RestoreFails = $true
    Expect-Throw { Apply-Tweaks $payload $catalog } 'checkpoint failed'
    Assert ($script:Changes.Count -eq 0) 'A setting changed after checkpoint failure.'
    Assert (@(Get-Transactions).Count -eq 0) 'Unexpected transaction after checkpoint failure.'
    $count++
    $script:RestoreFails = $false; $script:FailOn = 'second'
    $failed = Apply-Tweaks $payload $catalog
    Assert (-not $failed.ok) 'An injected failure was reported as success.'
    Assert (($script:Undos -join ',') -eq 'second,first') 'Rollback was not in reverse order including the failed operation.'
    Assert (@(Get-Transactions)[0].status -eq 'rolledBack') 'Rollback status was not persisted.'
    Assert (@(Get-AppliedIds).Count -eq 0) 'Rolled-back changes were reported applied.'
    $count++
    $script:FailOn = ''; $script:Changes=@(); $script:Undos=@()
    $success = Apply-Tweaks $payload $catalog
    Assert $success.ok 'Successful changes were not recorded.'
    Assert (@(Get-AppliedIds).Count -eq 2) 'Applied settings count is wrong.'
    $count++
    $restored = Restore-Tweaks ([pscustomobject]@{ approved=$true; id=$success.backupId })
    Assert $restored.ok 'Restoring a saved transaction failed.'
    Assert (($script:Undos -join ',') -eq 'second,first') 'Restore did not use reverse order.'
    Assert (@(Get-AppliedIds).Count -eq 0) 'Restored settings still reported applied.'
    $count++
    $oldBuild = [pscustomobject]@{ id='future'; kind='registry'; minBuild=99999; targets=@() }
    $ineligible = New-TweakOperations @('future') @($oldBuild)
    Assert ($ineligible.operations.Count -eq 0 -and $ineligible.skipped.Count -eq 1) 'Build-incompatible tweak was not skipped.'
    $count++
    function Get-RegistrySnapshot($Target) { return [pscustomobject]@{ path=$Target.path; name=$Target.name; exists=$true; kind='DWord'; value=1; absentKeys=@() } }
    $script:RestoreFails = $true; $script:Changes = @()
    $journalCount = @(Get-Transactions).Count
    $noop = Apply-Tweaks $payload $catalog
    Assert ($noop.ok -and $noop.changedCount -eq 0) 'Already-matching settings were not reported as a no-op.'
    Assert ($noop.skipped.Count -eq 2) 'Already-matching tweaks did not have skip reasons.'
    Assert ($script:Changes.Count -eq 0 -and @(Get-Transactions).Count -eq $journalCount) 'A no-op mutated settings or created a journal.'
    $count++
    Write-Output "$count native transaction checks passed (Windows operations mocked; syntax parsed)."
} finally {
    [IO.Directory]::Delete($testDir, $true)
}
