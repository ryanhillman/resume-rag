# State lives in Azure Blob Storage, authenticated by your az CLI login.
# After cloning, run:  terraform -chdir=infra init

terraform {
  backend "azurerm" {
    resource_group_name  = "tfstate-rg"
    storage_account_name = "rrtfstate071728a1"
    container_name       = "tfstate"
    key                  = "resume-rag.tfstate"
  }
}
