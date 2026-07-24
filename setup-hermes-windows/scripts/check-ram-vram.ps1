# scripts/check-ram-vram.ps1
# Vérifie que la machine dispose des ressources minimales pour Gemma 8B / Qwen2.5 7B + Hermes + Docker

Write-Host "=== Vérification des ressources système ===" -ForegroundColor Cyan

$totalRAM = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
$freeRAM = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB / 1024, 1)

Write-Host "RAM totale : $totalRAM Go"
Write-Host "RAM libre actuellement : $freeRAM Go"

if ($totalRAM -lt 16) {
    Write-Host "⚠️  ATTENTION : moins de 16 Go de RAM détectés. Le setup risque d'être instable avec plusieurs agents simultanés." -ForegroundColor Yellow
    Write-Host "    Recommandation : réduire OLLAMA_CONTEXT_SIZE à 16384 et ne lancer que 2 agents à la fois." -ForegroundColor Yellow
} elseif ($totalRAM -lt 24) {
    Write-Host "✅ RAM suffisante pour le setup lite (4 agents) avec Qwen2.5 7B ou Gemma 8B." -ForegroundColor Green
} else {
    Write-Host "✅ RAM confortable — possibilité d'étendre progressivement vers plus de 4 agents." -ForegroundColor Green
}

Write-Host "`n=== Vérification GPU ===" -ForegroundColor Cyan
try {
    $gpu = Get-CimInstance Win32_VideoController | Select-Object -First 1
    Write-Host "GPU détecté : $($gpu.Name)"
    if ($gpu.AdapterRAM) {
        $vram = [math]::Round($gpu.AdapterRAM / 1GB, 1)
        Write-Host "VRAM détectée : $vram Go"
    } else {
        Write-Host "VRAM non détectable via WMI (courant sur GPU récents) — vérifier manuellement via Gestionnaire des tâches > Performance > GPU."
    }
} catch {
    Write-Host "Impossible de détecter le GPU automatiquement." -ForegroundColor Yellow
}

Write-Host "`n=== Vérification Docker Desktop ===" -ForegroundColor Cyan
try {
    docker --version
    docker compose version
    Write-Host "✅ Docker Desktop opérationnel." -ForegroundColor Green
} catch {
    Write-Host "❌ Docker non détecté dans le PATH. Vérifier l'installation de Docker Desktop." -ForegroundColor Red
}

Write-Host "`n=== Vérification Ollama ===" -ForegroundColor Cyan
try {
    ollama --version
    Write-Host "✅ Ollama installé." -ForegroundColor Green
} catch {
    Write-Host "❌ Ollama non détecté dans le PATH. Vérifier l'installation." -ForegroundColor Red
}

Write-Host "`n=== Résumé ===" -ForegroundColor Cyan
Write-Host "Lancer ensuite : .\scripts\ollama-context-test.ps1"
