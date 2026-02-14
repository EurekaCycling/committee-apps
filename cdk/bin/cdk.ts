#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { CommitteeAppsStack } from '../lib/committee-apps-stack';

const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const app = new cdk.App();
new CommitteeAppsStack(app, 'CommitteeAppsBackendProd', {
  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */

  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  // env: { account: '123456789012', region: 'us-east-1' },

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
  apiDomainName: 'api.committee.eurekacycling.org.au',
  frontendDomainName: 'committee2.eurekacycling.org.au',
  apiStageName: 'Prod',
  corsOrigins: [
    'https://committee.eurekacycling.org.au',
    'https://committee2.eurekacycling.org.au',
  ],
  apiCertificateArn: requireEnv('ACM_CERTIFICATE_ARN'),
  frontendCertificateArn: requireEnv('FRONTEND_CERTIFICATE_ARN'),
  buildNumber: 'dev',
});

new CommitteeAppsStack(app, 'CommitteeAppsBackendTest', {
  apiDomainName: 'api-test.committee.eurekacycling.org.au',
  frontendDomainName: 'committee-test.eurekacycling.org.au',
  apiStageName: 'Test',
  corsOrigins: ['https://committee-test.eurekacycling.org.au'],
  apiCertificateArn: requireEnv('TEST_API_CERTIFICATE_ARN'),
  frontendCertificateArn: requireEnv('TEST_FRONTEND_CERTIFICATE_ARN'),
  buildNumber: 'dev',
});
