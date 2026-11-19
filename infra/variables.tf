variable "prefix" {
  description = "Prefix applied to all resource names."
  type        = string
  default     = "resume-rag"
}

variable "resource_group_name" {
  description = "Name of the Azure resource group."
  type        = string
  default     = "resume-rag-rg"
}

variable "location" {
  description = "Azure region."
  type        = string
  default     = "eastus"
}

variable "vm_size" {
  description = "VM SKU. Standard_B1s (1 vCPU, 1 GB) is sufficient for the RAG pipeline."
  type        = string
  default     = "Standard_B1s"
}

variable "os_disk_size_gb" {
  description = "OS disk size in GB. 64 GB comfortably fits Docker images and logs."
  type        = number
  default     = 64
}

variable "admin_username" {
  description = "Linux admin user created on the VM."
  type        = string
  default     = "azureuser"
}

variable "ssh_public_key" {
  description = "SSH public key for VM access. Paste the contents of your ~/.ssh/id_rsa.pub (or equivalent)."
  type        = string
}

variable "allowed_ssh_cidr" {
  description = "CIDR allowed to reach SSH (port 22). Must be restricted to your IP or VPN range: \"203.0.113.0/32\". Leaving this as \"*\" exposes SSH to the public internet."
  type        = string
}

variable "allowed_app_cidr" {
  description = "CIDR allowed to reach the web app (ports 80/443). Keep \"*\": Caddy can obtain and renew its certificate only while the internet can reach these ports. Sign-in protects the app."
  type        = string
}

variable "ai_custom_subdomain" {
  description = "Custom subdomain for the Azure AI Services account. Must be globally unique worldwide (like a storage account name). Defaults to \"<prefix>-ai\" when empty — override if that name is already taken."
  type        = string
  default     = ""
}
