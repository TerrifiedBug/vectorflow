variable "vectorflow_url" {
  description = "Base URL for the VectorFlow control plane. Usually provided from VECTORFLOW_URL."
  type        = string
}

variable "vectorflow_token" {
  description = "VectorFlow service-account token. Usually provided from VECTORFLOW_TOKEN. Mark sensitive in callers."
  type        = string
  sensitive   = true
}

variable "environment_id" {
  description = "Existing VectorFlow environment id that owns imported pipelines."
  type        = string
}

variable "pipeline_name" {
  description = "Name for the pipeline imported from Git-managed Vector config."
  type        = string
}

locals {
  vectorflow_env = {
    VECTORFLOW_URL   = var.vectorflow_url
    VECTORFLOW_TOKEN = var.vectorflow_token
  }
}

# No first-party VectorFlow Terraform provider exists yet.
# Use these variables with REST API v1 or the local `pnpm vf` wrapper.
