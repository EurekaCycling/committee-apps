import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as path from 'path';

export class CommitteeAppsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- Parameters ---
    const domainNameParam = new cdk.CfnParameter(this, 'DomainName', {
      type: 'String',
      default: 'api.committee.eurekacycling.org.au',
      description: 'Custom Domain Name for API',
    });

    const certificateArnParam = new cdk.CfnParameter(this, 'CertificateArn', {
      type: 'String',
      description: 'ARN of the ACM Certificate for API',
    });

    const frontendCertificateArnParam = new cdk.CfnParameter(this, 'FrontendCertificateArn', {
      type: 'String',
      description: 'ARN of the ACM Certificate for Frontend',
    });

    const signingSecretParam = new cdk.CfnParameter(this, 'DocumentsSigningSecret', {
      type: 'String',
      description: 'Secret for signing document URLs',
      noEcho: true,
    });

    const buildNumberParam = new cdk.CfnParameter(this, 'BuildNumber', {
      type: 'String',
      default: 'dev',
      description: 'Build number for frontend config version',
    });

    // --- Cognito ---
    const userPool = new cognito.UserPool(this, 'CommitteeUserPool', {
      userPoolName: `${this.stackName}-user-pool`,
      selfSignUpEnabled: true,
      autoVerify: { email: true },
      signInAliases: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      customAttributes: {
        role: new cognito.StringAttribute({ mutable: true }),
      },
    });

    const userPoolClient = userPool.addClient('CommitteeUserPoolClient', {
      userPoolClientName: `${this.stackName}-client`,
      generateSecret: false,
      authFlows: {
        userSrp: true,
      },
    });

    // --- Documents Storage ---
    const documentsBucket = new s3.Bucket(this, 'DocumentsBucket', {
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Keep documents even if stack is destroyed
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // --- Data Storage ---
    const dataBucket = new s3.Bucket(this, 'DataBucket', {
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // --- Backend (Lambda) ---
    // Bundling Go code from ../backend
    const helloFunction = new lambda.Function(this, 'HelloWorldFunction', {
      runtime: lambda.Runtime.PROVIDED_AL2023,
      handler: 'bootstrap',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend'), {
        bundling: {
          image: lambda.Runtime.PROVIDED_AL2023.bundlingImage,
          user: 'root',
          command: [
            'bash', '-c',
            'GOOS=linux GOARCH=amd64 go build -o /asset-output/bootstrap ./cmd/api/main.go',
          ],
        },
      }),
      environment: {
        DOCUMENTS_BUCKET_NAME: documentsBucket.bucketName,
        DATA_BUCKET_NAME: dataBucket.bucketName,
        DOCUMENTS_SIGNING_SECRET: signingSecretParam.valueAsString,
      },
    });

    // Grant permissions
    documentsBucket.grantReadWrite(helloFunction);
    dataBucket.grantReadWrite(helloFunction);

    // --- API Gateway ---
    const certificate = acm.Certificate.fromCertificateArn(this, 'ApiCertificate', certificateArnParam.valueAsString);

    const api = new apigateway.RestApi(this, 'ServerlessRestApi', {
      restApiName: 'Eureka Committee Apps Backend',
      description: 'Eureka Committee Apps Backend',
      deployOptions: {
        stageName: 'Prod',
      },
      defaultCorsPreflightOptions: {
        allowOrigins: ['https://committee.eurekacycling.org.au', 'https://committee2.eurekacycling.org.au'],
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token'],
      },
      domainName: {
        domainName: domainNameParam.valueAsString,
        certificate: certificate,
      },
    });

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CommitteeAuth', {
      cognitoUserPools: [userPool],
    });

    const helloResource = api.root.addResource('hello');
    helloResource.addMethod('GET', new apigateway.LambdaIntegration(helloFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const docsResource = api.root.addResource('documents');

    const listResource = docsResource.addResource('list');
    listResource.addMethod('GET', new apigateway.LambdaIntegration(helloFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const viewResource = docsResource.addResource('view');
    viewResource.addMethod('GET', new apigateway.LambdaIntegration(helloFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const rawResource = docsResource.addResource('raw');
    rawResource.addMethod('GET', new apigateway.LambdaIntegration(helloFunction), {
      authorizationType: apigateway.AuthorizationType.NONE,
    });

    const saveResource = docsResource.addResource('save');
    saveResource.addMethod('POST', new apigateway.LambdaIntegration(helloFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const uploadResource = docsResource.addResource('upload');
    uploadResource.addMethod('POST', new apigateway.LambdaIntegration(helloFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const mkdirResource = docsResource.addResource('mkdir');
    mkdirResource.addMethod('POST', new apigateway.LambdaIntegration(helloFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const ledgerResource = api.root.addResource('ledger');
    ledgerResource.addMethod('GET', new apigateway.LambdaIntegration(helloFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    ledgerResource.addMethod('POST', new apigateway.LambdaIntegration(helloFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const categoryResource = ledgerResource.addResource('categories');
    categoryResource.addMethod('GET', new apigateway.LambdaIntegration(helloFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    categoryResource.addMethod('POST', new apigateway.LambdaIntegration(helloFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // --- Frontend (S3 + CloudFront) ---
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const frontendCertificate = acm.Certificate.fromCertificateArn(this, 'FrontendCertificate', frontendCertificateArnParam.valueAsString);

    const frontendOrigin = origins.S3BucketOrigin.withOriginAccessControl(frontendBucket);

    const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultBehavior: {
        origin: frontendOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      },
      domainNames: ['committee2.eurekacycling.org.au'], // Hardcoded or Parameter? SAM has param but we fixed it in the template earlier. Using Hardcoded alias for now as per previous context or could check params.
      // Wait, SAM template used 'Aliases: - committee.eurekacycling.org.au'.
      // I should probably use a parameter or the hardcoded value.
      certificate: frontendCertificate,
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    const frontendRuntimeConfig = {
      apiBaseUrl: `https://${domainNameParam.valueAsString}`,
      cognito: {
        userPoolId: userPool.userPoolId,
        userPoolClientId: userPoolClient.userPoolClientId,
      },
      version: buildNumberParam.valueAsString,
    };

    const frontendRuntimeConfigJson = cdk.Fn.toJsonString(frontendRuntimeConfig);

    new s3deploy.BucketDeployment(this, 'FrontendRuntimeConfigDeployment', {
      destinationBucket: frontendBucket,
      sources: [
        s3deploy.Source.data('config.json', cdk.Fn.join('', [frontendRuntimeConfigJson, '\n'])),
      ],
      cacheControl: [
        s3deploy.CacheControl.fromString('no-cache, no-store, must-revalidate'),
        s3deploy.CacheControl.fromString('max-age=0'),
      ],
      distribution,
      distributionPaths: ['/config.json'],
    });

    // --- Outputs ---
    new cdk.CfnOutput(this, 'HelloWorldApi', {
      value: api.urlForPath('/hello'),
      description: 'API Gateway endpoint URL for Hello World function',
    });

    new cdk.CfnOutput(this, 'ApiBaseUrl', {
      value: api.url,
      description: 'API Gateway base URL',
    });

    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: frontendBucket.bucketName,
      description: 'S3 Bucket for Frontend Assets',
    });

    new cdk.CfnOutput(this, 'DataBucketName', {
      value: dataBucket.bucketName,
      description: 'S3 Bucket for Data Assets',
    });

    new cdk.CfnOutput(this, 'FrontendDistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront Distribution ID',
    });

    new cdk.CfnOutput(this, 'FrontendUrl', {
      value: `https://${distribution.distributionDomainName}`, // Or generic domain
      description: 'Frontend URL',
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });
  }
}
