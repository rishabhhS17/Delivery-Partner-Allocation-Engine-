import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Box } from '@mui/material';
import { useParams } from 'react-router-dom';
import MapGL, { Source, Layer, Popup } from 'react-map-gl';
import PageHeader from '../components/common/PageHeader';
import MapPanel from '../components/common/MapPanel';
import { addLabelPillImage, makeLabelLayer } from '../components/map/mapLabels.js';
import { useSimulation } from '../context/SimulationContext';
import { getRiders, getRestaurants, getCustomers } from '../api/endpoints';
import styles from './OrdersMap.module.css';

const MAPBOX_TOKEN  = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '';
const RANCHI_CENTER = { longitude: 85.33, latitude: 23.35, zoom: 12 };
const MAP_STYLE     = 'mapbox://styles/mapbox/dark-v11';

// Per-type display label. `type` matches the :type route param.
const TYPE_LABEL = { rider: 'Rider', restaurant: 'Restaurant', customer: 'Customer' };

// One interactive circle layer for every entity, coloured by type; the focused entity is drawn
// larger with a thicker ring. Hover/click is handled at the map level (interactiveLayerIds +
// onMouseMove) — the reliable pattern used by OrdersMap — instead of per-marker DOM handlers.
const pointLayer = {
  id:   'entities',
  type: 'circle',
  paint: {
    'circle-radius':       ['case', ['get', 'focused'], 9, 5],
    'circle-color':        ['match', ['get', 'type'],
      'rider', '#3b82f6', 'restaurant', '#22c55e', 'customer', '#f59e0b', '#888888'],
    'circle-stroke-color': '#ffffff',
    'circle-stroke-width': ['case', ['get', 'focused'], 3, 1],
    'circle-opacity':      0.95,
  },
};

const labelLayer = makeLabelLayer({
  id:        'entities-labels',
  source:    'entities',
  textField: ['get', 'name'],
  minZoom:   13,
});

// Normalize any entity to { id, type, name, lng, lat }. Riders from the live socket carry
// lat/lng; restaurants/customers from REST carry latitude/longitude.
const toPoint = (e, type) => ({
  id:   String(e._id),
  type,
  name: e.name ?? TYPE_LABEL[type],
  lng:  e.lng ?? e.longitude,
  lat:  e.lat ?? e.latitude,
});

export default function EntityMap() {
  const { type, id } = useParams();
  const mapRef          = useRef(null);
  const mapContainerRef = useRef(null);
  const { riders: liveRiders } = useSimulation();

  const [fetchedRiders, setFetchedRiders] = useState([]);
  const [restaurants, setRestaurants]     = useState([]);
  const [customers, setCustomers]         = useState([]);
  const [hovered, setHovered]             = useState(null); // { name, type, lng, lat }

  useEffect(() => {
    if (!mapContainerRef.current) return;
    const observer = new ResizeObserver(() => { mapRef.current?.resize(); });
    observer.observe(mapContainerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    getRestaurants().then((r) => setRestaurants(r.data ?? [])).catch(() => {});
    getCustomers().then((r) => setCustomers(r.data ?? [])).catch(() => {});
    getRiders().then((r) => setFetchedRiders(r.data ?? [])).catch(() => {});
  }, []);

  // Prefer live socket riders; fall back to the one-time fetch when the sim hasn't ticked yet.
  const riders = liveRiders?.length ? liveRiders : fetchedRiders;

  const points = useMemo(() => [
    ...riders.map((r) => toPoint(r, 'rider')),
    ...restaurants.map((r) => toPoint(r, 'restaurant')),
    ...customers.map((c) => toPoint(c, 'customer')),
  ].filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat)), [riders, restaurants, customers]);

  const focused = useMemo(
    () => points.find((p) => p.type === type && p.id === String(id)) ?? null,
    [points, type, id],
  );

  const geojson = useMemo(() => ({
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        name: p.name,
        type: p.type,
        focused: focused && p.type === focused.type && p.id === focused.id,
      },
    })),
  }), [points, focused]);

  // Center on the focused entity once it resolves (and whenever the focus changes).
  useEffect(() => {
    if (focused && mapRef.current) {
      mapRef.current.flyTo({ center: [focused.lng, focused.lat], zoom: 15, duration: 800 });
    }
  }, [focused?.id, focused?.lng, focused?.lat]);

  const handleLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    addLabelPillImage(map);
    map.on('styleimagemissing', (e) => {
      if (e.id === 'dpae-label-pill') addLabelPillImage(map);
    });
  }, []);

  const showFeature = useCallback((e) => {
    const feat = e.features?.[0];
    const map  = mapRef.current?.getMap();
    if (feat) {
      if (map) map.getCanvas().style.cursor = 'pointer';
      const [lng, lat] = feat.geometry.coordinates;
      setHovered({ name: feat.properties.name, type: feat.properties.type, lng, lat });
    } else {
      if (map) map.getCanvas().style.cursor = '';
      setHovered(null);
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map) map.getCanvas().style.cursor = '';
    setHovered(null);
  }, []);

  const focusLabel = TYPE_LABEL[type] ?? 'Entity';

  return (
    <Box className={styles.pageRoot}>
      <PageHeader
        title={`${focusLabel} location`}
        description={focused
          ? `Showing ${focused.name} in context with all riders, restaurants, and customers.`
          : 'Locating the selected entity…'}
      />

      <div className={styles.mapPanelWrap}>
        <MapPanel
          legend={[
            { label: 'Rider',      color: 'link'       },
            { label: 'Restaurant', color: 'restaurant' },
            { label: 'Customer',   color: 'customer'   },
          ]}
          variant="full"
        >
          <div className={styles.mapWrap} ref={mapContainerRef}>
            <MapGL
              ref={mapRef}
              mapboxAccessToken={MAPBOX_TOKEN}
              initialViewState={focused
                ? { longitude: focused.lng, latitude: focused.lat, zoom: 15 }
                : RANCHI_CENTER}
              mapStyle={MAP_STYLE}
              style={{ width: '100%', height: '100%' }}
              onLoad={handleLoad}
              interactiveLayerIds={['entities']}
              onMouseMove={showFeature}
              onMouseLeave={handleMouseLeave}
              onClick={showFeature}
            >
              <Source id="entities" type="geojson" data={geojson}>
                <Layer {...pointLayer} />
                <Layer {...labelLayer} />
              </Source>

              {hovered && (
                <Popup
                  longitude={hovered.lng}
                  latitude={hovered.lat}
                  closeButton={false}
                  anchor="bottom"
                  offset={[0, -8]}
                  className={styles.restaurantTooltip}
                >
                  <span className={styles.restaurantTooltipName}>
                    {hovered.name}
                    <span style={{ opacity: 0.6, marginLeft: 6, fontWeight: 400 }}>
                      · {TYPE_LABEL[hovered.type]}
                    </span>
                  </span>
                </Popup>
              )}
            </MapGL>
          </div>
        </MapPanel>
      </div>
    </Box>
  );
}
