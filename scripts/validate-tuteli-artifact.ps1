[CmdletBinding()]
param(
  [switch]$OnlyValidate
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

Push-Location $repositoryRoot
try {
  Write-Host "Validando o artefato Tuteli..."
  & npm run artifact:validate -- produtos/tuteli/artifact
  if ($LASTEXITCODE -ne 0) {
    throw "A validação estática do artefato falhou (exit code $LASTEXITCODE)."
  }

  if (-not $OnlyValidate) {
    Write-Host "Aplicando o manifesto completo e a v14 em bancos descartáveis t_*..."
    & npx vitest run --project integration server/tests/integration/migrations/tuteli-package-artifact.test.ts
    if ($LASTEXITCODE -ne 0) {
      throw "O teste de migração do artefato falhou (exit code $LASTEXITCODE)."
    }
  }

  Write-Host "Validação do artefato Tuteli concluída."
}
finally {
  Pop-Location
}
