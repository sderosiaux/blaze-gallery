export default function PhotoSkeleton() {
  return (
    <div className="photo-mosaic-item aspect-square bg-slate-100 overflow-hidden relative">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="w-2 h-2 bg-slate-400 rounded-full animate-pulse-dots"
              style={{
                animationDelay: `${i * 0.15}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
