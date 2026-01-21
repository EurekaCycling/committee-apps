package storage

import (
	"time"
)

// FileItem represents a single file or directory in the storage provider
type FileItem struct {
	Name    string    `json:"name"`
	Path    string    `json:"path"`
	IsDir   bool      `json:"isDir"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"modTime"`
}

// StorageProvider defines the interface for backend file operations
type StorageProvider interface {
	List(path string) ([]FileItem, error)
	Get(path string) ([]byte, error)
	Save(path string, content []byte) error
	Delete(path string) error
}
