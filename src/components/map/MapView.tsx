"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type {
  GeoJSONSource,
  LngLatBoundsLike,
  Map as MapLibreMap,
  StyleSpecification,
} from "maplibre-gl";
import { Minus, Plus, Scan, SquareDashedMousePointer, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui";
import type { MapBox } from "@/lib/mapArea";
import { roundDegrees, type MapPoint } from "./mapData";

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

const POINTS = "photo-points";
const SELECTION = "selection";
const HEAT = "photo-heat";
const CIRCLES = "photo-circles";
const OWN_SOURCES = new Set([POINTS, SELECTION]);

/** The heat fades into one circle per cell around this zoom (streets readable). */
const CIRCLES_FROM = 12;
/** Smaller than this on either side, in pixels, a drag is a slip, not a zone. */
const MIN_DRAG = 8;
const FIT_PADDING = 48;

const UI_STRINGS = {
  "AttributionControl.ToggleAttribution": "Sources de la carte",
  "Map.Title": "Carte",
  "CooperativeGesturesHandler.MobileHelpText":
    "Deux doigts pour déplacer la carte",
  "CooperativeGesturesHandler.WindowsHelpText": "Ctrl + molette pour zoomer",
  "CooperativeGesturesHandler.MacHelpText": "⌘ + molette pour zoomer",
};

const EMPTY: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/** A design token as MapLibre reads colours: "rgba(r, g, b, a)". */
function tokenColor(name: string, alpha = 1): string {
  const channels = getComputedStyle(document.documentElement)
    .getPropertyValue(`--${name}`)
    .trim()
    .split(/\s+/)
    .join(", ");
  return `rgba(${channels}, ${alpha})`;
}

function pointFeatures(points: MapPoint[]): GeoJSON.FeatureCollection {
  // Log scale: home holds thousands of photos, a trip a few dozen.
  const top = Math.log1p(points.reduce((max, [, , n]) => Math.max(max, n), 1));
  return {
    type: "FeatureCollection",
    features: points.map(([lat, lng, count]) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: { weight: Math.log1p(count) / top },
    })),
  };
}

function boxFeature(box: MapBox): GeoJSON.Feature {
  const { south, west, north, east } = box;
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    },
  };
}

function boxBounds(box: MapBox): LngLatBoundsLike {
  return [
    [box.west, box.south],
    [box.east, box.north],
  ];
}

function pointsBounds(points: MapPoint[]): LngLatBoundsLike {
  let [south, west, north, east] = [90, 180, -90, -180];
  for (const [lat, lng] of points) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  }
  return [
    [west, south],
    [east, north],
  ];
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** The box between two corners, inside the world; null when flat. */
function cornersBox(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): MapBox | null {
  const box = {
    south: roundDegrees(clamp(Math.min(a.lat, b.lat), -90, 90)),
    north: roundDegrees(clamp(Math.max(a.lat, b.lat), -90, 90)),
    west: roundDegrees(clamp(Math.min(a.lng, b.lng), -180, 180)),
    east: roundDegrees(clamp(Math.max(a.lng, b.lng), -180, 180)),
  };
  return box.south < box.north && box.west < box.east ? box : null;
}

/** A background in the page's grey: the heat still reads without the basemap. */
function plainStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": tokenColor("surface-sunken") },
      },
    ],
  };
}

