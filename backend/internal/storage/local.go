package storage

import (
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"
	"time"

	"github.com/eureka-cycling/committee-apps/backend/internal/auth"
)

type LocalStorageProvider struct {
	RootDir string
}

func NewLocalStorageProvider(rootDir string) (*LocalStorageProvider, error) {
	absRoot, err := filepath.Abs(rootDir)
	if err != nil {
		return nil, err
	}
	// Ensure root exists
	if err := os.MkdirAll(absRoot, 0755); err != nil {
		return nil, err
	}
	return &LocalStorageProvider{RootDir: absRoot}, nil
}

func (l *LocalStorageProvider) List(path string, secret string) ([]FileItem, error) {
	fullPath := filepath.Join(l.RootDir, path)
	entries, err := ioutil.ReadDir(fullPath)
	if err != nil {
		return nil, err
	}

	var items []FileItem
	for _, entry := range entries {
		itemPath := filepath.Join(path, entry.Name())
		url := ""
		if !entry.IsDir() {
			url, _ = l.GetURL(itemPath, secret)
		}

		items = append(items, FileItem{
			Name:    entry.Name(),
			Path:    itemPath,
			IsDir:   entry.IsDir(),
			Size:    entry.Size(),
			ModTime: entry.ModTime(),
			URL:     url,
		})
	}
	return items, nil
}

func (l *LocalStorageProvider) Get(path string) ([]byte, error) {
	fullPath := filepath.Join(l.RootDir, path)
	return ioutil.ReadFile(fullPath)
}

func (l *LocalStorageProvider) GetURL(path string, secret string) (string, error) {
	expires := time.Now().Add(24 * time.Hour).Unix()
	token := auth.GenerateToken(path, expires, secret)
	return fmt.Sprintf("/documents/raw?path=%s&expires=%d&token=%s", path, expires, token), nil
}

func (l *LocalStorageProvider) Save(path string, content []byte) error {
	fullPath := filepath.Join(l.RootDir, path)
	// Ensure parent directory exists
	if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
		return err
	}
	return ioutil.WriteFile(fullPath, content, 0644)
}

func (l *LocalStorageProvider) Mkdir(path string) error {
	fullPath := filepath.Join(l.RootDir, path)
	return os.MkdirAll(fullPath, 0755)
}

func (l *LocalStorageProvider) Delete(path string) error {
	fullPath := filepath.Join(l.RootDir, path)
	return os.RemoveAll(fullPath)
}
