output "vm_public_ip" {
  description = "Public IP of the VM."
  value       = azurerm_public_ip.pip.ip_address
}

output "hostname" {
  description = "Stable DNS hostname of the VM (does not change across VM recreations)."
  value       = azurerm_public_ip.pip.fqdn
}

output "ssh_command" {
  description = "SSH command to connect to the VM."
  value       = "ssh ${var.admin_username}@${azurerm_public_ip.pip.fqdn}"
}

output "app_url" {
  description = "Public URL of the app (served over HTTPS by Caddy)."
  value       = "https://${azurerm_public_ip.pip.fqdn}"
}

output "ai_endpoint" {
  description = "Azure AI Services endpoint, for AZURE_OPENAI_ENDPOINT."
  value       = "https://${local.ai_subdomain}.cognitiveservices.azure.com/"
}

output "ai_key" {
  description = "Azure AI Services primary key (sensitive)."
  value       = azurerm_cognitive_account.ai.primary_access_key
  sensitive   = true
}

output "deploy_client_id" {
  description = "Client ID of the managed identity GitHub Actions assumes."
  value       = azurerm_user_assigned_identity.deploy.client_id
}

output "deploy_tenant_id" {
  description = "Entra tenant ID for azure/login."
  value       = data.azurerm_client_config.current.tenant_id
}

output "subscription_id" {
  description = "Subscription ID for azure/login."
  value       = data.azurerm_client_config.current.subscription_id
}