function addLayers(map: MapLibreMap) {
  map.addSource(POINTS, { type: "geojson", data: EMPTY });
  map.addSource(SELECTION, { type: "geojson", data: EMPTY });
  // Under the basemap's labels, so place names stay readable over the heat.
  const labels = map
    .getStyle()
    .layers.find((layer) => layer.type === "symbol")?.id;
  map.addLayer(
    {
      id: HEAT,
      type: "heatmap",
      source: POINTS,
      maxzoom: CIRCLES_FROM + 1,
      paint: {
        "heatmap-weight": ["get", "weight"],
        "heatmap-intensity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          0,
          0.35,
          6,
          0.9,
          CIRCLES_FROM,
          1.8,
        ],
        "heatmap-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          0,
          6,
          6,
          14,
          CIRCLES_FROM,
          26,
        ],
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          tokenColor("chart-4", 0),
          0.1,
          tokenColor("chart-4", 0.5),
          0.35,
          tokenColor("chart-1", 0.7),
          0.75,
          tokenColor("chart-6", 0.85),
          1,
          tokenColor("chart-6", 0.95),
        ],
        "heatmap-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          CIRCLES_FROM - 1,
          0.9,
          CIRCLES_FROM + 1,
          0,
        ],
      },
    },
    labels,
  );
  map.addLayer(
    {
      id: CIRCLES,
      type: "circle",
      source: POINTS,
      minzoom: CIRCLES_FROM - 1,
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          CIRCLES_FROM - 1,
          ["+", 3, ["*", 9, ["get", "weight"]]],
          16,
          ["+", 6, ["*", 22, ["get", "weight"]]],
        ],
        "circle-color": tokenColor("chart-1", 0.7),
        "circle-stroke-color": tokenColor("paper"),
        "circle-stroke-width": 1,
        "circle-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          CIRCLES_FROM - 1,
          0,
          CIRCLES_FROM,
          1,
        ],
        "circle-stroke-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          CIRCLES_FROM - 1,
          0,
          CIRCLES_FROM,
          1,
        ],
      },
    },
    labels,
  );
  map.addLayer({
    id: "selection-fill",
    type: "fill",
    source: SELECTION,
    paint: { "fill-color": tokenColor("ink", 0.06) },
  });
  map.addLayer({
    id: "selection-line",
    type: "line",
    source: SELECTION,
    paint: { "line-color": tokenColor("ink"), "line-width": 1.5 },
  });
}

interface MapViewProps {
  /** Null until the first answer */
  points: MapPoint[] | null;
  /** Side of a cell in degrees: a click on a circle selects its cell */
  cell: number;
  box: MapBox | null;
  onSelect: (box: MapBox | null) => void;
  /** Messages laid over the map */
  children?: React.ReactNode;
}

