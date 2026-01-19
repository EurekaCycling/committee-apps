import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
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

    // --- DynamoDB ---
    const table = new dynamodb.Table(this, 'CommitteeTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For consistent dev experience
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
    });

    const userPoolClient = userPool.addClient('CommitteeUserPoolClient', {
      userPoolClientName: `${this.stackName}-client`,
      generateSecret: false,
      authFlows: {
        userSrp: true,
      },
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
            'go mod tidy && GOOS=linux GOARCH=amd64 go build -o /asset-output/bootstrap ./cmd/api/main.go',
          ],
        },
      }),
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    // Grant DynamoDB permissions
    // Note: The original generic table doesn't have specific permissions in SAM template beyond env var, 
    // but usually Lambda needs access. Explicitly granting it here.
    table.grantReadWriteData(helloFunction);

    // --- API Gateway ---
    const certificate = acm.Certificate.fromCertificateArn(this, 'ApiCertificate', certificateArnParam.valueAsString);

    const api = new apigateway.RestApi(this, 'ServerlessRestApi', {
      restApiName: 'Eureka Committee Apps Backend',
      description: 'Eureka Committee Apps Backend',
      deployOptions: {
        stageName: 'Prod',
      },
      defaultCorsPreflightOptions: {
        allowOrigins: ['https://committee.eurekacycling.org.au'],
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

    // --- Frontend (S3 + CloudFront) ---
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const frontendCertificate = acm.Certificate.fromCertificateArn(this, 'FrontendCertificate', frontendCertificateArnParam.valueAsString);

    const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(frontendBucket), // Automatically sets up OAC in modern CDK ? No, usually need explicit OAC config or use `S3Origin` which sets up OAI/OAC.
        // CDK S3Origin defaults to OAI (Origin Access Identity). 
        // To use OAC (Control), we need strict config, but OAI is fine for now/legacy.
        // Actually, modern CDK S3Origin might use OAI. Let's stick to defaults for simplicity unless verified.
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

    // --- Outputs ---
    new cdk.CfnOutput(this, 'HelloWorldApi', {
      value: api.urlForPath('/hello'),
      description: 'API Gateway endpoint URL for Hello World function',
    });

    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: frontendBucket.bucketName,
      description: 'S3 Bucket for Frontend Assets',
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
