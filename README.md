# Eureka Committee Apps

A specialized accounting and management application for the Eureka Cycling Club.

## Architecture

- **Backend**: AWS Lambda (Go), DynamoDB, API Gateway (REST).
- **Frontend**: React (Vite + TypeScript), hosted on S3/CloudFront.
- **Infrastructure**: AWS CDK (TypeScript).
- **Authentication**: Amazon Cognito.

## Getting Started

### Prerequisites
- Node.js 20+
- Go 1.21+
- AWS CLI configured
- Docker (for local SAM emulation, optional)

### Backend Development

The backend code is in `backend/`.

```bash
# Build binary
make build

# Run local API (requires SAM)
make start-api
```

### Frontend Development

The frontend code is in `frontend/`.

```bash
cd frontend
npm install
npm run dev
```

### Local Development Authentication

To bypass the Cognito login screen during local development (mock mode):

```bash
# Run frontend with mocked auth
VITE_NO_AUTH=true npm run dev
```

### Deployment

The infrastructure is deployed via AWS CDK.

```bash
cd cdk
npm install
npx cdk deploy
```
