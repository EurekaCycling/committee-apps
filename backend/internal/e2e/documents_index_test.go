package e2e

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"path"
	"regexp"
	"strings"
	"testing"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider"
	"github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider/types"
)

const appConfigURL = "https://committee2.eurekacycling.org.au/config.json"

type appConfig struct {
	APIBaseURL string `json:"apiBaseUrl"`
	Cognito    struct {
		UserPoolID       string `json:"userPoolId"`
		UserPoolClientID string `json:"userPoolClientId"`
	} `json:"cognito"`
}

type documentItem struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Token   string `json:"token"`
	Expires int64  `json:"expires"`
}

func TestDocumentsIndex(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping e2e test in short mode")
	}

	username := os.Getenv("APP_USER")
	password := os.Getenv("APP_PASS")
	if username == "" || password == "" {
		t.Skip("APP_USER and APP_PASS must be set")
	}

	t.Logf("Using credentials: user=%s pass=%s", username, maskPassword(password))
	t.Logf("Using config URL: %s", appConfigURL)

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	t.Log("Fetching app config")
	config, err := fetchAppConfig(ctx)
	if err != nil {
		t.Fatalf("fetch config: %v", err)
	}
	t.Logf("Config loaded: apiBaseUrl=%s userPoolId=%s clientId=%s", config.APIBaseURL, config.Cognito.UserPoolID, config.Cognito.UserPoolClientID)

	t.Log("Logging into Cognito")
	token, err := login(ctx, config, username, password, os.Getenv("COGNITO_CLIENT_SECRET"))
	if err != nil {
		t.Fatalf("login to cognito: %v", err)
	}
	t.Log("Cognito login succeeded")

	t.Log("Fetching documents list")
	items, err := fetchDocumentList(ctx, config.APIBaseURL, token)
	if err != nil {
		t.Fatalf("fetch documents list: %v", err)
	}
	t.Logf("Documents list returned %d items", len(items))

	indexPath := ""
	for _, item := range items {
		if strings.EqualFold(item.Name, "index.md") {
			indexPath = item.Path
			break
		}
	}
	if indexPath == "" {
		t.Fatalf("index.md not found in documents list")
	}
	t.Logf("Found index.md at %s", indexPath)

	t.Log("Fetching index document")
	content, err := fetchDocument(ctx, config.APIBaseURL, token, indexPath)
	if err != nil {
		t.Fatalf("fetch index document: %v", err)
	}
	if len(content) == 0 {
		t.Fatalf("index document was empty")
	}
	t.Logf("Index document fetched (%d bytes)", len(content))
	t.Logf("Index document contents:\n%s", content)

	imagePaths := extractImagePaths(string(content))
	if len(imagePaths) == 0 {
		t.Log("No images found in index markdown")
		return
	}

	baseDir := path.Dir(indexPath)
	if baseDir == "." {
		baseDir = ""
	}
	itemByPath := make(map[string]documentItem, len(items))
	for _, item := range items {
		itemByPath[item.Path] = item
	}

	for _, imagePath := range imagePaths {
		resolvedPath := resolveDocumentPath(baseDir, imagePath)
		if resolvedPath == "" {
			t.Logf("Skipping external image: %s", imagePath)
			continue
		}
		item, ok := itemByPath[resolvedPath]
		if !ok {
			t.Fatalf("image not found in document list: %s", resolvedPath)
		}
		downloadUrl := buildRawUrl(config.APIBaseURL, resolvedPath, item.Token, item.Expires)
		t.Logf("Image download link: %s", downloadUrl)

		resp, err := doAuthGet(ctx, downloadUrl, token)
		if err != nil {
			t.Fatalf("fetch image link failed: %v", err)
		}
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			t.Fatalf("image link returned %d for %s", resp.StatusCode, resolvedPath)
		}

		hexPreview, count, err := readHexPreview(resp.Body, 64)
		resp.Body.Close()
		if err != nil {
			t.Fatalf("read image preview failed: %v", err)
		}
		imageType := detectImageTypeFromHex(hexPreview)
		if imageType == "" {
			t.Fatalf("image %s does not look like PNG/JPEG/GIF/WEBP", resolvedPath)
		}
		t.Logf("Image %s first %d bytes:\n%s", resolvedPath, count, formatHexDump(hexPreview))
		t.Logf("Image %s detected type: %s", resolvedPath, imageType)
	}
}

func maskPassword(value string) string {
	if value == "" {
		return ""
	}
	if len(value) <= 4 {
		return strings.Repeat("*", len(value))
	}
	return value[:2] + strings.Repeat("*", len(value)-4) + value[len(value)-2:]
}

