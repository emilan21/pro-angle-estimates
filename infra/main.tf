resource "github_repository" "app" {
  name                   = "pro-angle-estimates"
  description            = "Estimate management for Pro Angle Construction"
  visibility             = "public"
  has_issues             = true
  delete_branch_on_merge = true
  allow_merge_commit     = false
  allow_rebase_merge     = true
  allow_squash_merge     = true
}

# The repository is bootstrapped once by `gh repo create`; first apply adopts it.
import {
  to = github_repository.app
  id = "pro-angle-estimates"
}

resource "github_repository_vulnerability_alerts" "app" {
  repository = github_repository.app.name
  enabled    = true
}

resource "github_repository_ruleset" "main" {
  name        = "protect-main"
  repository  = github_repository.app.name
  target      = "branch"
  enforcement = "active"
  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }
  rules {
    deletion                = true
    non_fast_forward        = true
    required_linear_history = true
    pull_request {
      required_approving_review_count = 0
      dismiss_stale_reviews_on_push   = false
      require_code_owner_review       = false
    }
    required_status_checks {
      strict_required_status_checks_policy = true
      required_check { context = "quality" }
    }
  }
}

resource "cloudflare_d1_database" "app" {
  for_each              = local.environments
  account_id            = var.cloudflare_account_id
  name                  = "pro-angle-estimates-${each.key}"
  primary_location_hint = "enam"
}
resource "cloudflare_r2_bucket" "artifacts" {
  for_each   = local.environments
  account_id = var.cloudflare_account_id
  name       = "pro-angle-estimates-artifacts-${each.key}"
  location   = "enam"
}
resource "cloudflare_r2_bucket" "backups" {
  for_each   = local.environments
  account_id = var.cloudflare_account_id
  name       = "pro-angle-estimates-backups-${each.key}"
  location   = "enam"
}
resource "cloudflare_r2_bucket_lifecycle" "backups" {
  for_each    = local.environments
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.backups[each.key].name
  rules       = [{ id = "daily-90-days", enabled = true, conditions = { prefix = "daily/" }, delete_objects_transition = { condition = { type = "Age", max_age = 7776000 } } }, { id = "monthly-13-months", enabled = true, conditions = { prefix = "monthly/" }, delete_objects_transition = { condition = { type = "Age", max_age = 34214400 } } }]
}

resource "cloudflare_zero_trust_access_service_token" "smoke" {
  account_id = var.cloudflare_account_id
  name       = "Pro Angle estimates CI smoke"
  duration   = "8760h"
}

resource "cloudflare_zero_trust_access_policy" "company_email" {
  account_id       = var.cloudflare_account_id
  name             = "Allow Pro Angle estimate users"
  decision         = "allow"
  session_duration = "12h"
  include          = [for allowed_email in var.allowed_emails : { email = { email = allowed_email } }]
  lifecycle {
    create_before_destroy = true
  }
}

resource "cloudflare_zero_trust_access_policy" "smoke_service" {
  account_id = var.cloudflare_account_id
  name       = "Authenticate Pro Angle CI smoke checks"
  decision   = "non_identity"
  include    = [{ service_token = { token_id = cloudflare_zero_trust_access_service_token.smoke.id } }]
}

resource "cloudflare_zero_trust_access_application" "app" {
  for_each                  = local.environments
  account_id                = var.cloudflare_account_id
  name                      = "Pro Angle Estimates ${title(each.key)}"
  type                      = "self_hosted"
  domain                    = each.key == "production" ? "estimates.proangleconstructionpa.com" : "estimates-staging.proangleconstructionpa.com"
  session_duration          = "12h"
  auto_redirect_to_identity = true
  allowed_idps              = [var.google_identity_provider_id]
  app_launcher_visible      = false
  policies                  = [{ id = cloudflare_zero_trust_access_policy.smoke_service.id, precedence = 1 }, { id = cloudflare_zero_trust_access_policy.company_email.id, precedence = 2 }]
}

resource "cloudflare_workers_custom_domain" "app" {
  for_each   = local.environments
  account_id = var.cloudflare_account_id
  zone_id    = var.cloudflare_zone_id
  zone_name  = "proangleconstructionpa.com"
  hostname   = each.key == "production" ? "estimates.proangleconstructionpa.com" : "estimates-staging.proangleconstructionpa.com"
  service    = each.key == "production" ? "pro-angle-estimates" : "pro-angle-estimates-staging"
}
