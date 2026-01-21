# Eureka Committee Apps

Finance and Documentation Apps for Eureka Cycling Club Committee

## Goals

- Minimise ongoing infrastructure and maintenance costs

## Infrastructure

- Backend: Golang, Lambda, DynamoDB
- Frontend: React, S3, CloudFront
- Auth: Cognito (RBAC with custom attributes)
- CI/CD: GitHub Actions

## Roles (RBAC)

The application uses a Role-Based Access Control system to restrict access to committee features:

| Role | Access |
| :--- | :--- |
| `none` | Default role. No access to committee features. |
| `member` | No access to committee features. |
| `committee` | Access to Reports, Reimbursements, and Documents. |
| `treasurer` | Full access, including the Ledger. |
