package main

import (
	"context"
	"flag"
	"fmt"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

const defaultBucketName = "committeeappsbackendprod-databuckete3889a50-hnlnorx7vzql"

type versionInfo struct {
	VersionID    string
	LastModified time.Time
	IsLatest     bool
}

func main() {
	flag.Parse()
	args := flag.Args()
	if len(args) < 2 {
		fmt.Println("Usage: go run ./backend/tools/reset-ledger CASH 2026-01")
		os.Exit(2)
	}

	ledgerValue := strings.ToUpper(strings.TrimSpace(args[0]))
	monthValue := strings.TrimSpace(args[1])
	if _, err := time.Parse("2006-01", monthValue); err != nil {
		fmt.Printf("Invalid month %q, expected YYYY-MM\n", monthValue)
		os.Exit(2)
	}

	key := fmt.Sprintf("ledger/%s/%s.json", ledgerValue, monthValue)

	ctx := context.Background()
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		fmt.Printf("Failed to load AWS config: %v\n", err)
		os.Exit(1)
	}

	client := s3.NewFromConfig(cfg)
	versions, err := listVersions(ctx, client, defaultBucketName, key)
	if err != nil {
		fmt.Printf("Failed to list versions: %v\n", err)
		os.Exit(1)
	}

	if len(versions) < 2 {
		fmt.Printf("Not enough versions to reset %s in %s\n", key, defaultBucketName)
		os.Exit(1)
	}

	sort.Slice(versions, func(i, j int) bool {
		return versions[i].LastModified.After(versions[j].LastModified)
	})

	from := versions[1]
	copySource := buildCopySource(defaultBucketName, key, from.VersionID)
	_, err = client.CopyObject(ctx, &s3.CopyObjectInput{
		Bucket:     aws.String(defaultBucketName),
		Key:        aws.String(key),
		CopySource: aws.String(copySource),
	})
	if err != nil {
		fmt.Printf("Failed to reset ledger: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Reset %s to version %s (%s)\n", key, from.VersionID, from.LastModified.UTC().Format(time.RFC3339))
}

func listVersions(ctx context.Context, client *s3.Client, bucket, key string) ([]versionInfo, error) {
	items := make([]versionInfo, 0)
	input := &s3.ListObjectVersionsInput{
		Bucket: aws.String(bucket),
		Prefix: aws.String(key),
	}

	for {
		resp, err := client.ListObjectVersions(ctx, input)
		if err != nil {
			return nil, err
		}

		for _, version := range resp.Versions {
			if version.Key == nil || *version.Key != key {
				continue
			}
			item := versionInfo{
				VersionID: aws.ToString(version.VersionId),
				LastModified: func() time.Time {
					if version.LastModified != nil {
						return *version.LastModified
					}
					return time.Time{}
				}(),
				IsLatest: aws.ToBool(version.IsLatest),
			}
			items = append(items, item)
		}

		if !aws.ToBool(resp.IsTruncated) {
			break
		}
		input.KeyMarker = resp.NextKeyMarker
		input.VersionIdMarker = resp.NextVersionIdMarker
	}

	return items, nil
}

func buildCopySource(bucket, key, versionID string) string {
	base := url.PathEscape(bucket + "/" + key)
	if versionID == "" {
		return base
	}
	return base + "?versionId=" + url.QueryEscape(versionID)
}
