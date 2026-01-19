.PHONY: build start-api

build:
	sam build

start-api:
	sam local start-api
