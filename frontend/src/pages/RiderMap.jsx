import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Box } from '@mui/material';
import Map, { Source, Layer, Popup, Marker } from 'react-map-gl';
import PageHeader from '../components/common/PageHeader';
import MapPanel from '../components/common/MapPanel';
import LiveDot from '../components/common/LiveDot';
import { addLabelPillImage, makeLabelLayer } from '../components/map/mapLabels.js';
import RiderMarker from '../components/map/RiderMarker.jsx';
import { useSimulation } from '../context/SimulationContext';
import { getRestaurants } from '../api/endpoints';
import styles from './RiderMap.module.css';

const MAPBOX_TOKEN  = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '';
const RANCHI_CENTER = { longitude: 85.33, latitude: 23.35, zoom: 13 };
const MAP_STYLE     = 'mapbox://styles/mapbox/dark-v11';

const clusterCircleLayer = {
  id:     'clusters',
  type:   'circle',
  filter: ['has', 'point_count'],
  paint: {
    'circle-color':        '#f59e0b',
    'circle-radius':       18,
    'circle-stroke-color': '#1a1a1a',
    'circle-stroke-width': 1.5,
    'circle-opacity':      0.92,
  },
};

const clusterCountLayer = {
  id:     'cluster-count',
  type:   'symbol',
  filter: ['has', 'point_count'],
  layout: {
    'text-field': '{point_count_abbreviated}',
    'text-size':  13,
    'text-font':  ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
  },
  paint: { 'text-color': '#ffffff' },
};

const restaurantLayer = {
  id:   'restaurants',
  type: 'circle',
  paint: {
    'circle-radius':       5,
    'circle-color':        '#22c55e',
    'circle-stroke-color': '#ffffff',
    'circle-stroke-width': 1,
    'circle-opacity':      0.85,
  },
};

const restaurantLabelLayer = makeLabelLayer({
  id:        'restaurants-labels',
  source:    'restaurants',
  textField: ['coalesce', ['get', 'name'], 'Restaurant'],
  minZoom:   13,
});

