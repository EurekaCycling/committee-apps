package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/polly"
	"github.com/aws/aws-sdk-go-v2/service/polly/types"
)

type ScriptSnippet struct {
	ID       string `json:"id"`
	Text     string `json:"text"`
	SSML     string `json:"ssml"`
	TextType string `json:"textType"`
}

func main() {
	var (
		textFile = flag.String("file", "", "Path to text or SSML file")
		text     = flag.String("text", "", "Inline text or SSML")
		voice    = flag.String("voice", "Olivia", "Polly voice ID")
		engine   = flag.String("engine", "auto", "Polly engine: standard, neural, auto")
		format   = flag.String("format", "mp3", "Output format: mp3, ogg_vorbis, pcm")
		out      = flag.String("out", "polly-output.mp3", "Output audio file")
		region   = flag.String("region", "", "AWS region override")
		textType = flag.String("text-type", "", "text or ssml (auto if omitted)")
		script   = flag.String("script", "", "Path to JSON script for multi-snippet output")
		outDir   = flag.String("out-dir", "", "Output directory for multi-snippet output")
	)
	flag.Parse()

	if *script != "" {
		if *outDir == "" {
			exitWithError(errors.New("--out-dir is required when using --script"))
		}
		if *textFile != "" || *text != "" {
			exitWithError(errors.New("--script cannot be combined with --file or --text"))
		}
		if *out != "polly-output.mp3" {
			exitWithError(errors.New("--out is not used with --script; use --out-dir instead"))
		}
		runMulti(*script, *outDir, *voice, *engine, *format, *region)
		return
	}

	if (*textFile == "" && *text == "") || (*textFile != "" && *text != "") {
		exitWithError(errors.New("provide exactly one of --file or --text"))
	}

	payload, err := loadText(*textFile, *text)
	if err != nil {
		exitWithError(err)
	}

	resolvedTextType, err := resolveTextType(*textType, *textFile, payload)
	if err != nil {
		exitWithError(err)
	}

	outputFormat, err := resolveOutputFormat(*format)
	if err != nil {
		exitWithError(err)
	}

	cfg, err := loadAWSConfig(*region)
	if err != nil {
		exitWithError(err)
	}

	client := polly.NewFromConfig(cfg)
	ctx := context.Background()
	resolvedEngine, err := resolveEngine(ctx, client, *engine, *voice)
	if err != nil {
		exitWithError(err)
	}
	resp, err := client.SynthesizeSpeech(ctx, &polly.SynthesizeSpeechInput{
		Engine:       resolvedEngine,
		OutputFormat: outputFormat,
		Text:         aws.String(payload),
		TextType:     resolvedTextType,
		VoiceId:      types.VoiceId(*voice),
	})
	if err != nil {
		exitWithError(err)
	}
	defer resp.AudioStream.Close()

	if err := writeOutput(*out, resp.AudioStream); err != nil {
		exitWithError(err)
	}

	fmt.Printf("Wrote audio to %s\n", *out)
}

func runMulti(scriptPath string, outDir string, voice string, engine string, format string, region string) {
	snippets, err := loadScript(scriptPath)
	if err != nil {
		exitWithError(err)
	}

	if len(snippets) == 0 {
		exitWithError(errors.New("script contains no snippets"))
	}

	outputFormat, err := resolveOutputFormat(format)
	if err != nil {
		exitWithError(err)
	}

	cfg, err := loadAWSConfig(region)
	if err != nil {
		exitWithError(err)
	}

	client := polly.NewFromConfig(cfg)
	ctx := context.Background()
	resolvedEngine, err := resolveEngine(ctx, client, engine, voice)
	if err != nil {
		exitWithError(err)
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		exitWithError(err)
	}

	ext := outputExtension(outputFormat)
	for i, snippet := range snippets {
		payload := strings.TrimSpace(selectSnippetText(snippet))
		if payload == "" {
			exitWithError(fmt.Errorf("snippet %d is empty", i+1))
		}
		textType, err := resolveSnippetTextType(snippet, payload)
		if err != nil {
			exitWithError(err)
		}

		resp, err := client.SynthesizeSpeech(ctx, &polly.SynthesizeSpeechInput{
			Engine:       resolvedEngine,
			OutputFormat: outputFormat,
			Text:         aws.String(payload),
			TextType:     textType,
			VoiceId:      types.VoiceId(voice),
		})
		if err != nil {
			exitWithError(err)
		}

		name := fmt.Sprintf("%02d-%s.%s", i+1, slugify(snippet.ID), ext)
		path := filepath.Join(outDir, name)
		if err := writeOutput(path, resp.AudioStream); err != nil {
			resp.AudioStream.Close()
			exitWithError(err)
		}
		resp.AudioStream.Close()
		fmt.Printf("Wrote audio to %s\n", path)
	}
}

