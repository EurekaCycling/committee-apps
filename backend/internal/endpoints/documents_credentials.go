package endpoints

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sts"
)

const defaultDocumentsCredentialsDurationSeconds = 900

type documentsCredentialsResponse struct {
	AccessKeyId     string    `json:"accessKeyId"`
	SecretAccessKey string    `json:"secretAccessKey"`
	SessionToken    string    `json:"sessionToken"`
	Expiration      time.Time `json:"expiration"`
	Bucket          string    `json:"bucket"`
	Region          string    `json:"region"`
}

func DocumentsCredentials(ctx context.Context, _ events.APIGatewayProxyRequest, deps Dependencies) (events.APIGatewayProxyResponse, error) {
	roleArn := os.Getenv("DOCUMENTS_ASSUME_ROLE_ARN")
	if roleArn == "" {
		return errorResponse(fmt.Errorf("documents assume role ARN not configured"), deps.Headers), nil
	}

	durationSeconds := defaultDocumentsCredentialsDurationSeconds
	durationStr := os.Getenv("DOCUMENTS_CREDENTIALS_DURATION_SECONDS")
	if durationStr != "" {
		parsed, err := strconv.Atoi(durationStr)
		if err != nil {
			return errorResponse(fmt.Errorf("invalid documents credentials duration"), deps.Headers), nil
		}
		durationSeconds = parsed
	}

	if durationSeconds < 900 {
		return errorResponse(fmt.Errorf("documents credentials duration must be at least 900 seconds"), deps.Headers), nil
	}

	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return errorResponse(err, deps.Headers), nil
	}

	client := sts.NewFromConfig(cfg)
	output, err := client.AssumeRole(ctx, &sts.AssumeRoleInput{
		RoleArn:         aws.String(roleArn),
		RoleSessionName: aws.String("documents-access"),
		DurationSeconds: aws.Int32(int32(durationSeconds)),
	})
	if err != nil {
		return errorResponse(err, deps.Headers), nil
	}
	if output.Credentials == nil {
		return errorResponse(fmt.Errorf("assume role returned no credentials"), deps.Headers), nil
	}

	response := documentsCredentialsResponse{
		AccessKeyId:     aws.ToString(output.Credentials.AccessKeyId),
		SecretAccessKey: aws.ToString(output.Credentials.SecretAccessKey),
		SessionToken:    aws.ToString(output.Credentials.SessionToken),
		Expiration:      aws.ToTime(output.Credentials.Expiration),
		Bucket:          os.Getenv("DOCUMENTS_BUCKET_NAME"),
		Region:          cfg.Region,
	}

	body, _ := json.Marshal(response)
	return events.APIGatewayProxyResponse{Body: string(body), StatusCode: 200, Headers: deps.Headers}, nil
}
