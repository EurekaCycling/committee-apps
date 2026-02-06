build-HelloWorldFunction:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o bootstrap ./cmd/api/main.go
	cp bootstrap $(ARTIFACTS_DIR)/.

.PHONY: test-e2e

test-e2e:
	op run --env-file=op_env -- go test ./internal/e2e -run TestDocumentsIndex -v
