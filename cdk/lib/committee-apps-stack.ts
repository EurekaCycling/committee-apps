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
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';

export interface CommitteeAppsStackProps extends cdk.StackProps {
  apiDomainName: string;
  frontendDomainName: string;
  apiStageName: string;
  corsOrigins: string[];
  apiCertificateArn: string;
  frontendCertificateArn: string;
  buildNumber: string;
}

export class CommitteeAppsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CommitteeAppsStackProps) {
    super(scope, id, props);

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
      },
    });

    const documentsAccessRole = new iam.Role(this, 'DocumentsAccessRole', {
      assumedBy: new iam.ArnPrincipal(helloFunction.role!.roleArn),
    });

    documentsBucket.grantReadWrite(documentsAccessRole);

    helloFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: [documentsAccessRole.roleArn],
    }));

    helloFunction.addEnvironment('DOCUMENTS_ASSUME_ROLE_ARN', documentsAccessRole.roleArn);
    helloFunction.addEnvironment('DOCUMENTS_CREDENTIALS_DURATION_SECONDS', '900');

    // Grant permissions
    documentsBucket.grantReadWrite(helloFunction);
    dataBucket.grantReadWrite(helloFunction);

    // --- API Gateway ---
    const certificate = acm.Certificate.fromCertificateArn(this, 'ApiCertificate', props.apiCertificateArn);

    const apiGatewayLogsRole = new iam.Role(this, 'ApiGatewayLogsRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
    });

    apiGatewayLogsRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonAPIGatewayPushToCloudWatchLogs')
    );

    apiGatewayLogsRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:DescribeLogGroups',
        'logs:DescribeLogStreams',
        'logs:PutLogEvents',
        'logs:GetLogEvents',
        'logs:FilterLogEvents',
      ],
      resources: ['*'],
    }));

    const apiGatewayAccount = new apigateway.CfnAccount(this, 'ApiGatewayAccount', {
      cloudWatchRoleArn: apiGatewayLogsRole.roleArn,
    });

    const apiLogGroup = new logs.LogGroup(this, 'ApiGatewayAccessLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
    });

    const api = new apigateway.RestApi(this, 'ServerlessRestApi', {
      restApiName: 'Eureka Committee Apps Backend',
      description: 'Eureka Committee Apps Backend',
      binaryMediaTypes: [
        'application/pdf',
        'image/apng',
        'image/avif',
        'image/gif',
        'image/jpeg',
        'image/png',
        'image/webp',
        'text/html',
      ],
      deployOptions: {
        stageName: props.apiStageName,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
        accessLogDestination: new apigateway.LogGroupLogDestination(apiLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
      },
      defaultCorsPreflightOptions: {
        allowOrigins: props.corsOrigins,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token'],
      },
      domainName: {
        domainName: props.apiDomainName,
        certificate: certificate,
      },
    });

    api.deploymentStage.node.addDependency(apiGatewayAccount);

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

    const credentialsResource = docsResource.addResource('credentials');
    credentialsResource.addMethod('GET', new apigateway.LambdaIntegration(helloFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const viewResource = docsResource.addResource('view');
    viewResource.addMethod('GET', new apigateway.LambdaIntegration(helloFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
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

    const ledgerTransactionsResource = ledgerResource.addResource('transactions');
    ledgerTransactionsResource.addMethod('POST', new apigateway.LambdaIntegration(helloFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const ledgerTransactionsEditResource = ledgerTransactionsResource.addResource('edit');
    ledgerTransactionsEditResource.addMethod('POST', new apigateway.LambdaIntegration(helloFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const ledgerImportResource = ledgerResource.addResource('import');
    ledgerImportResource.addMethod('POST', new apigateway.LambdaIntegration(helloFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    const ledgerImportBankResource = ledgerImportResource.addResource('bank');
    ledgerImportBankResource.addMethod('POST', new apigateway.LambdaIntegration(helloFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const ledgerPdfResource = ledgerResource.addResource('pdf');
    ledgerPdfResource.addMethod('GET', new apigateway.LambdaIntegration(helloFunction), {
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

    const reportsResource = api.root.addResource('reports');
    const financialReportsResource = reportsResource.addResource('financial');
    financialReportsResource.addMethod('GET', new apigateway.LambdaIntegration(helloFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const reimbursementsResource = api.root.addResource('reimbursements');
    reimbursementsResource.addMethod('POST', new apigateway.LambdaIntegration(helloFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const reimbursementResource = api.root.addResource('reimbursement');
    reimbursementResource.addMethod('GET', new apigateway.LambdaIntegration(helloFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // --- Frontend (S3 + CloudFront) ---
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const frontendCertificate = acm.Certificate.fromCertificateArn(this, 'FrontendCertificate', props.frontendCertificateArn);

    const frontendOrigin = origins.S3BucketOrigin.withOriginAccessControl(frontendBucket);

    const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultBehavior: {
        origin: frontendOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      },
      domainNames: [props.frontendDomainName],
      certificate: frontendCertificate,
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    const frontendRuntimeConfig = {
      apiBaseUrl: `https://${props.apiDomainName}`,
      documentS3Base: documentsBucket.bucketWebsiteUrl,
      cognito: {
        userPoolId: userPool.userPoolId,
        userPoolClientId: userPoolClient.userPoolClientId,
      },
      version: props.buildNumber,
    };

    const frontendRuntimeConfigJson = cdk.Fn.toJsonString(frontendRuntimeConfig);

    new s3deploy.BucketDeployment(this, 'FrontendRuntimeConfigDeployment', {
      destinationBucket: frontendBucket,
      sources: [
        s3deploy.Source.data('config.json', cdk.Fn.join('', [frontendRuntimeConfigJson, '\n'])),
      ],
      prune: false,
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
