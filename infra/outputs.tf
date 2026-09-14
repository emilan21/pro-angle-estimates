output "d1_database_ids" {
  value = { for env, db in cloudflare_d1_database.app : env => db.id }
}
output "access_audiences" {
  value = { for env, app in cloudflare_zero_trust_access_application.app : env => app.aud }
}
output "repository" {
  value = github_repository.app.html_url
}
output "smoke_access_client_id" {
  value = cloudflare_zero_trust_access_service_token.smoke.client_id
}
output "smoke_access_client_secret" {
  value     = cloudflare_zero_trust_access_service_token.smoke.client_secret
  sensitive = true
}