export default function RiderMap() {
  const { riders, connected, queueDepth } = useSimulation();
  const [restaurants, setRestaurants]     = useState([]);
  const [popup, setPopup]                 = useState(null);
  const [unclusteredIds, setUnclusteredIds] = useState(new Set());

  const mapRef          = useRef(null);
  const mapContainerRef = useRef(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    const observer = new ResizeObserver(() => { mapRef.current?.resize(); });
    observer.observe(mapContainerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    getRestaurants()
      .then((r) => setRestaurants(r.data ?? []))
      .catch(() => {});
  }, []);

  const syncUnclustered = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || !map.isStyleLoaded()) return;
    try {
      const features = map.querySourceFeatures('riders', {
        filter: ['!', ['has', 'point_count']],
      });
      const ids = new Set(features.map((f) => f.properties?.id).filter(Boolean));
      setUnclusteredIds((prev) => {
        if (prev.size === ids.size && [...ids].every((id) => prev.has(id))) return prev;
        return ids;
      });
    } catch { /* map not ready */ }
  }, []);

  useEffect(() => {
    const t = setTimeout(syncUnclustered, 50);
    return () => clearTimeout(t);
  }, [riders, syncUnclustered]);

  const handleLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map) addLabelPillImage(map);
    syncUnclustered();
  }, [syncUnclustered]);

  const handleMapClick = useCallback((e) => {
    const clusterFeature = (e.features ?? []).find((f) => f.layer.id === 'clusters');
    if (clusterFeature) {
      const map    = mapRef.current?.getMap();
      const source = map?.getSource('riders');
      source?.getClusterExpansionZoom(clusterFeature.properties.cluster_id, (err, zoom) => {
        if (err) return;
        map.easeTo({ center: clusterFeature.geometry.coordinates, zoom });
      });
      return;
    }
    setPopup(null);
  }, []);

  const handleRiderClick = useCallback((rider) => {
    setPopup({ lng: rider.lng, lat: rider.lat, name: rider.name, status: rider.status, orderId: rider.orderId });
  }, []);

  const riderGeojson = useMemo(() => ({
    type: 'FeatureCollection',
    features: riders.map((r) => ({
      type:       'Feature',
      geometry:   { type: 'Point', coordinates: [r.lng, r.lat] },
      properties: {
        id:                 r._id,
        name:               r.name,
        status:             r.status,
        availabilityStatus: r.availabilityStatus ?? 'ONLINE',
        orderId:            r.orderId ?? null,
      },
    })),
  }), [riders]);

  const restaurantGeojson = useMemo(() => ({
    type: 'FeatureCollection',
    features: restaurants
      .filter((r) => r.isActive !== false)
      .map((r) => ({
        type:     'Feature',
        geometry: { type: 'Point', coordinates: [r.longitude, r.latitude] },
        properties: { name: r.name ?? '' },
      })),
  }), [restaurants]);

  const unclusteredRiders = useMemo(
    () => riders.filter((r) => unclusteredIds.has(r._id)),
    [riders, unclusteredIds],
  );

  const stats = useMemo(() => {
    const idle    = riders.filter((r) => r.status === 'IDLE').length;
    const active  = riders.filter((r) => r.status === 'ACCEPTED' || r.status === 'PICKED_UP').length;
    const offline = riders.filter((r) => r.availabilityStatus === 'OFFLINE').length;
    return { idle, active, offline };
  }, [riders]);

  const eyebrow = (
    <span className={styles.liveEyebrow}>
      <LiveDot active={connected} />
      {connected
        ? `Fleet — Live · ${riders.length} riders · Queue: ${queueDepth}`
        : 'Fleet — Waiting for simulation…'}
    </span>
  );

  return (
    <Box className={styles.pageRoot}>
      <PageHeader
        title="Rider Map"
        description="Live positions of every rider, color-coded by movement state."
      />

      <div className={styles.mapPanelWrap}>
        <MapPanel
          eyebrow={eyebrow}
          legend={[
            { label: 'Available',  color: 'link'        },
            { label: 'Assigned',   color: 'warning'     },
            { label: 'Delivering', color: 'riderPickup' },
            { label: 'Offline',    color: 'faint'       },
            { label: 'Restaurant', color: 'restaurant'  },
          ]}
          variant="full"
        >
          <div className={styles.mapWrap} ref={mapContainerRef}>
            <div className={styles.statsOverlay}>
              <span className={styles.statItem}>
                <span className={`${styles.statValue} ${styles.statIdle}`}>{stats.idle}</span>
                <span className={styles.statLabel}>Idle</span>
              </span>
              <span className={styles.statDivider} />
              <span className={styles.statItem}>
                <span className={`${styles.statValue} ${styles.statActive}`}>{stats.active}</span>
                <span className={styles.statLabel}>Active</span>
              </span>
              <span className={styles.statDivider} />
              <span className={styles.statItem}>
                <span className={`${styles.statValue} ${styles.statOffline}`}>{stats.offline}</span>
                <span className={styles.statLabel}>Offline</span>
              </span>
              <span className={styles.statDivider} />
              <span className={styles.statItem}>
                <span className={`${styles.statValue} ${styles.statQueue}`}>{queueDepth}</span>
                <span className={styles.statLabel}>Queued Orders</span>
              </span>
            </div>
            <Map
              ref={mapRef}
              mapboxAccessToken={MAPBOX_TOKEN}
              initialViewState={RANCHI_CENTER}
              mapStyle={MAP_STYLE}
              style={{ width: '100%', height: '100%' }}
              onLoad={handleLoad}
              onClick={handleMapClick}
              onZoomEnd={() => { setPopup(null); syncUnclustered(); }}
              onMoveEnd={syncUnclustered}
              interactiveLayerIds={['clusters']}
            >
              <Source id="restaurants" type="geojson" data={restaurantGeojson}>
                <Layer {...restaurantLayer} />
                <Layer {...restaurantLabelLayer} />
              </Source>
              <Source id="riders" type="geojson" data={riderGeojson} cluster={true} clusterMaxZoom={14} clusterRadius={50}>
                <Layer {...clusterCircleLayer} />
                <Layer {...clusterCountLayer} />
              </Source>
              {unclusteredRiders.map((r) => (
                <Marker key={r._id} longitude={r.lng} latitude={r.lat} anchor="center">
                  <RiderMarker rider={r} onClick={handleRiderClick} />
                </Marker>
              ))}
              {popup && (
                <Popup
                  longitude={popup.lng}
                  latitude={popup.lat}
                  anchor="top"
                  offset={[0, 22]}
                  onClose={() => setPopup(null)}
                  closeOnClick={false}
                >
                  <div className={styles.popup}>
                    <div className={styles.popupName}>{popup.name}</div>
                    <span className={`${styles.popupBadge} ${styles[`badge${popup.status}`]}`}>
                      {popup.status}
                    </span>
                    {popup.orderId && (
                      <div className={styles.popupOrder}>
                        Order{' '}
                        <Link to={`/map/orders/${popup.orderId}`} className={styles.popupLink}>
                          #{popup.orderId.slice(-8).toUpperCase()}
                        </Link>
                      </div>
                    )}
                  </div>
                </Popup>
              )}
            </Map>
          </div>
        </MapPanel>
      </div>
    </Box>
  );
}
