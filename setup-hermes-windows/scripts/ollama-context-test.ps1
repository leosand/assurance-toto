# scripts/ollama-context-test.ps1
# Teste si le modèle local tient un contexte de 32K/64K tokens sans erreur ni lenteur excessive

param(
    [string]$Model = "gemma4:e4b", # was: "qwen2.5:7b"
    [int]$ContextSize = 32768
)

Write-Host "=== Test de contexte pour $Model (num_ctx=$ContextSize) ===" -ForegroundColor Cyan

$env:OLLAMA_CONTEXT_LENGTH = $ContextSize

Write-Host "Génération d'un prompt de test long (~$($ContextSize / 4) mots)..." -ForegroundColor Cyan
$longText = "Ceci est une phrase de test répétée pour simuler un contexte long. " * ([math]::Floor($ContextSize / 12))

$tempFile = "$env:TEMP\hermes_context_test.txt"
$longText | Out-File -Encoding utf8 $tempFile

Write-Host "Lancement du test (peut prendre 1-3 minutes selon le matériel)..." -ForegroundColor Cyan
$start = Get-Date

$prompt = "Résume ce texte en une phrase : $longText"
$result = ollama run $Model $prompt 2>&1

$duration = (Get-Date) - $start

Write-Host "`n=== Résultat ===" -ForegroundColor Cyan
Write-Host "Durée : $([math]::Round($duration.TotalSeconds, 1)) secondes"

if ($result -match "error|out of memory|context") {
    Write-Host "❌ Erreur détectée — réduire ContextSize (essayer 16384) ou libérer de la RAM." -ForegroundColor Red
    Write-Host $result
} elseif ($duration.TotalSeconds -gt 60) {
    Write-Host "⚠️  Réponse obtenue mais lente (> 60s). Le contexte $ContextSize est à la limite de ta machine." -ForegroundColor Yellow
    Write-Host "    Recommandation : réduire à un contexte plus bas pour un usage fluide avec plusieurs agents." -ForegroundColor Yellow
} else {
    Write-Host "✅ Contexte $ContextSize tokens tenu correctement avec $Model." -ForegroundColor Green
    Write-Host "    Tu peux utiliser cette valeur dans OLLAMA_CONTEXT_SIZE (.env)."
}

Remove-Item $tempFile -ErrorAction SilentlyContinue
