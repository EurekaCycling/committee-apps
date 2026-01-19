build-HelloWorldFunction:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o bootstrap ./cmd/api/main.go
	cp bootstrap $(ARTIFACTS_DIR)/.
