package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type versionItem struct {
	Key            string
	VersionID      string
	LastModified   time.Time
	IsLatest       bool
	Size           int64
	ETag           string
	IsDeleteMarker bool
}

const defaultBucketName = "committeeappsbackendprod-databuckete3889a50-hnlnorx7vzql"

func main() {
	flag.Parse()

	args := flag.Args()
	if len(args) < 2 {
		fmt.Println("Usage: go run ./backend/tools/ledger-versions CASH 2026-01")
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
	items, err := listObjectVersions(ctx, client, defaultBucketName, key)
	if err != nil {
		fmt.Printf("Failed to list versions: %v\n", err)
		os.Exit(1)
	}

	if len(items) == 0 {
		fmt.Printf("No versions found for %s in %s\n", key, defaultBucketName)
		return
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].LastModified.After(items[j].LastModified)
	})

	fmt.Printf("Bucket: %s\n", defaultBucketName)
	fmt.Printf("Key: %s\n", key)
	fmt.Printf("Found: %d\n", len(items))
	fmt.Println("VersionId\tLastModified\tIsLatest\tIsDeleteMarker\tSize\tETag")
	for _, item := range items {
		lastModified := ""
		if !item.LastModified.IsZero() {
			lastModified = item.LastModified.UTC().Format(time.RFC3339)
		}
		fmt.Printf("%s\t%s\t%t\t%t\t%d\t%s\n", item.VersionID, lastModified, item.IsLatest, item.IsDeleteMarker, item.Size, item.ETag)
	}
}

func listObjectVersions(ctx context.Context, client *s3.Client, bucket, key string) ([]versionItem, error) {
	items := make([]versionItem, 0)
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
			item := versionItem{
				Key:      key,
				IsLatest: aws.ToBool(version.IsLatest),
				Size:     aws.ToInt64(version.Size),
				ETag:     aws.ToString(version.ETag),
			}
			if version.VersionId != nil {
				item.VersionID = *version.VersionId
			}
			if version.LastModified != nil {
				item.LastModified = *version.LastModified
			}
			items = append(items, item)
		}

		for _, marker := range resp.DeleteMarkers {
			if marker.Key == nil || *marker.Key != key {
				continue
			}
			item := versionItem{
				Key:            key,
				IsLatest:       aws.ToBool(marker.IsLatest),
				IsDeleteMarker: true,
			}
			if marker.VersionId != nil {
				item.VersionID = *marker.VersionId
			}
			if marker.LastModified != nil {
				item.LastModified = *marker.LastModified
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
