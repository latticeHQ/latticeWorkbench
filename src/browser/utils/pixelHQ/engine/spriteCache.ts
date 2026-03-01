/**
 * Pixel HQ Sprite Cache
 *
 * Lazy-loads and caches sprite sheet images for the pixel engine.
 * Uses Vite's static asset URL imports for bundling.
 */

export class SpriteCache {
  private cache = new Map<string, HTMLImageElement>();
  private loading = new Map<string, Promise<HTMLImageElement>>();

  /**
   * Load an image by key. Returns cached version if already loaded.
   * @param key - Unique identifier for the sprite
   * @param url - Image URL (from Vite static import or data URL)
   */
  async load(key: string, url: string): Promise<HTMLImageElement> {
    // Return cached
    const cached = this.cache.get(key);
    if (cached) return cached;

    // Return in-flight promise
    const inflight = this.loading.get(key);
    if (inflight) return inflight;

    // Start loading
    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.cache.set(key, img);
        this.loading.delete(key);
        resolve(img);
      };
      img.onerror = () => {
        this.loading.delete(key);
        reject(new Error(`Failed to load sprite: ${key} from ${url}`));
      };
      img.src = url;
    });

    this.loading.set(key, promise);
    return promise;
  }

  /**
   * Get a sprite synchronously. Returns null if not yet loaded.
   */
  get(key: string): HTMLImageElement | null {
    return this.cache.get(key) ?? null;
  }

  /**
   * Check if a sprite is loaded and ready.
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Preload multiple sprites in parallel.
   * @param manifest - Map of key → URL
   */
  async preloadAll(manifest: Record<string, string>): Promise<void> {
    const promises = Object.entries(manifest).map(([key, url]) =>
      this.load(key, url).catch((err) => {
        console.warn(`[PixelHQ] Failed to preload sprite "${key}":`, err);
      }),
    );
    await Promise.all(promises);
  }

  /**
   * Create an image from a Canvas2D-drawn sprite (for procedural generation).
   * Useful for generating colored variants at runtime.
   */
  createFromCanvas(
    key: string,
    width: number,
    height: number,
    draw: (ctx: CanvasRenderingContext2D) => void,
  ): HTMLImageElement {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    draw(ctx);

    const img = new Image();
    img.src = canvas.toDataURL();
    this.cache.set(key, img);
    return img;
  }

  /**
   * Generate a hue-shifted variant of an existing sprite.
   * Used for crew color differentiation.
   */
  createHueShifted(
    sourceKey: string,
    newKey: string,
    hueShiftDeg: number,
  ): HTMLImageElement | null {
    const source = this.cache.get(sourceKey);
    if (!source) return null;

    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    // Draw original
    ctx.drawImage(source, 0, 0);

    // Apply hue rotation via filter (if supported)
    if (hueShiftDeg !== 0) {
      ctx.globalCompositeOperation = "source-atop";
      ctx.filter = `hue-rotate(${hueShiftDeg}deg)`;
      ctx.drawImage(source, 0, 0);
      ctx.filter = "none";
      ctx.globalCompositeOperation = "source-over";
    }

    const img = new Image();
    img.src = canvas.toDataURL();
    this.cache.set(newKey, img);
    return img;
  }

  /**
   * Clear all cached sprites.
   */
  clear(): void {
    this.cache.clear();
    this.loading.clear();
  }

  /**
   * Number of cached sprites.
   */
  get size(): number {
    return this.cache.size;
  }
}
