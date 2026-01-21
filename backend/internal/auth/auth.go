package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
)

// GenerateToken creates an HMAC signature for a path and expiration time
func GenerateToken(path string, expires int64, secret string) string {
	h := hmac.New(sha256.New, []byte(secret))
	data := fmt.Sprintf("%s:%d", path, expires)
	h.Write([]byte(data))
	return hex.EncodeToString(h.Sum(nil))
}

// VerifyToken checks if a given token matches the expected HMAC signature
func VerifyToken(path string, expires int64, token string, secret string) bool {
	expected := GenerateToken(path, expires, secret)
	return hmac.Equal([]byte(token), []byte(expected))
}
