"use client";

import { useState, useRef, useCallback, ReactNode } from "react";
import { Upload, X, CheckCircle, AlertCircle, FileImage } from "lucide-react";

// Client-side media file validation (can't import from s3.ts - it uses Node modules)
const MEDIA_EXTENSIONS = new Set([
  // Images
  ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".tif", ".svg",
  ".nef", ".cr2", ".cr3", ".arw", ".dng", ".raf", ".orf", ".rw2", ".pef", ".srw", ".x3f",
  ".heic", ".heif", ".avif",
  // Videos
  ".mp4", ".m4v", ".mov", ".avi", ".wmv", ".mkv", ".webm", ".flv", ".ogv",
  ".3gp", ".3g2", ".mts", ".m2ts", ".ts",
]);

function isMediaFile(filename: string): boolean {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
  return MEDIA_EXTENSIONS.has(ext);
}

interface UploadFile {
  id: string;
  file: File;
  status: "pending" | "uploading" | "success" | "error";
  progress: number;
  error?: string;
}

interface UploadZoneProps {
  folderPath: string;
  onUploadComplete?: () => void;
  children: ReactNode;
}

export default function UploadZone({
  folderPath,
  onUploadComplete,
  children,
}: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadFile[]>([]);
  const [showPanel, setShowPanel] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const addFiles = useCallback((files: FileList | File[]) => {
    const validFiles = Array.from(files).filter((file) =>
      isMediaFile(file.name)
    );

    if (validFiles.length === 0) return;

    const newUploads: UploadFile[] = validFiles.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      status: "pending",
      progress: 0,
    }));

    setUploads((prev) => [...prev, ...newUploads]);
    setShowPanel(true);

    // Start uploading each file
    newUploads.forEach((upload) => uploadFile(upload));
  }, [folderPath]);

  const uploadFile = async (upload: UploadFile) => {
    setUploads((prev) =>
      prev.map((u) =>
        u.id === upload.id ? { ...u, status: "uploading" } : u
      )
    );

    try {
      const formData = new FormData();
      formData.append("file", upload.file);
      formData.append("folder", folderPath);

      const response = await fetch("/api/photos/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Upload failed");
      }

      setUploads((prev) =>
        prev.map((u) =>
          u.id === upload.id ? { ...u, status: "success", progress: 100 } : u
        )
      );

      // Call onUploadComplete when a file is successfully uploaded
      if (onUploadComplete) {
        onUploadComplete();
      }
    } catch (error) {
      setUploads((prev) =>
        prev.map((u) =>
          u.id === upload.id
            ? {
                ...u,
                status: "error",
                error: error instanceof Error ? error.message : "Upload failed",
              }
            : u
        )
      );
    }
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounter.current = 0;

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
        // Reset input so same file can be selected again
        e.target.value = "";
      }
    },
    [addFiles]
  );

  const removeUpload = useCallback((id: string) => {
    setUploads((prev) => prev.filter((u) => u.id !== id));
  }, []);

  const clearCompleted = useCallback(() => {
    setUploads((prev) => prev.filter((u) => u.status !== "success"));
  }, []);

  const pendingCount = uploads.filter((u) => u.status === "pending" || u.status === "uploading").length;
  const successCount = uploads.filter((u) => u.status === "success").length;
  const errorCount = uploads.filter((u) => u.status === "error").length;

  return (
    <div
      className="relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Upload Button */}
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
        >
          <Upload className="w-4 h-4" />
          Upload Photos
        </button>
        {uploads.length > 0 && (
          <button
            onClick={() => setShowPanel(!showPanel)}
            className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors text-sm"
          >
            {pendingCount > 0 && (
              <span className="flex items-center gap-1">
                <div className="w-3 h-3 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
                {pendingCount}
              </span>
            )}
            {successCount > 0 && (
              <span className="flex items-center gap-1 text-green-600">
                <CheckCircle className="w-3 h-3" />
                {successCount}
              </span>
            )}
            {errorCount > 0 && (
              <span className="flex items-center gap-1 text-red-600">
                <AlertCircle className="w-3 h-3" />
                {errorCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Drag Overlay */}
      {isDragging && (
        <div className="fixed inset-0 bg-primary-600 bg-opacity-20 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-2xl shadow-2xl p-12 flex flex-col items-center gap-4 border-4 border-dashed border-primary-500">
            <Upload className="w-16 h-16 text-primary-600" />
            <p className="text-xl font-semibold text-gray-800">
              Drop photos here to upload
            </p>
            <p className="text-gray-500">
              to <span className="font-medium">{folderPath || "root"}</span>
            </p>
          </div>
        </div>
      )}

      {/* Upload Progress Panel */}
      {showPanel && uploads.length > 0 && (
        <div className="fixed bottom-4 right-4 w-96 bg-white rounded-lg shadow-xl border z-40 max-h-96 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
            <span className="font-medium text-gray-800">
              Uploads ({uploads.length})
            </span>
            <div className="flex items-center gap-2">
              {successCount > 0 && (
                <button
                  onClick={clearCompleted}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Clear completed
                </button>
              )}
              <button
                onClick={() => setShowPanel(false)}
                className="p-1 hover:bg-gray-200 rounded"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {uploads.map((upload) => (
              <div
                key={upload.id}
                className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0"
              >
                <FileImage className="w-8 h-8 text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {upload.file.name}
                  </p>
                  {upload.status === "uploading" && (
                    <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                      <div className="bg-primary-600 h-1.5 rounded-full animate-pulse w-1/2" />
                    </div>
                  )}
                  {upload.status === "error" && (
                    <p className="text-xs text-red-500 truncate">
                      {upload.error}
                    </p>
                  )}
                </div>
                <div className="flex-shrink-0">
                  {upload.status === "pending" && (
                    <div className="w-5 h-5 border-2 border-gray-300 border-t-primary-600 rounded-full animate-spin" />
                  )}
                  {upload.status === "uploading" && (
                    <div className="w-5 h-5 border-2 border-gray-300 border-t-primary-600 rounded-full animate-spin" />
                  )}
                  {upload.status === "success" && (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  )}
                  {upload.status === "error" && (
                    <button onClick={() => removeUpload(upload.id)}>
                      <AlertCircle className="w-5 h-5 text-red-500" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Children (gallery content) */}
      {children}
    </div>
  );
}
