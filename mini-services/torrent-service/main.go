package main

import (
        "bytes"
        "fmt"
        "io"
        "net/http"
        "net/url"
        "os"
        "path"
        "path/filepath"
        "sort"
        "strconv"
        "strings"
        "sync"
        "time"

        "github.com/anacrolix/torrent"
        "github.com/anacrolix/torrent/metainfo"
        "github.com/gin-contrib/cors"
        "github.com/gin-gonic/gin"
        "github.com/google/uuid"
)

// ===== Constants =====

const (
        Port        = "3003"
        DownloadDir = "/home/z/my-project/download"
)

// ===== Types =====

// TorrentEntry holds runtime state for a torrent
type TorrentEntry struct {
        ID        string
        Torrent   *torrent.Torrent
        Magnet    string
        CreatedAt int64
        Error     string

        // Speed tracking
        lastBytes       int64
        lastTime        time.Time
        downloadSpeed   int64 // bytes/sec
        uploadSpeed     int64 // bytes/sec
        bytesUploaded   int64 // cumulative
        mu              sync.Mutex
}

func (e *TorrentEntry) updateSpeed() {
        e.mu.Lock()
        defer e.mu.Unlock()
        now := time.Now()
        bytesCompleted := e.Torrent.BytesCompleted()

        // Get cumulative upload bytes from torrent stats
        stats := e.Torrent.Stats()
        uploadBytes := stats.BytesWritten.Int64() // BytesWritten is a Count (cumulative bytes sent to peers)

        elapsed := now.Sub(e.lastTime).Seconds()
        if elapsed > 0 && e.lastTime.UnixNano() > 0 {
                e.downloadSpeed = int64(float64(bytesCompleted-e.lastBytes) / elapsed)
                e.uploadSpeed = int64(float64(uploadBytes-e.bytesUploaded) / elapsed)
                if e.downloadSpeed < 0 {
                        e.downloadSpeed = 0
                }
                if e.uploadSpeed < 0 {
                        e.uploadSpeed = 0
                }
        }
        e.lastBytes = bytesCompleted
        e.bytesUploaded = uploadBytes
        e.lastTime = now
}

// TorrentFileResponse is the JSON shape for a file in a torrent
type TorrentFileResponse struct {
        Index      int     `json:"index"`
        Name       string  `json:"name"`
        Length     int64   `json:"length"`
        Downloaded int64   `json:"downloaded"`
        Progress   float64 `json:"progress"`
        Path       string  `json:"path"`
        Done       bool    `json:"done"`
        Streamable bool    `json:"streamable"`
        IsVideo    bool    `json:"isVideo"`
        IsAudio    bool    `json:"isAudio"`
        IsImage    bool    `json:"isImage"`
        IsSubtitle bool    `json:"isSubtitle"`
        Ext        string  `json:"ext"`
}

// TorrentResponse is the JSON shape for a torrent
type TorrentResponse struct {
        ID            string                `json:"id"`
        InfoHash      string                `json:"infoHash"`
        MagnetURI     string                `json:"magnetURI"`
        Name          string                `json:"name"`
        Progress      float64               `json:"progress"`
        Downloaded    int64                 `json:"downloaded"`
        Uploaded      int64                 `json:"uploaded"`
        DownloadSpeed int64                 `json:"downloadSpeed"`
        UploadSpeed   int64                 `json:"uploadSpeed"`
        NumPeers      int                   `json:"numPeers"`
        Ready         bool                  `json:"ready"`
        Paused        bool                  `json:"paused"`
        Length        int64                 `json:"length"`
        CreatedAt     int64                 `json:"createdAt"`
        Error         string                `json:"error,omitempty"`
        Files         []TorrentFileResponse `json:"files"`
}

// ===== Globals =====

var (
        client    *torrent.Client
        torrents  sync.Map // map[string]*TorrentEntry
)

// ===== Content type detection =====

var contentTypes = map[string]string{
        "mp4": "video/mp4", "m4v": "video/mp4", "webm": "video/webm",
        "mkv": "video/x-matroska", "avi": "video/x-msvideo", "mov": "video/quicktime",
        "wmv": "video/x-ms-wmv", "flv": "video/x-flv", "ts": "video/mp2t", "mpeg": "video/mpeg", "mpg": "video/mpeg",
        "mp3": "audio/mpeg", "m4a": "audio/mp4", "wav": "audio/wav", "flac": "audio/flac",
        "ogg": "audio/ogg", "oga": "audio/ogg", "aac": "audio/aac", "opus": "audio/opus",
        "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif",
        "webp": "image/webp", "bmp": "image/bmp", "svg": "image/svg+xml",
        "pdf": "application/pdf", "txt": "text/plain", "srt": "text/plain", "vtt": "text/vtt",
        "epub": "application/epub+zip", "mobi": "application/x-mobipocket-ebook",
        "zip": "application/zip", "rar": "application/x-rar-compressed", "7z": "application/x-7z-compressed",
        "tar": "application/x-tar", "gz": "application/gzip",
}

