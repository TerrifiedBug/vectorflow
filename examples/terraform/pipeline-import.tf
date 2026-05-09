variable "vector_config_path" {
  description = "Path to the Git-managed Vector YAML/TOML config to import."
  type        = string
  default     = "./vector.yaml"
}

resource "terraform_data" "vectorflow_pipeline_import" {
  input = {
    config_sha  = filesha256(var.vector_config_path)
    environment = var.environment_id
    name        = var.pipeline_name
  }

  provisioner "local-exec" {
    environment = merge(local.vectorflow_env, {
      VECTOR_CONFIG_PATH = var.vector_config_path
      PIPELINE_NAME      = var.pipeline_name
    })
    command = "pnpm vf import \"$VECTOR_CONFIG_PATH\" --name \"$PIPELINE_NAME\""
  }
}

resource "terraform_data" "vectorflow_deploy_status" {
  depends_on = [terraform_data.vectorflow_pipeline_import]

  provisioner "local-exec" {
    environment = local.vectorflow_env
    command     = "echo 'Run pnpm vf deploy-status <pipeline-id> after import returns the pipeline id.'"
  }
}
