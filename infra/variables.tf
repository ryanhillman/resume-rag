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
  sensitive   = true
}

variable "allowed_ssh_cidr" {
  description = "CIDR allowed to reach SSH (port 22). Must be restricted to your IP or VPN range: \"203.0.113.0/32\". Leaving this as \"*\" exposes SSH to the public internet."
  type        = string
}

variable "allowed_app_cidr" {
  description = "CIDR allowed to reach the web app (ports 80/443). Restrict to your office/VPN range to prevent public access to staff data: \"203.0.113.0/24\". Leaving this as \"*\" exposes the app to the public internet."
  type        = string
}

variable "ai_custom_subdomain" {
  description = "Custom subdomain for the Azure AI Services account. Must be globally unique worldwide (like a storage account name). Defaults to \"<prefix>-ai\" when empty — override if that name is already taken."
  type        = string
  default     = ""
}

variable "data_disk_size_gb" {
  description = "Size of the data disk that holds the Postgres volume. Kept separate from the OS disk so the database survives the VM being rebuilt."
  type        = number
  default     = 64
}