func loadScript(path string) ([]ScriptSnippet, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var snippets []ScriptSnippet
	if err := json.Unmarshal(data, &snippets); err != nil {
		return nil, err
	}
	for i, snippet := range snippets {
		if strings.TrimSpace(snippet.ID) == "" {
			return nil, fmt.Errorf("snippet %d missing id", i+1)
		}
	}
	return snippets, nil
}

func selectSnippetText(snippet ScriptSnippet) string {
	if strings.TrimSpace(snippet.SSML) != "" {
		return snippet.SSML
	}
	return snippet.Text
}

func resolveSnippetTextType(snippet ScriptSnippet, payload string) (types.TextType, error) {
	if strings.TrimSpace(snippet.TextType) != "" {
		switch strings.ToLower(snippet.TextType) {
		case "text":
			return types.TextTypeText, nil
		case "ssml":
			return types.TextTypeSsml, nil
		default:
			return "", fmt.Errorf("unsupported text type: %s", snippet.TextType)
		}
	}
	if strings.Contains(payload, "<speak>") {
		return types.TextTypeSsml, nil
	}
	return types.TextTypeText, nil
}

func loadText(filePath string, inline string) (string, error) {
	if filePath == "" {
		return strings.TrimSpace(inline), nil
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}

func resolveTextType(explicit string, filePath string, payload string) (types.TextType, error) {
	switch strings.ToLower(explicit) {
	case "":
		if strings.HasSuffix(strings.ToLower(filePath), ".ssml") || strings.Contains(payload, "<speak>") {
			return types.TextTypeSsml, nil
		}
		return types.TextTypeText, nil
	case "text":
		return types.TextTypeText, nil
	case "ssml":
		return types.TextTypeSsml, nil
	default:
		return "", fmt.Errorf("unsupported text type: %s", explicit)
	}
}

func resolveOutputFormat(format string) (types.OutputFormat, error) {
	switch strings.ToLower(format) {
	case "mp3":
		return types.OutputFormatMp3, nil
	case "ogg_vorbis", "ogg":
		return types.OutputFormatOggVorbis, nil
	case "pcm":
		return types.OutputFormatPcm, nil
	default:
		return "", fmt.Errorf("unsupported output format: %s", format)
	}
}

func resolveEngine(ctx context.Context, client *polly.Client, engine string, voice string) (types.Engine, error) {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "", "auto":
		supportsNeural, err := voiceSupportsEngine(ctx, client, voice, types.EngineNeural)
		if err != nil {
			return "", err
		}
		if supportsNeural {
			return types.EngineNeural, nil
		}
		return types.EngineStandard, nil
	case "standard":
		return types.EngineStandard, nil
	case "neural":
		return types.EngineNeural, nil
	default:
		return "", fmt.Errorf("unsupported engine: %s", engine)
	}
}

func voiceSupportsEngine(ctx context.Context, client *polly.Client, voice string, engine types.Engine) (bool, error) {
	input := &polly.DescribeVoicesInput{
		Engine: engine,
	}
	for {
		resp, err := client.DescribeVoices(ctx, input)
		if err != nil {
			return false, err
		}
		for _, v := range resp.Voices {
			if v.Id == types.VoiceId(voice) {
				return true, nil
			}
		}
		if resp.NextToken == nil || *resp.NextToken == "" {
			return false, nil
		}
		input.NextToken = resp.NextToken
	}
}

func outputExtension(format types.OutputFormat) string {
	switch format {
	case types.OutputFormatOggVorbis:
		return "ogg"
	case types.OutputFormatPcm:
		return "pcm"
	default:
		return "mp3"
	}
}

func loadAWSConfig(region string) (aws.Config, error) {
	if region == "" {
		return config.LoadDefaultConfig(context.Background())
	}
	return config.LoadDefaultConfig(context.Background(), config.WithRegion(region))
}

func writeOutput(path string, stream io.Reader) error {
	if path == "" {
		return errors.New("output path is required")
	}
	dir := filepath.Dir(path)
	if dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}

	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()

	if _, err := io.Copy(file, stream); err != nil {
		return err
	}
	return nil
}

func slugify(input string) string {
	value := strings.ToLower(strings.TrimSpace(input))
	re := regexp.MustCompile(`[^a-z0-9]+`)
	value = re.ReplaceAllString(value, "-")
	value = strings.Trim(value, "-")
	if value == "" {
		return "snippet"
	}
	return value
}

func exitWithError(err error) {
	fmt.Fprintf(os.Stderr, "pollyfetch: %v\n", err)
	os.Exit(1)
}
