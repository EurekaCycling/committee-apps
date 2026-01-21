package storage

import (
	"context"
	"io/ioutil"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type S3StorageProvider struct {
	Client *s3.Client
	Bucket string
}

func NewS3StorageProvider(ctx context.Context, bucket string) (*S3StorageProvider, error) {
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, err
	}
	client := s3.NewFromConfig(cfg)
	return &S3StorageProvider{Client: client, Bucket: bucket}, nil
}

func (s *S3StorageProvider) List(path string) ([]FileItem, error) {
	if path != "" && !strings.HasSuffix(path, "/") {
		path += "/"
	}

	params := &s3.ListObjectsV2Input{
		Bucket:    aws.String(s.Bucket),
		Prefix:    aws.String(path),
		Delimiter: aws.String("/"),
	}

	result, err := s.Client.ListObjectsV2(context.TODO(), params)
	if err != nil {
		return nil, err
	}

	var items []FileItem

	// Directories (CommonPrefixes)
	for _, prefix := range result.CommonPrefixes {
		name := strings.TrimPrefix(*prefix.Prefix, path)
		name = strings.TrimSuffix(name, "/")
		items = append(items, FileItem{
			Name:  name,
			Path:  *prefix.Prefix,
			IsDir: true,
		})
	}

	// Files (Contents)
	for _, obj := range result.Contents {
		if *obj.Key == path {
			continue // Skip the directory itself if it shows up
		}
		name := strings.TrimPrefix(*obj.Key, path)
		if name == "" {
			continue
		}
		items = append(items, FileItem{
			Name:    name,
			Path:    *obj.Key,
			IsDir:   false,
			Size:    *obj.Size,
			ModTime: *obj.LastModified,
		})
	}

	return items, nil
}

func (s *S3StorageProvider) Get(path string) ([]byte, error) {
	result, err := s.Client.GetObject(context.TODO(), &s3.GetObjectInput{
		Bucket: aws.String(s.Bucket),
		Key:    aws.String(path),
	})
	if err != nil {
		return nil, err
	}
	defer result.Body.Close()
	return ioutil.ReadAll(result.Body)
}

func (s *S3StorageProvider) Save(path string, content []byte) error {
	_, err := s.Client.PutObject(context.TODO(), &s3.PutObjectInput{
		Bucket: aws.String(s.Bucket),
		Key:    aws.String(path),
		Body:   strings.NewReader(string(content)),
	})
	return err
}

func (s *S3StorageProvider) Mkdir(path string) error {
	if !strings.HasSuffix(path, "/") {
		path += "/"
	}
	_, err := s.Client.PutObject(context.TODO(), &s3.PutObjectInput{
		Bucket: aws.String(s.Bucket),
		Key:    aws.String(path),
	})
	return err
}

func (s *S3StorageProvider) Delete(path string) error {
	_, err := s.Client.DeleteObject(context.TODO(), &s3.DeleteObjectInput{
		Bucket: aws.String(s.Bucket),
		Key:    aws.String(path),
	})
	return err
}