func getExt(name string) string {
        idx := strings.LastIndex(name, ".")
        if idx < 0 || idx == len(name)-1 {
                return ""
        }
        return strings.ToLower(name[idx+1:])
}

func getContentType(name string) string {
        if ct, ok := contentTypes[getExt(name)]; ok {
                return ct
        }
        return "application/octet-stream"
}

func isVideo(name string) bool {
        switch getExt(name) {
        case "mp4", "m4v", "webm", "mkv", "mov", "avi", "flv", "ts", "mpeg", "mpg":
                return true
        }
        return false
}

func isAudio(name string) bool {
        switch getExt(name) {
        case "mp3", "m4a", "wav", "flac", "ogg", "oga", "aac", "opus":
                return true
        }
        return false
}

func isImage(name string) bool {
        switch getExt(name) {
        case "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg":
                return true
        }
        return false
}

func isSubtitle(name string) bool {
        switch getExt(name) {
        case "srt", "vtt", "ass", "ssa", "sub":
                return true
        }
        return false
}

func isStreamable(name string) bool {
        return isVideo(name) || isAudio(name) || isImage(name) || isSubtitle(name)
}

// ===== Serialization =====

func serializeTorrent(entry *TorrentEntry) TorrentResponse {
        t := entry.Torrent
        infoHash := t.InfoHash().HexString()

        name := infoHash
        if len(infoHash) >= 16 {
                name = infoHash[:16] + "..."
        }
        if n := t.Name(); n != "" {
                name = n
        }

        var files []TorrentFileResponse = []TorrentFileResponse{}
        // Files() panics if metadata isn't loaded yet - guard with Info() check
        if t.Info() != nil {
                tfiles := t.Files() // []*File
                for i, f := range tfiles {
                        length := f.Length()
                        downloaded := f.BytesCompleted()
                        progress := 0.0
                        if length > 0 {
                                progress = float64(downloaded) / float64(length)
                        }
                        fname := f.Path()
                        files = append(files, TorrentFileResponse{
                                Index:      i,
                                Name:       fname,
                                Length:     length,
                                Downloaded: downloaded,
                                Progress:   progress,
                                Path:       f.Path(),
                                Done:       downloaded >= length,
                                Streamable: isStreamable(fname),
                                IsVideo:    isVideo(fname),
                                IsAudio:    isAudio(fname),
                                IsImage:    isImage(fname),
                                IsSubtitle: isSubtitle(fname),
                                Ext:        getExt(fname),
                        })
                }
        }

        totalLength := t.Length()
        downloaded := t.BytesCompleted()
        progress := 0.0
        if totalLength > 0 {
                progress = float64(downloaded) / float64(totalLength)
        }

        stats := t.Stats()

        entry.mu.Lock()
        downSpeed := entry.downloadSpeed
        upSpeed := entry.uploadSpeed
        upBytes := entry.bytesUploaded
        entry.mu.Unlock()

        return TorrentResponse{
                ID:            entry.ID,
                InfoHash:      infoHash,
                MagnetURI:     entry.Magnet,
                Name:          name,
                Progress:      progress,
                Downloaded:    downloaded,
                Uploaded:      upBytes,
                DownloadSpeed: downSpeed,
                UploadSpeed:   upSpeed,
                NumPeers:      stats.TotalPeers,
                Ready:         t.Info() != nil,
                Paused:        false,
                Length:        totalLength,
                CreatedAt:     entry.CreatedAt,
                Error:         entry.Error,
                Files:         files,
        }
}

// ===== Handlers =====

func healthHandler(c *gin.Context) {
        count := 0
        torrents.Range(func(_, _ any) bool {
                count++
                return true
        })
        c.JSON(200, gin.H{"ok": true, "port": Port, "torrents": count})
}