func fetchAppConfig(ctx context.Context) (appConfig, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, appConfigURL, nil)
	if err != nil {
		return appConfig{}, err
	}

	client := &http.Client{Timeout: 15 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return appConfig{}, err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(response.Body)
		return appConfig{}, fmt.Errorf("config request failed: %s", strings.TrimSpace(string(body)))
	}

	var config appConfig
	decoder := json.NewDecoder(response.Body)
	if err := decoder.Decode(&config); err != nil {
		return appConfig{}, err
	}

	if config.APIBaseURL == "" {
		return appConfig{}, fmt.Errorf("config missing apiBaseUrl")
	}
	if config.Cognito.UserPoolID == "" || config.Cognito.UserPoolClientID == "" {
		return appConfig{}, fmt.Errorf("config missing cognito settings")
	}

	return config, nil
}

func login(ctx context.Context, config appConfig, username, password, clientSecret string) (string, error) {
	region, err := cognitoRegion(config.Cognito.UserPoolID)
	if err != nil {
		return "", err
	}

	awsConfig, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	if err != nil {
		return "", err
	}

	client := cognitoidentityprovider.NewFromConfig(awsConfig)
	response, err := initiateSrpAuth(ctx, client, config, username, password, clientSecret)
	if err != nil {
		return "", err
	}

	token := aws.ToString(response.AuthenticationResult.IdToken)
	if token == "" {
		return "", fmt.Errorf("missing id token in auth response")
	}
	return token, nil
}

func initiateSrpAuth(
	ctx context.Context,
	client *cognitoidentityprovider.Client,
	config appConfig,
	username string,
	password string,
	clientSecret string,
) (*cognitoidentityprovider.RespondToAuthChallengeOutput, error) {
	initSecretHash := ""
	if clientSecret != "" {
		initSecretHash = cognitoSecretHash(username, config.Cognito.UserPoolClientID, clientSecret)
	}

	a, aVal, err := generateSrpA()
	if err != nil {
		return nil, err
	}

	initParams := map[string]string{
		"USERNAME": username,
		"SRP_A":    a,
	}
	if initSecretHash != "" {
		initParams["SECRET_HASH"] = initSecretHash
	}

	response, err := client.InitiateAuth(ctx, &cognitoidentityprovider.InitiateAuthInput{
		AuthFlow:       types.AuthFlowTypeUserSrpAuth,
		ClientId:       aws.String(config.Cognito.UserPoolClientID),
		AuthParameters: initParams,
	})
	if err != nil {
		return nil, err
	}

	if response.ChallengeName != types.ChallengeNameTypePasswordVerifier {
		return nil, fmt.Errorf("unexpected auth challenge: %s", response.ChallengeName)
	}

	challenge := response.ChallengeParameters
	secretBlock := challenge["SECRET_BLOCK"]
	userID := challenge["USER_ID_FOR_SRP"]
	srpB := challenge["SRP_B"]
	salt := challenge["SALT"]

	if secretBlock == "" || userID == "" || srpB == "" || salt == "" {
		return nil, fmt.Errorf("missing SRP challenge parameters")
	}

	passwordClaimSignature, timestamp, err := calculatePasswordClaim(
		config.Cognito.UserPoolID,
		userID,
		password,
		secretBlock,
		salt,
		srpB,
		aVal,
	)
	if err != nil {
		return nil, err
	}

	challengeResponses := map[string]string{
		"USERNAME":                    userID,
		"PASSWORD_CLAIM_SECRET_BLOCK": secretBlock,
		"TIMESTAMP":                   timestamp,
		"PASSWORD_CLAIM_SIGNATURE":    passwordClaimSignature,
	}
	if clientSecret != "" {
		challengeResponses["SECRET_HASH"] = cognitoSecretHash(userID, config.Cognito.UserPoolClientID, clientSecret)
	}

	return client.RespondToAuthChallenge(ctx, &cognitoidentityprovider.RespondToAuthChallengeInput{
		ChallengeName:      types.ChallengeNameTypePasswordVerifier,
		ClientId:           aws.String(config.Cognito.UserPoolClientID),
		ChallengeResponses: challengeResponses,
	})
}

func cognitoRegion(userPoolId string) (string, error) {
	parts := strings.Split(userPoolId, "_")
	if len(parts) < 2 || parts[0] == "" {
		return "", fmt.Errorf("invalid user pool id: %s", userPoolId)
	}
	return parts[0], nil
}

func cognitoSecretHash(username, clientId, clientSecret string) string {
	mac := hmac.New(sha256.New, []byte(clientSecret))
	mac.Write([]byte(username + clientId))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func generateSrpA() (string, *big.Int, error) {
	max := new(big.Int).Sub(srpN, big.NewInt(1))
	a, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", nil, err
	}

	bigA := new(big.Int).Exp(srpG, a, srpN)
	return padHex(bigA), a, nil
}