interface Drag {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Where the photos were taken, as heat, then as circles once zoomed in. A
 * zone is a rectangle drawn after "Choisir une zone" or with Shift held, or
 * the cell of a clicked circle. The canvas is decorative for screen readers:
 * every action has a button.
 */
export default function MapView({
  points,
  cell,
  box,
  onSelect,
  children,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // Bumped each time a style (the basemap or the plain fallback) gets our layers.
  const [styleVersion, setStyleVersion] = useState(0);
  const [basemapFailed, setBasemapFailed] = useState(false);
  const [broken, setBroken] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);

  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
  // Pointer events can outrun renders: handlers read the drag from here.
  const dragRef = useRef<Drag | null>(null);
  const moveDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const cellRef = useRef(cell);
  cellRef.current = cell;
  const initialBox = useRef(box);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let map: MapLibreMap | null = null;
    let cancelled = false;

    // maplibre-gl 5 on purpose: its bundle carries the worker. Version 6
    // loads it from a separate .mjs that Next 14's build minifies as a
    // classic script and fails on.
    import("maplibre-gl")
      .then((maplibre) => {
        if (cancelled) return;
        const start = initialBox.current;
        const created = new maplibre.Map({
          container,
          style: STYLE_URL,
          ...(start && {
            bounds: boxBounds(start),
            fitBoundsOptions: { padding: FIT_PADDING },
          }),
          attributionControl: { compact: true },
          // Shift+drag selects a zone instead of zooming to it.
          boxZoom: false,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          keyboard: false,
          // On a phone one finger scrolls the page, two move the map.
          cooperativeGestures: window.matchMedia("(pointer: coarse)").matches,
          renderWorldCopies: false,
          maxZoom: 16,
          locale: UI_STRINGS,
        });
        map = created;
        mapRef.current = created;
        created.touchZoomRotate.disableRotation();
        created.getCanvas().tabIndex = -1;
        created.getCanvasContainer().setAttribute("aria-hidden", "true");

        let styleLoaded = false;
        let fellBack = false;
        let basemapLoaded = false;
        created.on("style.load", () => {
          styleLoaded = true;
          addLayers(created);
          setStyleVersion((v) => v + 1);
        });
        created.on("sourcedata", (event) => {
          if (event.tile !== undefined && !OWN_SOURCES.has(event.sourceId))
            basemapLoaded = true;
        });
        created.on("error", (event) => {
          const sourceId = (event as { sourceId?: unknown }).sourceId;
          if (typeof sourceId === "string" && OWN_SOURCES.has(sourceId)) {
            console.error("Map layer error", event.error);
            return;
          }
          if (!styleLoaded && !fellBack) {
            // The style never came: keep the heat on a plain background.
            fellBack = true;
            setBasemapFailed(true);
            created.setStyle(plainStyle());
          } else if (!basemapLoaded) {
            setBasemapFailed(true);
          }
        });
        created.on("click", CIRCLES, (event) => {
          if (drawingRef.current || created.getZoom() < CIRCLES_FROM - 0.5)
            return;
          const geometry = event.features?.[0]?.geometry;
          if (geometry?.type !== "Point") return;
          // The circle sits where its photos average: select its whole cell.
          const size = cellRef.current;
          const [lng = 0, lat = 0] = geometry.coordinates.map(
            (v) => Math.round(v / size) * size,
          );
          const picked = cornersBox(
            { lng: lng - size / 2, lat: lat - size / 2 },
            { lng: lng + size / 2, lat: lat + size / 2 },
          );
          if (picked) onSelectRef.current(picked);
        });
        created.on("mouseenter", CIRCLES, () => {
          created.getCanvas().style.cursor = "pointer";
        });
        created.on("mouseleave", CIRCLES, () => {
          created.getCanvas().style.cursor = "";
        });
      })
      .catch((error: unknown) => {
        // No WebGL, or the map code didn't load: the photos still list below.
        console.error("Map unavailable", error);
        if (!cancelled) setBroken(true);
      });

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const source = mapRef.current?.getSource<GeoJSONSource>(POINTS);
    if (styleVersion === 0 || !source) return;
    void source.setData(points ? pointFeatures(points) : EMPTY);
  }, [styleVersion, points]);

  useEffect(() => {
    const source = mapRef.current?.getSource<GeoJSONSource>(SELECTION);
    if (styleVersion === 0 || !source) return;
    void source.setData(box ? boxFeature(box) : EMPTY);
  }, [styleVersion, box]);

  // First view: the selection when the URL has one, else every photo.
  const fitted = useRef(initialBox.current !== null);
  useEffect(() => {
    const map = mapRef.current;
    if (styleVersion === 0 || !map || fitted.current || points === null) return;
    fitted.current = true;
    if (points.length > 0)
      map.fitBounds(pointsBounds(points), {
        padding: FIT_PADDING,
        maxZoom: CIRCLES_FROM,
        duration: 0,
      });
  }, [styleVersion, points]);

  // Back and Forward can bring a zone that is out of sight: bring it in.
  useEffect(() => {
    const map = mapRef.current;
    if (styleVersion === 0 || !map || !box) return;
    const view = map.getBounds();
    const outOfSight =
      box.east < view.getWest() ||
      box.west > view.getEast() ||
      box.north < view.getSouth() ||
      box.south > view.getNorth();
    if (outOfSight) map.fitBounds(boxBounds(box), { padding: FIT_PADDING });
  }, [styleVersion, box]);

  useEffect(() => {
    if (!drawing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawing(false);
        dragRef.current = null;
        setDrag(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [drawing]);

  const pointer = (e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    return {
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0),
    };
  };

  const select = (next: MapBox | null) => {
    setDrawing(false);
    onSelect(next);
  };

  const selectView = () => {
    const view = mapRef.current?.getBounds();
    if (!view) return;
    const visible = cornersBox(view.getSouthWest(), view.getNorthEast());
    if (visible) select(visible);
  };

  const finishDrag = (done: Drag) => {
    const map = mapRef.current;
    if (!map) return;
    if (
      Math.abs(done.x1 - done.x0) < MIN_DRAG ||
      Math.abs(done.y1 - done.y0) < MIN_DRAG
    )
      return;
    const drawn = cornersBox(
      map.unproject([done.x0, done.y0]),
      map.unproject([done.x1, done.y1]),
    );
    if (drawn) select(drawn);
  };

  const overlay = drag && {
    left: Math.min(drag.x0, drag.x1),
    top: Math.min(drag.y0, drag.y1),
    width: Math.abs(drag.x1 - drag.x0),
    height: Math.abs(drag.y1 - drag.y0),
  };

  return (
    <div
      className="relative h-[60vh] min-h-[20rem] overflow-hidden rounded-lg border border-line bg-surface-sunken"
      // Capture phase, before MapLibre: a drag in drawing mode or with Shift
      // draws a zone instead of moving the map.
      onPointerDownCapture={(e) => {
        if (!mapRef.current || e.button !== 0 || !e.isPrimary) return;
        if (!(drawingRef.current || (e.shiftKey && e.pointerType === "mouse")))
          return;
        if ((e.target as Element).closest("button, a")) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const { x, y } = pointer(e);
        moveDrag({ x0: x, y0: y, x1: x, y1: y });
      }}
      onPointerMove={(e) => {
        const current = dragRef.current;
        if (!current) return;
        const { x, y } = pointer(e);
        moveDrag({ ...current, x1: x, y1: y });
      }}
      onPointerUp={() => {
        const done = dragRef.current;
        if (!done) return;
        moveDrag(null);
        finishDrag(done);
      }}
      onPointerCancel={() => {
        moveDrag(null);
      }}
    >
      <div ref={containerRef} className="h-full w-full" />

      {drawing && (
        // Above the canvas so touches draw instead of panning.
        <div
          aria-hidden
          className="absolute inset-0 z-[1] cursor-crosshair touch-none"
        />
      )}
      {overlay && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-[1] border-[1.5px] border-ink bg-ink/5"
          style={overlay}
        />
      )}

      {!broken && (
        <>
          <div className="absolute left-3 top-3 z-[2] flex max-w-[calc(100%-4.5rem)] flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={drawing ? "primary" : "secondary"}
              icon={SquareDashedMousePointer}
              aria-pressed={drawing}
              className="shadow-lift"
              onClick={() => {
                setDrawing((d) => !d);
              }}
            >
              Choisir une zone
            </Button>
            {drawing ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={Scan}
                  className="shadow-lift"
                  onClick={selectView}
                >
                  Toute la vue
                </Button>
                <span className="rounded-full bg-paper/90 px-3 py-1 text-sm text-ink-soft shadow-lift">
                  Tracez un rectangle
                </span>
              </>
            ) : (
              box && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={X}
                  className="shadow-lift"
                  onClick={() => {
                    select(null);
                  }}
                >
                  Effacer
                </Button>
              )
            )}
          </div>

          <div className="absolute right-3 top-3 z-[2] flex flex-col gap-1.5">
            <IconButton
              icon={Plus}
              label="Zoom avant"
              variant="secondary"
              size="sm"
              className="shadow-lift"
              onClick={() => {
                mapRef.current?.zoomIn();
              }}
            />
            <IconButton
              icon={Minus}
              label="Zoom arrière"
              variant="secondary"
              size="sm"
              className="shadow-lift"
              onClick={() => {
                mapRef.current?.zoomOut();
              }}
            />
          </div>
        </>
      )}

      {basemapFailed && !broken && (
        <p
          role="status"
          className="absolute bottom-3 left-3 z-[2] max-w-[calc(100%-1.5rem)] rounded-md bg-paper/95 px-3 py-1.5 text-sm text-ink-soft shadow-lift"
        >
          Le fond de carte n&apos;a pas pu être chargé.
        </p>
      )}

      {broken ? (
        <div className="absolute inset-0 z-[2] flex items-center justify-center p-6 text-center text-sm text-ink-muted">
          La carte ne peut pas s&apos;afficher sur cet appareil.
        </div>
      ) : (
        children
      )}
    </div>
  );
}
