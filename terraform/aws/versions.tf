terraform {
  required_version = ">= 1.5.0"

  # Backend remoto recomendado: S3 + DynamoDB locking.
  # backend "s3" {
  #   bucket         = "city2cruise-tf-state"
  #   key            = "aws/terraform.tfstate"
  #   region         = "eu-south-2"
  #   dynamodb_table = "city2cruise-tf-lock"
  #   encrypt        = true
  # }
  backend "local" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.55"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = local.common_tags
  }
}