func addTorrentHandler(c *gin.Context) {
        var magnet string
        var infoHashStr string

        // Try multipart upload (.torrent file)
        if file, _, err := c.Request.FormFile("torrent"); err == nil {
                defer file.Close()
                buf := new(bytes.Buffer)
                io.Copy(buf, file)
                mi, err := metainfo.Load(buf)
                if err != nil {
                        c.JSON(400, gin.H{"error": "Invalid .torrent file: " + err.Error()})
                        return
                }
                m := mi.Magnet(nil, nil)
                magnet = m.String()
                infoHashStr = mi.HashInfoBytes().HexString()
        } else {
                // Try JSON magnet
                var body struct {
                        Magnet string `json:"magnet"`
                }
                if err := c.ShouldBindJSON(&body); err != nil {
                        c.JSON(400, gin.H{"error": "No magnet or .torrent file provided"})
                        return
                }
                if body.Magnet == "" {
                        c.JSON(400, gin.H{"error": "No magnet link provided"})
                        return
                }
                magnet = body.Magnet
                m, err := metainfo.ParseMagnetUri(magnet)
                if err != nil {
                        c.JSON(400, gin.H{"error": "Invalid magnet link format: " + err.Error()})
                        return
                }
                infoHashStr = m.InfoHash.HexString()
        }

        // Check duplicates
        var existingID string
        torrents.Range(func(key, value any) bool {
                entry := value.(*TorrentEntry)
                if entry.Torrent.InfoHash().HexString() == infoHashStr {
                        existingID = key.(string)
                        return false
                }
                return true
        })
        if existingID != "" {
                c.JSON(200, gin.H{"id": existingID, "existing": true})
                return
        }

        id := uuid.NewString()
        if len(id) > 12 {
                id = id[:12]
        }

        fmt.Printf("[+] Adding torrent %s: %s...\n", id, truncate(magnet, 80))

        t, err := client.AddMagnet(magnet)
        if err != nil {
                c.JSON(500, gin.H{"error": "Failed to add magnet: " + err.Error()})
                return
        }

        entry := &TorrentEntry{
                ID:        id,
                Torrent:   t,
                Magnet:    magnet,
                CreatedAt: time.Now().UnixMilli(),
                lastTime:  time.Now(),
        }
        torrents.Store(id, entry)

        // Wait for metadata in background
        go func() {
                <-t.GotInfo()
                fmt.Printf("[meta] %s: %s (%d files, %d bytes)\n", id, t.Name(), len(t.Files()), t.Length())
        }()

        c.JSON(200, gin.H{"id": id, "magnet": magnet, "infoHash": infoHashStr})
}

func listTorrentsHandler(c *gin.Context) {
        list := []TorrentResponse{}
        torrents.Range(func(_, value any) bool {
                entry := value.(*TorrentEntry)
                list = append(list, serializeTorrent(entry))
                return true
        })
        // Sort by createdAt desc
        sort.Slice(list, func(i, j int) bool {
                return list[i].CreatedAt > list[j].CreatedAt
        })
        c.JSON(200, list)
}

func getTorrentHandler(c *gin.Context) {
        id := c.Param("id")
        val, ok := torrents.Load(id)
        if !ok {
                c.JSON(404, gin.H{"error": "Torrent not found"})
                return
        }
        entry := val.(*TorrentEntry)
        c.JSON(200, serializeTorrent(entry))
}

func streamFileHandler(c *gin.Context) {
        id := c.Param("id")
        idxStr := c.Param("index")
        val, ok := torrents.Load(id)
        if !ok {
                c.String(404, "Torrent not found")
                return
        }
        entry := val.(*TorrentEntry)
        if entry.Torrent.Info() == nil {
                c.String(409, "Torrent metadata not yet loaded")
                return
        }
        files := entry.Torrent.Files()
        idx, err := strconv.Atoi(idxStr)
        if err != nil || idx < 0 || idx >= len(files) {
                c.String(404, "File not found")
                return
        }
        file := files[idx]

        reader := file.NewReader()
        defer reader.Close()
        // Configure for responsive streaming (return data as soon as available)
        reader.SetResponsive()
        reader.SetReadahead(10 * 1024 * 1024) // 10MB readahead for smooth video playback
        c.Header("Accept-Ranges", "bytes")
        http.ServeContent(c.Writer, c.Request, path.Base(file.Path()), time.Time{}, reader)
}

func downloadFileHandler(c *gin.Context) {
        id := c.Param("id")
        idxStr := c.Param("index")
        val, ok := torrents.Load(id)
        if !ok {
                c.String(404, "Not found")
                return
        }
        entry := val.(*TorrentEntry)
        if entry.Torrent.Info() == nil {
                c.String(409, "Torrent metadata not yet loaded")
                return
        }
        files := entry.Torrent.Files()
        idx, err := strconv.Atoi(idxStr)
        if err != nil || idx < 0 || idx >= len(files) {
                c.String(404, "File not found")
                return
        }
        file := files[idx]

        name := path.Base(file.Path())
        encoded := url.QueryEscape(name)
        c.Header("Content-Disposition", "attachment; filename*=UTF-8''"+encoded)
        c.Header("Accept-Ranges", "bytes")

        reader := file.NewReader()
        defer reader.Close()

        http.ServeContent(c.Writer, c.Request, name, time.Time{}, reader)
}

