package storage

import (
	"os"
	"reflect"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/s3"
)

func TestS3StorageProvider_List(t *testing.T) {

	// Exclude from CI
	if os.Getenv("CI") != "" {
		t.Skip("skipping test in CI")
	}

	type fields struct {
		Client *s3.Client
		Bucket string
	}
	type args struct {
		path string
	}
	tests := []struct {
		name    string
		fields  fields
		args    args
		want    []FileItem
		wantErr bool
	}{
		{
			name: "List",
			fields: fields{
				Client: nil,
				Bucket: "",
			},
			args:    args{path: ""},
			want:    nil,
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &S3StorageProvider{
				Client: tt.fields.Client,
				Bucket: tt.fields.Bucket,
			}
			got, err := s.List(tt.args.path)
			if (err != nil) != tt.wantErr {
				t.Errorf("List() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("List() got = %v, want %v", got, tt.want)
			}
		})
	}
}
