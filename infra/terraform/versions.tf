terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  # --- Estado remoto (recomendado para trabajo en equipo / CI) -----------------
  # Descoméntalo y crea el bucket + tabla de locks UNA vez (ver README §Estado).
  # backend "s3" {
  #   bucket         = "mailconnect-tfstate"
  #   key            = "mailconnect/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "mailconnect-tflock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "MailConnect"
      ManagedBy = "Terraform"
      Env       = var.env
    }
  }
}
