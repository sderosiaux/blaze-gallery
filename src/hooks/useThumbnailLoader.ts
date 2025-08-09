import { useState, useEffect, useCallback } from 'react';

interface ThumbnailRequest {
  url: string;
  priority: number;
  resolve: (blob: Blob | null) => void;
}

class ThumbnailQueue {
  private queue: ThumbnailRequest[] = [];
  private activeRequests = new Set<string>();
  private cache = new Map<string, Blob>();
  private readonly maxConcurrent: number;
  private readonly maxCacheSize: number;

  constructor(maxConcurrent = 6, maxCacheSize = 100) {
    this.maxConcurrent = maxConcurrent;
    this.maxCacheSize = maxCacheSize;
  }

  async loadThumbnail(url: string, priority = 0): Promise<Blob | null> {
    // Check cache first
    if (this.cache.has(url)) {
      return this.cache.get(url)!;
    }

    // Check if already loading
    if (this.activeRequests.has(url)) {
      return new Promise(resolve => {
        this.queue.push({ url, priority, resolve });
      });
    }

    return new Promise(resolve => {
      this.queue.push({ url, priority, resolve });
      this.processQueue();
    });
  }

  private async processQueue() {
    while (this.activeRequests.size < this.maxConcurrent && this.queue.length > 0) {
      // Sort by priority (higher priority first)
      this.queue.sort((a, b) => b.priority - a.priority);
      const request = this.queue.shift()!;

      if (this.cache.has(request.url)) {
        request.resolve(this.cache.get(request.url)!);
        continue;
      }

      this.activeRequests.add(request.url);
      this.fetchThumbnail(request);
    }
  }

  private async fetchThumbnail(request: ThumbnailRequest) {
    try {
      const response = await fetch(request.url, {
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      
      // Cache management
      if (this.cache.size >= this.maxCacheSize) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) {
          this.cache.delete(firstKey);
        }
      }
      
      this.cache.set(request.url, blob);
      
      // Resolve all pending requests for this URL
      const pendingRequests = this.queue.filter(r => r.url === request.url);
      this.queue = this.queue.filter(r => r.url !== request.url);
      
      request.resolve(blob);
      pendingRequests.forEach(r => r.resolve(blob));
      
    } catch (error) {
      console.warn(`Failed to load thumbnail ${request.url}:`, error);
      
      // Resolve all pending requests for this URL with null
      const pendingRequests = this.queue.filter(r => r.url === request.url);
      this.queue = this.queue.filter(r => r.url !== request.url);
      
      request.resolve(null);
      pendingRequests.forEach(r => r.resolve(null));
      
    } finally {
      this.activeRequests.delete(request.url);
      this.processQueue(); // Process next items in queue
    }
  }

  clearCache() {
    this.cache.clear();
  }

  getCacheSize() {
    return this.cache.size;
  }
}

// Global singleton instance
const thumbnailQueue = new ThumbnailQueue();

export function useThumbnailLoader(url: string, priority = 0) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const loadThumbnail = useCallback(async () => {
    if (!url) return;

    setIsLoading(true);
    setError(null);

    try {
      const thumbnailBlob = await thumbnailQueue.loadThumbnail(url, priority);
      setBlob(thumbnailBlob);
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [url, priority]);

  useEffect(() => {
    loadThumbnail();
  }, [loadThumbnail]);

  return {
    blob,
    isLoading,
    error,
    reload: loadThumbnail,
  };
}