func calculatePasswordClaim(
	userPoolID string,
	userID string,
	password string,
	secretBlock string,
	saltHex string,
	srpBHex string,
	a *big.Int,
) (string, string, error) {
	poolName := strings.SplitN(userPoolID, "_", 2)
	if len(poolName) < 2 {
		return "", "", fmt.Errorf("invalid user pool id: %s", userPoolID)
	}

	B := bigFromHex(srpBHex)
	if B.Sign() == 0 {
		return "", "", fmt.Errorf("invalid SRP_B value")
	}

	A := new(big.Int).Exp(srpG, a, srpN)
	if new(big.Int).Mod(A, srpN).Sign() == 0 {
		return "", "", fmt.Errorf("invalid SRP_A value")
	}

	u := hexHashToBigInt(padHex(A) + padHex(B))
	if u.Sign() == 0 {
		return "", "", fmt.Errorf("invalid SRP u value")
	}

	userPoolName := poolName[1]
	userPoolName = strings.TrimSpace(userPoolName)

	userHash := hashString(userPoolName + userID + ":" + password)
	salt := bigFromHex(saltHex)
	if salt.Sign() == 0 {
		return "", "", fmt.Errorf("invalid SRP salt")
	}

	x := hexHashToBigInt(padHex(salt) + userHash)

	gModPowX := new(big.Int).Exp(srpG, x, srpN)
	kgx := new(big.Int).Mul(srpK, gModPowX)
	kgx.Mod(kgx, srpN)

	base := new(big.Int).Sub(B, kgx)
	base.Mod(base, srpN)
	if base.Sign() < 0 {
		base.Add(base, srpN)
	}

	exp := new(big.Int).Mul(u, x)
	exp.Add(exp, a)
	S := new(big.Int).Exp(base, exp, srpN)

	key := hkdf(hexToBytes(padHex(S)), padHex(u))

	secretBlockBytes, err := base64.StdEncoding.DecodeString(secretBlock)
	if err != nil {
		return "", "", err
	}

	timestamp := time.Now().UTC().Format("Mon Jan 2 15:04:05 MST 2006")
	msg := []byte(userPoolName + userID)
	msg = append(msg, secretBlockBytes...)
	msg = append(msg, []byte(timestamp)...)

	mac := hmac.New(sha256.New, key)
	mac.Write(msg)
	claim := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return claim, timestamp, nil
}

func hkdf(ikm []byte, saltHex string) []byte {
	salt := hexToBytes(saltHex)
	mac := hmac.New(sha256.New, salt)
	mac.Write(ikm)
	prk := mac.Sum(nil)

	info := []byte("Caldera Derived Key")
	mac = hmac.New(sha256.New, prk)
	mac.Write(info)
	mac.Write([]byte{1})
	return mac.Sum(nil)[:16]
}

func hexHashToBigInt(hexInput string) *big.Int {
	return bigFromHex(hexHash(hexInput))
}

func hashString(value string) string {
	sum := sha256.Sum256([]byte(value))
	return leftPadHex(hex.EncodeToString(sum[:]))
}

func hexHash(hexInput string) string {
	sum := sha256.Sum256(hexToBytes(hexInput))
	return leftPadHex(hex.EncodeToString(sum[:]))
}

func leftPadHex(value string) string {
	if len(value) >= 64 {
		return value
	}
	return strings.Repeat("0", 64-len(value)) + value
}

func bigFromHex(value string) *big.Int {
	result := new(big.Int)
	result.SetString(value, 16)
	return result
}

func padHex(value *big.Int) string {
	hexValue := fmt.Sprintf("%X", value)
	if len(hexValue)%2 == 1 {
		hexValue = "0" + hexValue
	}
	if strings.HasPrefix(hexValue, "8") || strings.HasPrefix(hexValue, "9") || strings.HasPrefix(hexValue, "A") || strings.HasPrefix(hexValue, "B") || strings.HasPrefix(hexValue, "C") || strings.HasPrefix(hexValue, "D") || strings.HasPrefix(hexValue, "E") || strings.HasPrefix(hexValue, "F") {
		hexValue = "00" + hexValue
	}
	return hexValue
}

func hexToBytes(value string) []byte {
	decoded, err := hex.DecodeString(value)
	if err != nil {
		return []byte{}
	}
	return decoded
}

var (
	srpNHex = "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200CBBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF"
	srpN    = bigFromHex(srpNHex)
	srpG    = big.NewInt(2)
	srpK    = bigFromHex(hexHash("00" + srpNHex + "0" + srpG.Text(16)))
)

