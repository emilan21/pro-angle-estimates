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
variable "allowed_email" {
  type    = string
  default = "proangleconstruction@gmail.com"
}

locals { environments = toset(["production", "staging"]) }
