package endpoints

import (
	"context"
	"os"
	"reflect"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/eureka-cycling/committee-apps/backend/internal/storage"
)

func TestLedgerGet(t *testing.T) {
	// Skip in CI
	if os.Getenv("CI") != "" {
		t.Skip("skipping test in CI")
	}

	bucketName := "committeeappsbackendprod-databuckete3889a50-hnlnorx7vzql"
	prov, err := storage.NewS3StorageProvider(context.Background(), bucketName)
	if err != nil {
		t.Fatal(err)
	}
	type args struct {
		in0     context.Context
		request events.APIGatewayProxyRequest
		deps    Dependencies
	}
	tests := []struct {
		name    string
		args    args
		want    events.APIGatewayProxyResponse
		wantErr bool
	}{
		{
			name: "Get 2024-12",
			args: args{
				in0: context.Background(),
				request: events.APIGatewayProxyRequest{
					QueryStringParameters: map[string]string{"month": "2024-12", "type": "CASH"},
				},
				deps: Dependencies{
					Data: prov,
				},
			},
			wantErr: false,
			want:    events.APIGatewayProxyResponse{},
		},
		{
			name: "Get 2025-11",
			args: args{
				in0: context.Background(),
				request: events.APIGatewayProxyRequest{
					QueryStringParameters: map[string]string{"month": "2025-11", "type": "CASH"},
				},
				deps: Dependencies{
					Data: prov,
				},
			},
			wantErr: false,
			want:    events.APIGatewayProxyResponse{},
		},
		{
			name: "Get 2025-12",
			args: args{
				in0: context.Background(),
				request: events.APIGatewayProxyRequest{
					QueryStringParameters: map[string]string{"month": "2025-12", "type": "CASH"},
				},
				deps: Dependencies{
					Data: prov,
				},
			},
			wantErr: false,
			want:    events.APIGatewayProxyResponse{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := LedgerGet(tt.args.in0, tt.args.request, tt.args.deps)
			if (err != nil) != tt.wantErr {
				t.Errorf("LedgerGet() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("LedgerGet() got = %v, want %v", got, tt.want)
			}
		})
	}
}
