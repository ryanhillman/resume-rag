terraform {
  required_version = ">= 1.7"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {}
}

locals {
  tags = {
    project = var.prefix
    managed = "terraform"
  }
  ai_subdomain = var.ai_custom_subdomain != "" ? var.ai_custom_subdomain : "${var.prefix}-ai"
}

# ── Resource group ─────────────────────────────────────────────────────────────

resource "azurerm_resource_group" "rg" {
  name     = var.resource_group_name
  location = var.location
  tags     = local.tags
}

# ── Networking ─────────────────────────────────────────────────────────────────

resource "azurerm_virtual_network" "vnet" {
  name                = "${var.prefix}-vnet"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  address_space       = ["10.0.0.0/16"]
  tags                = local.tags
}

resource "azurerm_subnet" "subnet" {
  name                 = "default"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.vnet.name
  address_prefixes     = ["10.0.1.0/24"]
}

resource "azurerm_public_ip" "pip" {
  name                = "${var.prefix}-pip"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  allocation_method   = "Static"
  sku                 = "Standard"
  domain_name_label   = var.prefix
  tags                = local.tags
}

resource "azurerm_network_security_group" "nsg" {
  name                = "${var.prefix}-nsg"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  tags                = local.tags

  security_rule {
    name                       = "SSH"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = var.allowed_ssh_cidr
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "HTTPS"
    priority                   = 120
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_ranges    = ["80", "443"]
    source_address_prefix      = var.allowed_app_cidr
    destination_address_prefix = "*"
  }
}

resource "azurerm_network_interface" "nic" {
  name                = "${var.prefix}-nic"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  tags                = local.tags

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.subnet.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.pip.id
  }
}

resource "azurerm_network_interface_security_group_association" "nic_nsg" {
  network_interface_id      = azurerm_network_interface.nic.id
  network_security_group_id = azurerm_network_security_group.nsg.id
}

# ── Azure AI Services ──────────────────────────────────────────────────────────

resource "azurerm_cognitive_account" "ai" {
  name                  = "${var.prefix}-ai"
  location              = azurerm_resource_group.rg.location
  resource_group_name   = azurerm_resource_group.rg.name
  kind                  = "AIServices"
  sku_name              = "S0"
  custom_subdomain_name = local.ai_subdomain
  tags                  = local.tags
}

resource "azurerm_cognitive_deployment" "embed" {
  name                 = "text-embedding-3-small"
  cognitive_account_id = azurerm_cognitive_account.ai.id

  model {
    format = "OpenAI"
    name   = "text-embedding-3-small"
  }

  sku {
    name     = "GlobalStandard"
    capacity = 120
  }
}

resource "azurerm_cognitive_deployment" "llm" {
  name                 = "gpt-5-nano"
  cognitive_account_id = azurerm_cognitive_account.ai.id

  model {
    format = "OpenAI"
    name   = "gpt-5-nano"
  }

  sku {
    name     = "GlobalStandard"
    capacity = 20
  }

  depends_on = [azurerm_cognitive_deployment.embed]
}

# ── VM ─────────────────────────────────────────────────────────────────────────

resource "azurerm_linux_virtual_machine" "vm" {
  name                = "${var.prefix}-vm"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  size                = var.vm_size
  admin_username      = var.admin_username
  tags                = local.tags

  network_interface_ids = [azurerm_network_interface.nic.id]

  disable_password_authentication = true

  admin_ssh_key {
    username   = var.admin_username
    public_key = var.ssh_public_key
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "StandardSSD_LRS"
    disk_size_gb         = var.os_disk_size_gb
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts-gen2"
    version   = "latest"
  }

  custom_data = base64encode(templatefile("${path.module}/cloud-init.yaml", {
    admin_username = var.admin_username
  }))

  lifecycle {
    ignore_changes = [custom_data]
  }
}

# ── GitHub Actions deploy identity ────────────────────────────────────────────
# GitHub exchanges a short-lived OIDC token for Azure credentials: no secret in
# the repository, and the deploy reaches the VM through Azure's control plane
# rather than SSH, so port 22 stays closed to all but var.allowed_ssh_cidr. A
# managed identity rather than an app registration — the federated credential
# is identical and needs no directory-level permissions.

data "azurerm_client_config" "current" {}

resource "azurerm_user_assigned_identity" "deploy" {
  name                = "${var.prefix}-deploy"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  tags                = local.tags
}

resource "azurerm_federated_identity_credential" "github_main" {
  name      = "github-main"
  parent_id = azurerm_user_assigned_identity.deploy.id
  audience  = ["api://AzureADTokenExchange"]
  issuer    = "https://token.actions.githubusercontent.com"

  # Only a run in this repository's production environment can present this
  # subject; a fork's pull request never reaches that environment. The numeric
  # owner and repository IDs are immutable, so renaming either cannot hand the
  # trust to whoever claims the old name. For another repository, read it with:
  #   gh api repos/<owner>/<repo>/actions/oidc/customization/sub --jq .sub_claim_prefix
  subject = "repo:ryanhillman@65861600/resume-rag@1446372536:environment:production"
}

# Built-in roles, kept least-privilege by scope: Azure ships no role for run
# commands alone, and of the built-ins that grant them, Virtual Machine
# Contributor is the narrowest that is actually about virtual machines. Granting
# it here covers this one VM, not the resource group, so the identity can reach
# nothing else — though on this VM it also permits restart, resize and delete.
resource "azurerm_role_assignment" "deploy_run_command" {
  scope                = azurerm_linux_virtual_machine.vm.id
  role_definition_name = "Virtual Machine Contributor"
  principal_id         = azurerm_user_assigned_identity.deploy.principal_id
}

# `az vm run-command` resolves the resource group first, and a role assignment
# grants nothing above its own scope, so the VM-scoped role cannot satisfy that
# lookup. Reader is the narrowest built-in that can, and it is read-only:
# reading the AI account's keys is an action, not a read, so this cannot.
resource "azurerm_role_assignment" "deploy_resource_group_read" {
  scope                = azurerm_resource_group.rg.id
  role_definition_name = "Reader"
  principal_id         = azurerm_user_assigned_identity.deploy.principal_id
}