func fetchDocumentList(ctx context.Context, apiBaseUrl, token string) ([]documentItem, error) {
	listUrl := fmt.Sprintf("%s/documents/list?path=%s", strings.TrimRight(apiBaseUrl, "/"), url.QueryEscape(""))
	response, err := doAuthGet(ctx, listUrl, token)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(response.Body)
		return nil, fmt.Errorf("documents list failed: %s", strings.TrimSpace(string(body)))
	}

	var items []documentItem
	decoder := json.NewDecoder(response.Body)
	if err := decoder.Decode(&items); err != nil {
		return nil, err
	}
	return items, nil
}

func fetchDocument(ctx context.Context, apiBaseUrl, token, path string) ([]byte, error) {
	viewUrl := fmt.Sprintf("%s/documents/view?path=%s", strings.TrimRight(apiBaseUrl, "/"), url.QueryEscape(path))
	response, err := doAuthGet(ctx, viewUrl, token)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(response.Body)
		return nil, fmt.Errorf("documents view failed: %s", strings.TrimSpace(string(body)))
	}

	base64Body, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, err
	}

	content, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(base64Body)))
	if err != nil {
		return nil, err
	}
	return content, nil
}

func doAuthGet(ctx context.Context, requestUrl, token string) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, requestUrl, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	client := &http.Client{Timeout: 20 * time.Second}
	return client.Do(request)
}

func extractImagePaths(markdown string) []string {
	matcher := regexp.MustCompile(`!\[[^\]]*\]\(([^)]+)\)`)
	matches := matcher.FindAllStringSubmatch(markdown, -1)
	paths := make([]string, 0, len(matches))
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		paths = append(paths, strings.TrimSpace(match[1]))
	}
	return paths
}

func resolveDocumentPath(baseDir, imagePath string) string {
	cleanPath := strings.SplitN(imagePath, "?", 2)[0]
	cleanPath = strings.SplitN(cleanPath, "#", 2)[0]
	cleanPath = strings.TrimSpace(cleanPath)
	if cleanPath == "" {
		return ""
	}
	if strings.HasPrefix(cleanPath, "http://") || strings.HasPrefix(cleanPath, "https://") || strings.HasPrefix(cleanPath, "data:") {
		return ""
	}
	cleanPath = strings.TrimPrefix(cleanPath, "/")
	if baseDir == "" {
		return cleanPath
	}
	return path.Clean(path.Join(baseDir, cleanPath))
}

func buildRawUrl(apiBaseUrl, docPath, token string, expires int64) string {
	base := strings.TrimRight(apiBaseUrl, "/")
	return fmt.Sprintf(
		"%s/documents/raw?path=%s&token=%s&expires=%d",
		base,
		url.QueryEscape(docPath),
		url.QueryEscape(token),
		expires,
	)
}

func readHexPreview(reader io.Reader, limit int) (string, int, error) {
	buffer := make([]byte, limit)
	count, err := io.ReadFull(reader, buffer)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return "", 0, err
	}
	return hex.EncodeToString(buffer[:count]), count, nil
}

func detectImageTypeFromHex(hexString string) string {
	data, err := hex.DecodeString(hexString)
	if err != nil || len(data) < 4 {
		return ""
	}
	if len(data) >= 8 && data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4e && data[3] == 0x47 {
		return "png"
	}
	if data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff {
		return "jpeg"
	}
	if len(data) >= 6 && data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 {
		return "gif"
	}
	if len(data) >= 12 && data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46 && data[8] == 0x57 && data[9] == 0x45 && data[10] == 0x42 && data[11] == 0x50 {
		return "webp"
	}
	return ""
}

func formatHexDump(hexString string) string {
	data, err := hex.DecodeString(hexString)
	if err != nil {
		return hexString
	}

	const bytesPerLine = 16
	var builder strings.Builder

	for offset := 0; offset < len(data); offset += bytesPerLine {
		end := offset + bytesPerLine
		if end > len(data) {
			end = len(data)
		}
		line := data[offset:end]

		builder.WriteString(fmt.Sprintf("%08x: ", offset))
		for i := 0; i < bytesPerLine; i++ {
			if i < len(line) {
				builder.WriteString(fmt.Sprintf("%02x ", line[i]))
			} else {
				builder.WriteString("   ")
			}
			if i == 7 {
				builder.WriteString(" ")
			}
		}

		builder.WriteString(" ")
		builder.WriteString(renderUnicodeColumn(line))
		if end < len(data) {
			builder.WriteString("\n")
		}
	}

	return builder.String()
}

func renderUnicodeColumn(data []byte) string {
	if len(data) == 0 {
		return ""
	}

	var builder strings.Builder
	for len(data) > 0 {
		r, size := utf8.DecodeRune(data)
		if r == utf8.RuneError && size == 1 {
			builder.WriteByte('.')
			data = data[1:]
			continue
		}
		if !unicode.IsPrint(r) {
			builder.WriteByte('.')
		} else {
			builder.WriteRune(r)
		}
		data = data[size:]
	}

	return builder.String()
}
