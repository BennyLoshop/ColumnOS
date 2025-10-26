# Windows Mobile Hotspot Disabler
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
        # "Error in async operation: $($_.Exception.Message)" -ForegroundColor Red
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

Function Disable-Hotspot() {
    try {
        $tetheringManager = Get-TetheringManager
        
        if (-not $tetheringManager) {
            if (-not $NonInteractive) {
                # "ERROR: Cannot access hotspot functionality!" -ForegroundColor Red
                # "Make sure you have an active network connection." -ForegroundColor Yellow
            }
            return $false
        }
        
        # Check current status
        $currentStatus = $tetheringManager.TetheringOperationalState
        
        if ($currentStatus -eq 0 -or $currentStatus -eq "Off") {
            if (-not $NonInteractive) {
            }
            return $true
        }
        
        if (-not $NonInteractive) {
            # "Disabling Mobile Hotspot using proper async handling..." -ForegroundColor Yellow
        }
        
        # Stop tethering with proper async handling
        $asyncOperation = $tetheringManager.StopTetheringAsync()
        
        if (-not $NonInteractive) {
            # "Converting WinRT async operation to .NET Task..." -ForegroundColor Gray
        }
        
        # Properly await the operation
        $result = Await-WinRTOperation -WinRtTask $asyncOperation -ResultType ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
        
        if ($result) {
            if (-not $NonInteractive) {
                # "Async operation completed successfully!" -ForegroundColor Green
                # "Operation Status: $($result.Status)" -ForegroundColor White
                
                if ($result.AdditionalErrorMessage) {
                    # "Additional Message: $($result.AdditionalErrorMessage)" -ForegroundColor Yellow
                }
            }
            
            switch ($result.Status) {
                "Success" {
                    if (-not $NonInteractive) {
                        # "SUCCESS: Mobile Hotspot disabled!" -ForegroundColor Green
                    }
                    return $true
                }
                "UnknownError" {
                    if (-not $NonInteractive) {
                        # "ERROR: Unknown error occurred while disabling hotspot." -ForegroundColor Red
                    }
                    return $false
                }
                "MobileBroadbandAccountNotProvisioned" {
                    if (-not $NonInteractive) {
                        # "ERROR: Mobile broadband account not provisioned." -ForegroundColor Red
                    }
                    return $false
                }
                "InternetConnectionUnavailable" {
                    if (-not $NonInteractive) {
                        # "WARNING: Internet connection unavailable, but hotspot disabled." -ForegroundColor Yellow
                    }
                    return $true
                }
                "BluetoothRadioOff" {
                    if (-not $NonInteractive) {
                        # "ERROR: Bluetooth radio is off." -ForegroundColor Red
                    }
                    return $false
                }
                "WlanRadioOff" {
                    if (-not $NonInteractive) {
                        # "ERROR: WiFi radio is off." -ForegroundColor Red
                    }
                    return $false
                }
                default {
                    if (-not $NonInteractive) {
                        # "ERROR: Failed to disable hotspot. Status: $($result.Status)" -ForegroundColor Red
                    }
                    return $false
                }
            }
        } else {
            if (-not $NonInteractive) {
                # "ERROR: Async operation failed to complete or returned null result." -ForegroundColor Red
                
                # Fallback: Check if hotspot actually got disabled anyway
                # "Checking actual hotspot status as fallback..." -ForegroundColor Yellow
            }
            Start-Sleep -Seconds 2
            
            $finalStatus = Get-CurrentHotspotStatus
            if ($finalStatus -eq 0 -or $finalStatus -eq "Off") {
                if (-not $NonInteractive) {
                    # "SUCCESS: Mobile Hotspot disabled! (Detected via status check)" -ForegroundColor Green
                }
                return $true
            } else {
                return $false
            }
        }
        
    }
    catch {
        if (-not $NonInteractive) {
            # "ERROR: Exception occurred: $($_.Exception.Message)" -ForegroundColor Red
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
        
        # Attempt to disable hotspot
        $success = Disable-Hotspot
        
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

    # Check current status
    $currentStatus = Get-CurrentHotspotStatus

    $statusText = switch ($currentStatus) {
        0 { "OFF" }
        "Off" { "OFF" }
        1 { "ON" }
        "On" { "ON" }
        "InTransition" { "IN TRANSITION" }
        default { "UNKNOWN ($currentStatus)" }
    }


    # Attempt to disable hotspot
    $success = Disable-Hotspot

    if ($success) {
        # "Mobile Hotspot has been disabled successfully!" -ForegroundColor Green
        
        Write-Host "[热点] 正在关闭热点"
        exit 0
    } else {
        exit 1
    }
    
} 