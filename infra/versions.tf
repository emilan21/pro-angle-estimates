terraform {
  required_version = ">= 1.9.0"
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 5.24" }
    github     = { source = "integrations/github", version = "~> 6.0" }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

provider "github" {
  token = var.github_token
  owner = var.github_owner
}
