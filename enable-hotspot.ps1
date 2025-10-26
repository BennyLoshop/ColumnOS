# Windows Mobile Hotspot Enabler
# Uses correct WinRT async operation handling for reliable operation
# Compatible with Windows 10/11

param(
    [switch]$NonInteractive = $false
)

# 设置输出编码为 UTF-8
$OutputEncoding = [System.Text.Encoding]::UTF8
 
# 设置控制台输出编码为 UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime

# Function to properly await WinRT async operations
Function Await-WinRTOperation($WinRtTask, $ResultType) {
    try {
        # Get the AsTask method from WindowsRuntimeSystemExtensions
        $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { 
            $_.Name -eq 'AsTask' -and 
            $_.GetParameters().Count -eq 1 -and 
            $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' 
        })[0]
        
        # Convert WinRT async operation to .NET Task
        $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
        $netTask = $asTask.Invoke($null, @($WinRtTask))
        
        # Wait for completion and return result
        $netTask.Wait(-1) | Out-Null
        return $netTask.Result
    }
    catch {
        return $null
    }
}

Function Test-AdminPrivileges() {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]$currentUser
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

Function Get-TetheringManager() {
    try {
        $connectionProfile = [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]::GetInternetConnectionProfile()
        if ($connectionProfile) {
            $tetheringManager = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::CreateFromConnectionProfile($connectionProfile)
            return $tetheringManager
        }
        return $null
    }
    catch {
        return $null
    }
}

Function Get-CurrentHotspotStatus() {
    $tetheringManager = Get-TetheringManager
    if ($tetheringManager) {
        try {
            return $tetheringManager.TetheringOperationalState
        } catch {
            return "Unknown"
        }
    }
    return "Error"
}

Function Enable-Hotspot() {
    try {
        $tetheringManager = Get-TetheringManager
        
        if (-not $tetheringManager) {
            if (-not $NonInteractive) {

        
            }
            return $false
        }
        
        # Check current status
        $currentStatus = $tetheringManager.TetheringOperationalState
        
        if ($currentStatus -eq 1 -or $currentStatus -eq "On") {
            if (-not $NonInteractive) {
            }
            return $true
        }
        
        if (-not $NonInteractive) {
        }
        
        # Start tethering with proper async handling
        $asyncOperation = $tetheringManager.StartTetheringAsync()
        
        if (-not $NonInteractive) {
        }
        
        # Properly await the operation
        $result = Await-WinRTOperation -WinRtTask $asyncOperation -ResultType ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
        
        if ($result) {
            if (-not $NonInteractive) {
                
                if ($result.AdditionalErrorMessage) {
                }
            }
            
            switch ($result.Status) {
                "Success" {
                    if (-not $NonInteractive) {
                    }
                    return $true
                }
                "UnknownError" {
                    if (-not $NonInteractive) {
                    }
                    return $false
                }
                "MobileBroadbandAccountNotProvisioned" {
                    if (-not $NonInteractive) {
                    }
                    return $false
                }
                "InternetConnectionUnavailable" {
                    if (-not $NonInteractive) {
                    }
                    return $false
                }
                "BluetoothRadioOff" {
                    if (-not $NonInteractive) {
                    }
                    return $false
                }
                "WlanRadioOff" {
                    if (-not $NonInteractive) {
                    }
                    return $false
                }
                default {
                    if (-not $NonInteractive) {
                    }
                    return $false
                }
            }
        } else {
            if (-not $NonInteractive) {
            }
            Start-Sleep -Seconds 2
            
            $finalStatus = Get-CurrentHotspotStatus
            if ($finalStatus -eq 1 -or $finalStatus -eq "On") {
                if (-not $NonInteractive) {
                }
                return $true
            } else {
                return $false
            }
        }
        
    }
    catch {
        if (-not $NonInteractive) {

        }
        return $false
    }
}

# Main execution
if ($NonInteractive) {
    # Non-interactive mode - output JSON
    try {
        $currentStatus = Get-CurrentHotspotStatus
        $isAdmin = Test-AdminPrivileges
        
        $statusText = switch ($currentStatus) {
            0 { "OFF" }
            "Off" { "OFF" }
            1 { "ON" }
            "On" { "ON" }
            "InTransition" { "IN TRANSITION" }
            default { "UNKNOWN" }
        }
        
        # Attempt to enable hotspot
        $success = Enable-Hotspot
        
        $result = @{
            Success = $success
            PreviousStatus = $statusText
            IsAdmin = $isAdmin
            Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        }
        
        $result | ConvertTo-Json -Compress
        
        if ($success) {
            exit 0
        } else {
            exit 1
        }
        
    } catch {
        $errorResult = @{
            Success = $false
            Error = $_.Exception.Message
            Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        }
        
        $errorResult | ConvertTo-Json -Compress
        exit 1
    }
} else {
    # Interactive mode - formatted output
     

    # Check for admin privileges
    if (-not (Test-AdminPrivileges)) {
    }
    $currentStatus = Get-CurrentHotspotStatus

    $statusText = switch ($currentStatus) {
        0 { "OFF" }
        "Off" { "OFF" }
        1 { "ON" }
        "On" { "ON" }
        "InTransition" { "IN TRANSITION" }
        default { "UNKNOWN ($currentStatus)" }
    }


    # Attempt to enable hotspot
    $success = Enable-Hotspot

    if ($success) {
        # "Mobile Hotspot has been enabled successfully!" -ForegroundColor Green
        Write-Host "[热点] 正在启动热点"
        exit 0
    } else {
        exit 1
    }

} 