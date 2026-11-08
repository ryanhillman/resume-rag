# Remote state in Azure Blob Storage. Created 2026-11-07.
#
# The storage account has blob versioning and 30-day soft delete enabled, so a
# corrupted or truncated state file can be rolled back. Authentication uses
# your az CLI login; no credentials live in this file.
#
# After cloning, run:  terraform -chdir=infra init

terraform {
  backend "azurerm" {
    resource_group_name  = "tfstate-rg"
    storage_account_name = "rrtfstate071728a1"
    container_name       = "tfstate"
    key                  = "resume-rag.tfstate"
  }
}
