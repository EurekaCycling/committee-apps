package storage

import (
	"io/ioutil"
	"os"
	"path/filepath"
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

func (l *LocalStorageProvider) List(path string) ([]FileItem, error) {
	fullPath := filepath.Join(l.RootDir, path)
	entries, err := ioutil.ReadDir(fullPath)
	if err != nil {
		return nil, err
	}

	var items []FileItem
	for _, entry := range entries {
		items = append(items, FileItem{
			Name:    entry.Name(),
			Path:    filepath.Join(path, entry.Name()),
			IsDir:   entry.IsDir(),
			Size:    entry.Size(),
			ModTime: entry.ModTime(),
		})
	}
	return items, nil
}

func (l *LocalStorageProvider) Get(path string) ([]byte, error) {
	fullPath := filepath.Join(l.RootDir, path)
	return ioutil.ReadFile(fullPath)
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
