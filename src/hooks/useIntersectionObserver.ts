import { useEffect, useRef, useState } from "react";

interface UseIntersectionObserverOptions {
  rootMargin?: string;
  threshold?: number;
  once?: boolean;
}

export function useIntersectionObserver(
  options: UseIntersectionObserverOptions = {},
) {
  const { rootMargin = "50px", threshold = 0.1, once = true } = options;

  const [isIntersecting, setIsIntersecting] = useState(false);
  const [hasIntersected, setHasIntersected] = useState(false);
  const elementRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const isCurrentlyIntersecting = entry.isIntersecting;
        setIsIntersecting(isCurrentlyIntersecting);

        if (isCurrentlyIntersecting && !hasIntersected) {
          setHasIntersected(true);
        }
      },
      {
        rootMargin,
        threshold,
      },
    );

    observer.observe(element);

    return () => {
      observer.unobserve(element);
    };
  }, [rootMargin, threshold, hasIntersected]);

  const shouldLoad = once ? hasIntersected : isIntersecting;

  return {
    elementRef,
    isIntersecting,
    hasIntersected,
    shouldLoad,
  };
}
