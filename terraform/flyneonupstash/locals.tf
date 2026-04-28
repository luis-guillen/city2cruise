locals {
  name_prefix = "${var.project_name}-${var.environment}"

  # Mapeo region Fly → tag amistoso
  region_tag = {
    mad = "Madrid"
    cdg = "Paris"
    fra = "Frankfurt"
    iad = "Virginia"
  }

  common_tags = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
    iac_module  = "flyneonupstash"
  }
}