func pauseHandler(c *gin.Context) {
        id := c.Param("id")
        val, ok := torrents.Load(id)
        if !ok {
                c.JSON(404, gin.H{"error": "Not found"})
                return
        }
        entry := val.(*TorrentEntry)
        entry.Torrent.DisallowDataDownload()
        c.JSON(200, gin.H{"ok": true, "paused": true})
}

func resumeHandler(c *gin.Context) {
        id := c.Param("id")
        val, ok := torrents.Load(id)
        if !ok {
                c.JSON(404, gin.H{"error": "Not found"})
                return
        }
        entry := val.(*TorrentEntry)
        entry.Torrent.AllowDataDownload()
        c.JSON(200, gin.H{"ok": true, "paused": false})
}

func deleteTorrentHandler(c *gin.Context) {
        id := c.Param("id")
        keepFiles := c.Query("keepFiles") == "1"
        val, loaded := torrents.LoadAndDelete(id)
        if !loaded {
                c.JSON(404, gin.H{"error": "Not found"})
                return
        }
        entry := val.(*TorrentEntry)
        torrentName := entry.Torrent.Name()
        entry.Torrent.Drop()

        if !keepFiles && torrentName != "" {
                dirPath := filepath.Join(DownloadDir, torrentName)
                os.RemoveAll(dirPath)
        }

        suffix := ""
        if keepFiles {
                suffix = " (kept files)"
        } else {
                suffix = " (+files)"
        }
        fmt.Printf("[removed] %s%s\n", id, suffix)
        c.JSON(200, gin.H{"ok": true})
}

// ===== Helpers =====

func truncate(s string, max int) string {
        if len(s) <= max {
                return s
        }
        return s[:max]
}

// ===== Main =====

func main() {
        os.MkdirAll(DownloadDir, 0755)

        // Use NewDefaultClientConfig to get properly initialized rate limiters
        // and other defaults. Creating a struct literal directly causes nil pointer panics.
        cfg := torrent.NewDefaultClientConfig()
        cfg.DataDir = DownloadDir
        c, err := torrent.NewClient(cfg)
        if err != nil {
                panic(fmt.Sprintf("Failed to create torrent client: %v", err))
        }
        client = c

        // Background speed updater - updates every 1s
        go func() {
                for {
                        time.Sleep(1 * time.Second)
                        torrents.Range(func(_, value any) bool {
                                entry := value.(*TorrentEntry)
                                entry.updateSpeed()
                                return true
                        })
                }
        }()

        // Periodic stats logger
        go func() {
                for {
                        time.Sleep(30 * time.Second)
                        count := 0
                        torrents.Range(func(_, _ any) bool {
                                count++
                                return true
                        })
                        if count > 0 {
                                fmt.Printf("[stats] %d torrents\n", count)
                        }
                }
        }()

        gin.SetMode(gin.ReleaseMode)
        r := gin.Default()

        r.Use(cors.New(cors.Config{
                AllowOrigins:     []string{"*"},
                AllowMethods:     []string{"GET", "POST", "DELETE", "OPTIONS"},
                AllowHeaders:     []string{"Content-Type", "Range"},
                ExposeHeaders:    []string{"Content-Range", "Accept-Ranges", "Content-Length", "Content-Disposition"},
                AllowCredentials: false,
        }))

        api := r.Group("/api")
        {
                api.GET("/health", healthHandler)
                api.POST("/torrents", addTorrentHandler)
                api.GET("/torrents", listTorrentsHandler)
                api.GET("/torrents/:id", getTorrentHandler)
                api.GET("/torrents/:id/stream/:index", streamFileHandler)
                api.GET("/torrents/:id/download/:index", downloadFileHandler)
                api.POST("/torrents/:id/pause", pauseHandler)
                api.POST("/torrents/:id/resume", resumeHandler)
                api.DELETE("/torrents/:id", deleteTorrentHandler)
        }

        fmt.Printf("\n============================================\n")
        fmt.Printf("  Torrent Service (Go + anacrolix/torrent)\n")
        fmt.Printf("  Running on port %s\n", Port)
        fmt.Printf("  Download dir: %s\n", DownloadDir)
        fmt.Printf("============================================\n\n")

        if err := r.Run(":" + Port); err != nil {
                panic(err)
        }
}
