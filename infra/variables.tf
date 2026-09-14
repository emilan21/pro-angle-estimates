variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}
variable "github_token" {
  type      = string
  sensitive = true
}
variable "cloudflare_account_id" { type = string }
variable "cloudflare_zone_id" { type = string }
variable "github_owner" {
  type    = string
  default = "emilan21"
}
variable "allowed_emails" {
  type = list(string)
  default = [
    "proangleconstruction@gmail.com",
    "eprogram1@gmail.com",
    "emilan@ericmilan.dev",
    "edingerkevin75@gmail.com",
  ]
}
variable "google_identity_provider_id" {
  type    = string
  default = "8aed7b64-d005-44b9-848e-8bfd9ce23d15"
}

locals { environments = toset(["production", "staging"]) }
